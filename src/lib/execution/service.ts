import { createHash } from 'node:crypto';
import { AgentBoundaryError } from '../agent';
import type { OrchestrationResult } from '../orchestration/contracts';
import type { ClarificationAnswer } from '../orchestration/contracts';
import { OrchestrationError } from '../orchestration/orchestrator';
import { PersistenceConflictError, type CommerceRepository } from '../persistence';
import type { ConversationState } from '../orchestration/http';
import { buildConversationContext, nextConversationMemoryState, type DisplayGroupReference } from './conversation-context';
import type { OrchestrationDecisionDiagnostic } from '../diagnostics/server-trace';
import { explicitUsdMaxPrice } from '../orchestration/category-resolution';

type BoundedDisplayedProductReference = {
  referenceId: string;
  intentId: string;
  position: number;
  product: {
    id: number;
    title: string;
    price: number;
    category: string;
  };
};

type RunInput = {
  turnId: string;
  conversationId: string;
  prompt: string;
  previous?: OrchestrationResult;
  retryIntentId?: string;
  clarification?: ClarificationAnswer;
  displayedProductReference?: BoundedDisplayedProductReference;
  pausedOutcomes?: OrchestrationResult['outcomes'];
  observeDecision?: (event: OrchestrationDecisionDiagnostic) => void;
  priceConstraintRepair?: { targetIntentId: string; targetCategory: string; maxPrice: number };
};

export type RunOrchestration = (input: RunInput) => Promise<OrchestrationResult>;

function displayGroupLabel(group: DisplayGroupReference): string {
  const category = (group.category ?? group.outcome.intent.goal).replace(/-/gu, ' ');
  const budget = group.outcome.intent.constraints.maxPrice;
  return `${category}${budget === undefined ? '' : ` under $${budget}`}`;
}

function displayGroupChoices(groups: DisplayGroupReference[]): Array<{ group: DisplayGroupReference; label: string }> {
  const base = groups.map((group) => displayGroupLabel(group));
  return groups.map((group, index) => ({
    group,
    label: base.filter((label) => label === base[index]).length === 1
      ? base[index]
      : `${base[index]} — displayed list ${index + 1}`,
  }));
}

function resolvePendingDisplayedSelection(input: {
  clarification?: ClarificationAnswer;
  previous?: OrchestrationResult;
  displayGroups: DisplayGroupReference[];
  turnId: string;
  stateRevision: number;
}): OrchestrationResult | undefined {
  const pending = input.previous?.stateActions?.pendingDisplayedSelection;
  if (!pending || !input.clarification || input.clarification.intentId !== pending.selectorIntentId) return undefined;
  if (input.clarification.field !== 'query' || input.stateRevision !== pending.sourceRevision + 1) {
    throw new OrchestrationError('invalid_refinement', 'This displayed-list clarification is stale or does not match the active question.');
  }
  const selected = pending.mode === 'use_available_groups'
    ? pending.candidates.filter(({ hasPosition }) => hasPosition && input.clarification?.value === 'Use the lists that have this item')
    : pending.candidates.filter(({ label }) => label === input.clarification?.value);
  if (selected.length === 0) {
    if (pending.mode === 'use_available_groups' && input.clarification.value === 'Keep the current displayed results') {
      return {
        turnId: input.turnId,
        status: 'completed',
        response: 'I kept the current displayed results unchanged.',
        outcomes: [],
        stateActions: { pauseIntentIds: [], resumeIntentIds: [], preserveActiveResult: true },
      };
    }
    throw new OrchestrationError('invalid_refinement', 'The clarification answer does not match the saved displayed lists.');
  }
  const groups = selected.map((candidate) => input.displayGroups.find(({ groupRef }) => groupRef === candidate.groupRef));
  if (groups.some((group) => !group || !group.outcome.products[pending.position])) {
    throw new OrchestrationError('invalid_refinement', 'The saved displayed result is no longer available at that position.');
  }
  return {
    turnId: input.turnId,
    status: 'completed',
    response: selected.length > 1
      ? `Here is option ${pending.position + 1} from each displayed list that has it.`
      : `Here is option ${pending.position + 1} from ${selected[0].label}.`,
    outcomes: groups.map((group) => ({
      ...group!.outcome,
      intent: { ...group!.outcome.intent, status: 'completed' },
      products: [group!.outcome.products[pending.position]],
      clarification: undefined,
      error: undefined,
    })),
    stateActions: {
      pauseIntentIds: [], resumeIntentIds: [], selectedProduct: true, preserveActiveResult: true,
      resolvedDisplayedSelection: groups.map((group) => ({
        intentId: group!.intentId,
        position: pending.position,
        product: group!.outcome.products[pending.position].product,
      })),
    },
  };
}

function resolvePendingPriceRepair(input: {
  clarification?: ClarificationAnswer;
  previous?: OrchestrationResult;
  prompt: string;
  turnId: string;
}): { result?: OrchestrationResult; maxPrice?: number; targetCategory?: string } | undefined {
  const pending = input.previous?.stateActions?.pendingPriceConstraintRepair;
  if (!pending) return undefined;
  if (input.clarification && (input.clarification.intentId !== pending.selectorIntentId
    || input.clarification.field !== 'maxPrice')) {
    throw new OrchestrationError('invalid_refinement', 'The price clarification does not match the saved repair request.');
  }
  if (!input.clarification) {
    const answerOnlyRemainder = input.prompt
      .replace(/(?:[$₪€£]\s*)?[0-9]+(?:\.[0-9]+)?/gu, ' ')
      .replace(/\b(?:use|apply|set|make|maximum|max|price|budget|under|below|at|most|please|the|it|to|of|dollars?|usd|yes|yeah|yep|okay|ok|sure|go|with|choose|option|confirm)\b/giu, ' ')
      .replace(/(?:השתמש|החל|קבע|מקסימום|מחיר|תקציב|עד|בבקשה|את|זה|דולר(?:ים)?|כן|אוקיי|בסדר|עם|בחר)/gu, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    if (answerOnlyRemainder) return undefined;
  }
  const answer = input.clarification?.value ?? input.prompt;
  const maxPrice = explicitUsdMaxPrice(answer)
    ?? (!input.clarification && /^\s*[0-9]+(?:\.[0-9]+)?\s*$/u.test(answer)
      ? Number.parseFloat(answer.trim())
      : undefined);
  if (maxPrice !== undefined) return { maxPrice, targetCategory: pending.targetCategory };
  const looksLikeRepairAnswer = Boolean(input.clarification) || /(?:\d|price|maximum|max|budget|מחיר|תקציב)/iu.test(input.prompt);
  if (!looksLikeRepairAnswer) return undefined;
  const question = `Minimum-price filtering is not supported for ${pending.targetCategory}. Use the $${pending.maxPrice} maximum, or provide a different maximum price.`;
  return {
    result: {
      ...input.previous!,
      turnId: input.turnId,
      status: 'partial',
      response: question,
      outcomes: input.previous!.outcomes.map((outcome) => ({
        ...outcome,
        intent: { ...outcome.intent, status: 'needs_clarification' },
        clarification: outcome.intent.id === pending.selectorIntentId
          ? { field: 'maxPrice', question, options: [`Use maximum $${pending.maxPrice}`, 'Enter a different maximum price'], reason: 'requested' }
          : undefined,
      })),
      stateActions: { ...input.previous!.stateActions!, preserveActiveResult: true },
    },
  };
}

type ExecuteInput = Omit<RunInput, 'observeDecision'>;

export class ConversationNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`Conversation ${conversationId} was not found.`);
    this.name = 'ConversationNotFoundError';
  }
}

const persistedExecutionErrorMarker = Symbol.for('bazak.execution.PersistedExecutionError');

export class PersistedExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'PersistedExecutionError';
    Object.defineProperty(this, persistedExecutionErrorMarker, { value: true });
  }

  static isInstance(error: unknown): error is PersistedExecutionError {
    if (error instanceof PersistedExecutionError) return true;
    if (!error || typeof error !== 'object' || (error as Record<PropertyKey, unknown>)[persistedExecutionErrorMarker] !== true) return false;
    const candidate = error as { code?: unknown; message?: unknown; retryable?: unknown };
    return typeof candidate.code === 'string'
      && typeof candidate.message === 'string'
      && typeof candidate.retryable === 'boolean';
  }
}

function acceptanceFingerprint(input: ExecuteInput): string {
  return createHash('sha256').update(JSON.stringify({
    conversationId: input.conversationId,
    turnId: input.turnId,
    prompt: input.prompt,
    retryIntentId: input.retryIntentId ?? null,
    clarification: input.clarification ?? null,
  })).digest('hex');
}

export class ConversationExecutionService {
  private readonly inFlight = new Map<string, {
    fingerprint: string;
    promise: Promise<OrchestrationResult>;
  }>();

  private readonly conversationTails = new Map<string, Promise<void>>();

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

    const prior = this.conversationTails.get(input.conversationId);
    const promise = prior
      ? prior.catch(() => undefined).then(() => this.runAccepted(input))
      : this.runAccepted(input);
    const tail = promise.then(() => undefined, () => undefined);
    this.conversationTails.set(input.conversationId, tail);
    this.inFlight.set(input.turnId, { fingerprint, promise });
    void promise.finally(() => {
      this.inFlight.delete(input.turnId);
      if (this.conversationTails.get(input.conversationId) === tail) {
        this.conversationTails.delete(input.conversationId);
      }
    }).catch(() => undefined);
    return promise;
  }

  private async runAccepted(input: ExecuteInput): Promise<OrchestrationResult> {
    this.repository.markTurnRunning(input.turnId, this.now());
    try {
      const previous = this.repository.listTurns(input.conversationId)
        .filter(({ id, result: persistedResult }) => id !== input.turnId && persistedResult !== undefined)
        .at(-1)?.result;
      const completedResults = this.repository.listTurns(input.conversationId)
        .filter(({ id, result: persistedResult }) => id !== input.turnId && persistedResult !== undefined)
        .map(({ result: persistedResult }) => persistedResult!);
      const persistedState = this.repository.getConversationState(input.conversationId);
      const context = buildConversationContext({
        prompt: input.prompt,
        persistedState,
        latestCompletedResult: previous,
        completedResults,
      });
      const observedDecisions: OrchestrationDecisionDiagnostic[] = [];
      const pendingPriceRepair = resolvePendingPriceRepair({
        clarification: input.clarification,
        previous,
        prompt: input.prompt,
        turnId: input.turnId,
      });
      const pendingDisplayedSelection = resolvePendingDisplayedSelection({
        clarification: input.clarification,
        previous,
        displayGroups: context.displayGroups ?? [],
        turnId: input.turnId,
        stateRevision: context.stateRevision,
      });
      const result = pendingPriceRepair?.result
        ?? (pendingPriceRepair?.maxPrice !== undefined && pendingPriceRepair.targetCategory
          ? await this.run({
              ...input,
              prompt: `For ${pendingPriceRepair.targetCategory}, use a maximum price of $${pendingPriceRepair.maxPrice}.`,
              clarification: undefined,
              priceConstraintRepair: {
                targetIntentId: previous!.stateActions!.pendingPriceConstraintRepair!.targetIntentId,
                targetCategory: pendingPriceRepair.targetCategory,
                maxPrice: pendingPriceRepair.maxPrice,
              },
              previous: context.previous,
              pausedOutcomes: context.pausedOutcomes,
              observeDecision: (event) => observedDecisions.push(event),
            })
          : pendingDisplayedSelection
        ?? (context.displayedProductSelection
        ? { ...context.displayedProductSelection.result, turnId: input.turnId, stateActions: { pauseIntentIds: [], resumeIntentIds: [], selectedProduct: true } }
        : context.ordinalResolutionIssue
          ? {
              turnId: input.turnId,
              status: 'partial' as const,
              response: context.ordinalResolutionIssue.reason === 'missing_position'
                ? `The following displayed lists do not have an item at position ${context.ordinalResolutionIssue.position + 1}: ${context.ordinalResolutionIssue.missingCategories?.join(', ') ?? 'the requested list'}.`
                : `I cannot determine which displayed lists should be used for position ${context.ordinalResolutionIssue.position + 1}.`,
              outcomes: [{
                intent: { id: `clarify:${input.turnId}`, goal: 'Clarify displayed product selection', query: input.prompt, constraints: {}, status: 'needs_clarification' as const },
                products: [],
                clarification: context.ordinalResolutionIssue.reason === 'missing_position'
                  ? { field: 'query' as const, reason: 'requested' as const, question: 'Some displayed lists do not have that position. Use only the lists that do, or leave the display unchanged?', options: ['Use the lists that have this item', 'Keep the current displayed results'] }
                  : { field: 'query' as const, reason: 'requested' as const, question: 'Which displayed list should I use?', options: displayGroupChoices(context.ordinalResolutionIssue.groups).map(({ label }) => label) },
              }],
              stateActions: {
                pauseIntentIds: [],
                resumeIntentIds: [],
                preserveActiveResult: true,
                pendingDisplayedSelection: {
                  kind: 'displayed_ordinal_selection' as const,
                  selectorIntentId: `clarify:${input.turnId}`,
                  position: context.ordinalResolutionIssue.position,
                  mode: context.ordinalResolutionIssue.reason === 'missing_position' ? 'use_available_groups' as const : 'choose_group' as const,
                  sourceRevision: context.stateRevision,
                  candidates: displayGroupChoices(context.ordinalResolutionIssue.groups).map(({ group, label }) => ({
                    groupRef: group.groupRef,
                    label,
                    hasPosition: Boolean(group.outcome.products[context.ordinalResolutionIssue!.position]),
                  })),
                },
              },
            }
          : context.displayedProductReference?.selectionOnly
          ? { ...context.displayedProductReference.result, turnId: input.turnId, stateActions: { pauseIntentIds: [], resumeIntentIds: [], selectedProduct: true } }
        : await this.run({
            ...input,
            previous: context.previous,
            pausedOutcomes: context.pausedOutcomes,
            ...(context.displayedProductReference ? {
              displayedProductReference: {
                referenceId: context.displayedProductReference.referenceId,
                intentId: context.displayedProductReference.intentId,
                position: context.displayedProductReference.position,
                product: context.displayedProductReference.product,
              },
            } : {}),
            observeDecision: (event) => observedDecisions.push(event),
          })));
      if (result.status === 'queued' || result.status === 'running') {
        throw new Error('The orchestration runner returned a non-terminal result.');
      }
      const completedAt = this.now();
      const conversationState = nextConversationMemoryState({
        conversationId: input.conversationId,
        turnId: input.turnId,
        completedAt,
        context,
        result,
      });
      const catalogBoundaries = observedDecisions.filter(
        (event): event is Extract<OrchestrationDecisionDiagnostic, { stage: 'catalog_boundary' }> =>
          event.stage === 'catalog_boundary',
      );
      const catalogSearches = observedDecisions.filter(
        (event): event is Extract<OrchestrationDecisionDiagnostic, { stage: 'catalog_search' }> =>
          event.stage === 'catalog_search',
      );
      const toolRuns = catalogBoundaries.length > 0 ? catalogBoundaries.map((event, index) => ({
        id: `${input.turnId}:catalog:${index}`,
        turnId: input.turnId,
        toolName: event.operation,
        attempt: event.attempt,
        input: { method: event.method, pathname: event.pathname, query: event.query },
        outputReference: { status: event.status, durationMs: event.durationMs, products: event.products },
        ...(event.errorCode ? { errorCode: event.errorCode } : {}),
        startedAt: completedAt,
        completedAt,
      })) : catalogSearches.map((event, index) => {
        const outcome = result.outcomes.find(({ intent }) => intent.id === event.intentId);
        return {
          id: `${input.turnId}:catalog:${index}`,
          turnId: input.turnId,
          intentId: event.intentId,
          toolName: event.category ? 'listCategoryProducts' : 'searchCatalog',
          attempt: 1,
          input: event.category ? { category: event.category, filters: event.filters } : { filters: event.filters },
          outputReference: { productIds: outcome?.products.map(({ product }) => product.id) ?? [] },
          ...(outcome?.error ? { errorCode: outcome.error.code } : {}),
          startedAt: completedAt,
          completedAt,
        };
      });
      const decisionEvents = [
        {
          stage: 'context_built',
          payload: {
            stateRevision: context.stateRevision,
            previousTurnId: context.previous?.turnId,
            previousIntentIds: context.previous?.outcomes.map(({ intent }) => intent.id) ?? [],
            currentFocusIntentId: context.currentFocusIntentId,
            selectedDisplayedPosition: context.displayedProductReference?.position,
          },
        },
        ...observedDecisions.map((event) => ({ stage: event.stage, payload: event })),
        {
          stage: 'state_transition',
          payload: {
            operation: conversationState.lastOperation,
            revision: conversationState.revision,
            currentFocusIntentId: conversationState.currentFocusIntentId,
            activeIntentIds: conversationState.activeResult?.outcomes.map(({ intent }) => intent.id) ?? [],
          },
        },
      ].map(({ stage, payload }, sequence) => ({
        id: `${input.turnId}:decision:${sequence}`,
        conversationId: input.conversationId,
        turnId: input.turnId,
        sequence,
        stage,
        payload,
        createdAt: completedAt,
      }));
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
        toolRuns,
        productSnapshots: result.outcomes
          .filter(({ products }) => products.length > 0)
          .map(({ intent, products }) => ({
            id: `${input.turnId}:products:${intent.id}`,
            turnId: input.turnId,
            intentId: intent.id,
            products: products.map(({ product }) => product),
            createdAt: completedAt,
          })),
        conversationState,
        decisionEvents,
        result,
      });
      return result;
    } catch (error) {
      const current = this.repository.getTurn(input.turnId);
      if (current?.status === 'running' || current?.status === 'queued') {
        const failure = AgentBoundaryError.isInstance(error)
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
