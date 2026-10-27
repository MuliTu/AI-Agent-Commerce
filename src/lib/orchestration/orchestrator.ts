import { z } from 'zod';
import { AgentBoundaryError, createCatalogToolHandlers, type AgentCatalogClient } from '../agent';
import type { Constraints, ShoppingIntent, TurnStatus } from '../domain/contracts';
import { rankCatalogProducts } from '../ranking';
import { executeWithRetry, type RetryOptions } from '../reliability';
import {
  extractedTurnPlanSchema,
  type ExtractedIntent,
  type IntentExtractor,
  type IntentOutcome,
  type OrchestrationResult,
} from './contracts';
import { evaluateClarification, selectTurnClarification } from './clarification';

const shopperPromptSchema = z.string().trim().min(1);

export class OrchestrationError extends Error {
  readonly code: 'invalid_prompt' | 'invalid_plan' | 'invalid_refinement';

  constructor(code: OrchestrationError['code'], message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'OrchestrationError';
    this.code = code;
  }
}

export type IntentOrchestratorOptions = {
  catalog: AgentCatalogClient;
  extractIntents: IntentExtractor;
  resultLimit?: number;
  retryOptions?: RetryOptions;
};

export type OrchestrateTurnInput = {
  turnId: string;
  conversationId: string;
  prompt: string;
  previous?: OrchestrationResult;
  retryIntentId?: string;
};

function mergeConstraints(previous: Constraints | undefined, update: Constraints): Constraints {
  return { ...previous, ...update };
}

function nextIntentId(turnId: string, used: Set<string>): string {
  let sequence = 1;
  while (used.has(`${turnId}:intent:${sequence}`)) sequence += 1;
  return `${turnId}:intent:${sequence}`;
}

function resolveIntent(
  draft: ExtractedIntent,
  turnId: string,
  previous: Map<string, IntentOutcome>,
  used: Set<string>,
): ShoppingIntent {
  const prior = draft.intentId ? previous.get(draft.intentId) : undefined;
  if (draft.intentId && !prior) {
    throw new OrchestrationError(
      'invalid_refinement',
      `Intent ${draft.intentId} is not part of the previous conversation state.`,
    );
  }
  const id = prior?.intent.id ?? nextIntentId(turnId, used);
  if (used.has(id)) {
    throw new OrchestrationError('invalid_plan', `Intent ${id} appears more than once in the turn plan.`);
  }
  const goal = draft.goal ?? prior?.intent.goal;
  const query = draft.query ?? prior?.intent.query;
  if (!goal || !query) {
    throw new OrchestrationError('invalid_plan', 'New intents require both a goal and a catalog query.');
  }
  used.add(id);
  return {
    id,
    goal,
    query,
    constraints: mergeConstraints(prior?.intent.constraints, draft.constraints),
    status: draft.status,
  };
}

function scopedFailure(intent: ShoppingIntent, error: unknown, terminal = false): IntentOutcome {
  if (error instanceof AgentBoundaryError) {
    return {
      intent: { ...intent, status: 'failed' },
      products: [],
      error: { code: error.code, message: error.message, retryable: terminal ? false : error.retryable },
    };
  }
  return {
    intent: { ...intent, status: 'failed' },
    products: [],
    error: {
      code: 'catalog_unavailable',
      message: 'The catalog request could not be completed.',
      retryable: false,
    },
  };
}

function turnStatus(outcomes: IntentOutcome[]): TurnStatus {
  const completed = outcomes.filter(({ intent }) => intent.status === 'completed').length;
  const failed = outcomes.filter(({ intent }) => intent.status === 'failed').length;
  const waiting = outcomes.filter(({ intent }) => intent.status === 'needs_clarification').length;
  if (completed === outcomes.length) return 'completed';
  if (failed === outcomes.length) return 'failed';
  if (completed > 0 && (failed > 0 || waiting > 0)) return 'partial';
  return 'running';
}

export function createIntentOrchestrator(options: IntentOrchestratorOptions) {
  const handlers = createCatalogToolHandlers(options.catalog);
  const limit = z.number().int().min(1).max(20).parse(options.resultLimit ?? 5);

  return {
    async run(input: OrchestrateTurnInput): Promise<OrchestrationResult> {
      const promptResult = shopperPromptSchema.safeParse(input.prompt);
      if (!promptResult.success) {
        throw new OrchestrationError('invalid_prompt', 'A nonempty shopper prompt is required.');
      }
      if (!input.turnId.trim() || !input.conversationId.trim()) {
        throw new OrchestrationError('invalid_prompt', 'Turn and conversation identities are required.');
      }

      const previousOutcomes = input.previous?.outcomes ?? [];
      const previous = new Map(previousOutcomes.map((outcome) => [outcome.intent.id, outcome]));
      let plan;
      if (input.retryIntentId) {
        const retry = previous.get(input.retryIntentId);
        if (!retry || retry.intent.status !== 'failed' || !retry.error?.retryable) {
          throw new OrchestrationError('invalid_refinement', 'Only a retryable failed intent from the previous turn can be retried.');
        }
        plan = extractedTurnPlanSchema.parse({
          response: `I retried ${retry.intent.goal} without changing the other shopping goals.`,
          intents: [{ intentId: retry.intent.id, constraints: retry.intent.constraints }],
        });
      } else {
        try {
          const rawPlan = await options.extractIntents({
            prompt: promptResult.data,
            previousIntents: previousOutcomes.map(({ intent }) => ({ ...intent })),
          });
          plan = extractedTurnPlanSchema.parse(rawPlan);
        } catch (error) {
          if (error instanceof AgentBoundaryError) throw error;
          if (error instanceof OrchestrationError) throw error;
          throw new OrchestrationError('invalid_plan', 'The model returned an invalid intent plan.', error);
        }
      }

      const used = new Set<string>();
      const planned = plan.intents.map((draft) => resolveIntent(draft, input.turnId, previous, used));
      const plannedIds = new Set(planned.map(({ id }) => id));
      const preserved = await Promise.all(previousOutcomes
        .filter(({ intent }) => !plannedIds.has(intent.id))
        .map(async (outcome): Promise<IntentOutcome> => {
          for (const ranked of outcome.products) {
            let trusted;
            try {
              trusted = await handlers.getProduct({ id: ranked.product.id });
            } catch (error) {
              throw new OrchestrationError('invalid_refinement', 'Previous catalog results could not be revalidated.', error);
            }
            if (JSON.stringify(trusted) !== JSON.stringify(ranked.product)) {
              throw new OrchestrationError('invalid_refinement', 'Previous catalog results do not match the trusted catalog.');
            }
          }
          if (outcome.intent.status !== 'needs_clarification' || outcome.clarification) return outcome;
          return {
            ...outcome,
            clarification: evaluateClarification(outcome.intent, outcome.products),
          };
        }));
      const settled = await Promise.all(planned.map(async (intent): Promise<IntentOutcome> => {
        if (intent.status === 'needs_clarification') {
          return { intent, products: [], clarification: evaluateClarification(intent, []) };
        }
        try {
          const search = () => handlers.searchCatalog({ query: intent.query, limit: 20 });
          const result = input.retryIntentId === intent.id
            ? await executeWithRetry(search, options.retryOptions)
            : await search();
          const products = rankCatalogProducts(result.products, {
            query: intent.query,
            constraints: intent.constraints,
            limit,
          });
          const clarification = evaluateClarification(intent, products);
          if (clarification) {
            return {
              intent: { ...intent, status: 'needs_clarification' },
              products: [],
              clarification,
            };
          }
          return { intent: { ...intent, status: 'completed' }, products };
        } catch (error) {
          return scopedFailure(intent, error, input.retryIntentId === intent.id);
        }
      }));
      const outcomes = selectTurnClarification([...preserved, ...settled]);
      return {
        turnId: input.turnId,
        status: turnStatus(outcomes),
        response: plan.response,
        outcomes,
      };
    },
  };
}
