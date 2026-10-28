import { createHash } from 'node:crypto';
import { AgentBoundaryError } from '../agent';
import type { OrchestrationResult } from '../orchestration/contracts';
import { OrchestrationError } from '../orchestration/orchestrator';
import { PersistenceConflictError, type CommerceRepository } from '../persistence';
import type { ConversationState } from '../orchestration/http';

export type RunOrchestration = (input: {
  turnId: string;
  conversationId: string;
  prompt: string;
  previous?: OrchestrationResult;
  retryIntentId?: string;
}) => Promise<OrchestrationResult>;

type ExecuteInput = Parameters<RunOrchestration>[0];

export class ConversationNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`Conversation ${conversationId} was not found.`);
    this.name = 'ConversationNotFoundError';
  }
}

export class PersistedExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'PersistedExecutionError';
  }
}

function acceptanceFingerprint(input: ExecuteInput): string {
  return createHash('sha256').update(JSON.stringify({
    conversationId: input.conversationId,
    turnId: input.turnId,
    prompt: input.prompt,
    retryIntentId: input.retryIntentId ?? null,
  })).digest('hex');
}

export class ConversationExecutionService {
  private readonly inFlight = new Map<string, {
    fingerprint: string;
    promise: Promise<OrchestrationResult>;
  }>();

  constructor(
    private readonly repository: CommerceRepository,
    private readonly run: RunOrchestration,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  recoverInterruptedWork(): number {
    return this.repository.recoverInterruptedTurns(this.now()).length;
  }

  readConversation(conversationId: string): ConversationState {
    const conversation = this.repository.getConversation(conversationId);
    if (!conversation) throw new ConversationNotFoundError(conversationId);
    return {
      conversation,
      turns: this.repository.listTurns(conversationId).map((turn) => ({
        id: turn.id,
        conversationId: turn.conversationId,
        status: turn.status,
        createdAt: turn.createdAt,
        updatedAt: turn.updatedAt,
        ...(turn.completedAt === undefined ? {} : { completedAt: turn.completedAt }),
        ...(turn.result === undefined ? {} : { result: turn.result }),
        ...(turn.failure === undefined ? {} : { failure: turn.failure }),
      })),
      messages: this.repository.listMessages(conversationId).map((message) => ({
        id: message.id,
        turnId: message.turnId,
        role: message.role,
        content: message.content,
        status: message.status,
        createdAt: message.createdAt,
      })),
    };
  }

  listConversations() {
    return this.repository.listConversations();
  }

  renameConversation(conversationId: string, title: string) {
    return this.repository.renameConversation(conversationId, title, this.now());
  }

  archiveConversation(conversationId: string) {
    return this.repository.archiveConversation(conversationId, this.now());
  }

  restoreConversation(conversationId: string) {
    return this.repository.restoreConversation(conversationId, this.now());
  }

  execute(input: ExecuteInput): Promise<OrchestrationResult> {
    const fingerprint = acceptanceFingerprint(input);
    const existingExecution = this.inFlight.get(input.turnId);
    if (existingExecution) {
      if (existingExecution.fingerprint !== fingerprint) {
        throw new PersistenceConflictError(`Turn ${input.turnId} is already bound to different input.`);
      }
      return existingExecution.promise;
    }

    const timestamp = this.now();
    const accepted = this.repository.acceptTurn({
      conversation: {
        id: input.conversationId,
        title: input.prompt.slice(0, 80),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      turn: {
        id: input.turnId,
        conversationId: input.conversationId,
        idempotencyKey: `${input.conversationId}:${input.turnId}`,
        status: 'queued',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      userMessage: {
        id: `${input.turnId}:user`,
        conversationId: input.conversationId,
        turnId: input.turnId,
        role: 'user',
        content: input.prompt,
        status: 'completed',
        createdAt: timestamp,
      },
      acceptanceFingerprint: fingerprint,
    });
    if (accepted.result) return Promise.resolve(accepted.result);
    if (accepted.status === 'failed') {
      return Promise.reject(new PersistedExecutionError(
        accepted.failure?.code ?? 'execution_failed',
        accepted.failure?.message ?? 'This turn failed before it could complete.',
        accepted.failure?.retryable ?? false,
      ));
    }
    if (accepted.status === 'running') {
      return Promise.reject(new Error('This turn is already running in another request.'));
    }

    const promise = this.runAccepted(input);
    this.inFlight.set(input.turnId, { fingerprint, promise });
    void promise.finally(() => this.inFlight.delete(input.turnId)).catch(() => undefined);
    return promise;
  }

  private async runAccepted(input: ExecuteInput): Promise<OrchestrationResult> {
    this.repository.markTurnRunning(input.turnId, this.now());
    try {
      const previous = this.repository.listTurns(input.conversationId)
        .filter(({ id, result: persistedResult }) => id !== input.turnId && persistedResult !== undefined)
        .at(-1)?.result;
      const result = await this.run({ ...input, previous });
      if (result.status === 'queued' || result.status === 'running') {
        throw new Error('The orchestration runner returned a non-terminal result.');
      }
      const completedAt = this.now();
      this.repository.completeTurn({
        turnId: input.turnId,
        status: result.status,
        completedAt,
        assistantMessage: {
          id: `${input.turnId}:assistant`,
          conversationId: input.conversationId,
          turnId: input.turnId,
          role: 'assistant',
          content: result.response,
          status: result.status === 'failed' ? 'failed' : 'completed',
          createdAt: completedAt,
        },
        intents: result.outcomes.map(({ intent }, position) => ({
          id: intent.id,
          turnId: input.turnId,
          position,
          goal: intent.goal,
          query: intent.query,
          constraints: intent.constraints,
          status: intent.status,
        })),
        toolRuns: [],
        productSnapshots: result.outcomes
          .filter(({ products }) => products.length > 0)
          .map(({ intent, products }) => ({
            id: `${input.turnId}:products:${intent.id}`,
            turnId: input.turnId,
            intentId: intent.id,
            products: products.map(({ product }) => product),
            createdAt: completedAt,
          })),
        result,
      });
      return result;
    } catch (error) {
      const current = this.repository.getTurn(input.turnId);
      if (current?.status === 'running' || current?.status === 'queued') {
        const failure = error instanceof AgentBoundaryError
          ? { code: error.code, message: error.message, retryable: error.retryable }
          : error instanceof OrchestrationError
            ? { code: error.code, message: error.message, retryable: false }
            : { code: 'execution_failed', message: 'The accepted shopping request could not be completed. It is safe to retry with a new turn.', retryable: false };
        this.repository.failTurn(input.turnId, {
          ...failure,
          completedAt: this.now(),
        });
      }
      throw error;
    }
  }
}
