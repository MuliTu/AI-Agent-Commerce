import { z } from 'zod';
import { AgentBoundaryError, createCatalogToolHandlers, type AgentCatalogClient } from '../agent';
import type { Constraints, ShoppingIntent, TurnStatus } from '../domain/contracts';
import { rankCatalogProducts } from '../ranking';
import { executeWithRetry, type RetryOptions } from '../reliability';
import {
  extractedTurnPlanSchema,
  type ClarificationAnswer,
  type ExtractedIntent,
  type IntentExtractor,
  type IntentOutcome,
  type OrchestrationResult,
} from './contracts';
import { evaluateClarification, selectTurnClarification } from './clarification';
import {
  intentHasExplicitUsdBudget,
  intentHasUnsupportedIlsBudgetForCategory,
  intentIsOutsideProductCatalog,
  intentRequestsCheapOrdering,
  resolveCatalogCategory,
} from './category-resolution';

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
  clarification?: ClarificationAnswer;
};

function clarificationUpdate(answer: ClarificationAnswer, prior: IntentOutcome): ExtractedIntent {
  const clarification = prior.clarification;
  if (prior.intent.status !== 'needs_clarification'
    || !clarification
    || clarification.field !== answer.field
    || !clarification.options.includes(answer.value)) {
    throw new OrchestrationError('invalid_refinement', 'The clarification answer does not match the active question.');
  }

  if (answer.field === 'maxPrice' || answer.field === 'minRating') {
    const numeric = Number(answer.value.match(/[0-9]+(?:\.[0-9]+)?/)?.[0]);
    if (!Number.isFinite(numeric)) {
      throw new OrchestrationError('invalid_refinement', 'The clarification answer does not contain a valid number.');
    }
    return { intentId: prior.intent.id, constraints: { [answer.field]: numeric }, status: 'ready' };
  }
  if (answer.field === 'category') {
    return {
      intentId: prior.intent.id,
      query: answer.value.toLocaleLowerCase('en-US'),
      constraints: { category: answer.value.toLocaleLowerCase('en-US') },
      status: 'ready',
    };
  }
  if (answer.field === 'inStock') {
    return {
      intentId: prior.intent.id,
      constraints: { inStock: !/^no\b/i.test(answer.value) },
      status: 'ready',
    };
  }
  if (answer.field === 'brands' || answer.field === 'requiredTags') {
    return { intentId: prior.intent.id, constraints: { [answer.field]: [answer.value] }, status: 'ready' };
  }
  const query = answer.value === 'Use fewer search terms'
    ? prior.intent.query.split(/\s+/).filter(Boolean).slice(0, 1).join(' ')
    : prior.intent.goal;
  return { intentId: prior.intent.id, query, constraints: {}, status: 'ready' };
}

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

function scopedFailure(intent: ShoppingIntent, error: unknown, terminal = false, isHebrew = false): IntentOutcome {
  if (AgentBoundaryError.isInstance(error)) {
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
      message: isHebrew ? 'לא ניתן היה להשלים את הבקשה לקטלוג.' : 'The catalog request could not be completed.',
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
  if (waiting > 0 || (completed > 0 && failed > 0)) return 'partial';
  return 'running';
}

function shopperSafeResponse(response: string, intentCount: number): string {
  const normalized = response.trim();
  const unusable = normalized.length < 8
    || /^\.?json\.?$/iu.test(normalized)
    || /^[\[{]/u.test(normalized);
  if (!unusable) return normalized;
  return intentCount > 1
    ? 'I searched the catalog separately for each of your shopping goals.'
    : 'I searched the catalog for your shopping request.';
}

export function createIntentOrchestrator(options: IntentOrchestratorOptions) {
  const handlers = createCatalogToolHandlers(options.catalog);
  if (options.resultLimit !== undefined) z.number().int().min(1).max(1_000).parse(options.resultLimit);

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
      if (input.retryIntentId && input.clarification) {
        throw new OrchestrationError('invalid_refinement', 'A turn cannot retry and clarify at the same time.');
      }
      if (input.retryIntentId) {
        const retry = previous.get(input.retryIntentId);
        if (!retry || retry.intent.status !== 'failed' || !retry.error?.retryable) {
          throw new OrchestrationError('invalid_refinement', 'Only a retryable failed intent from the previous turn can be retried.');
        }
        const isHebrew = /[\u0590-\u05ff]/u.test(promptResult.data);
        plan = extractedTurnPlanSchema.parse({
          response: isHebrew ? `ניסיתי שוב לחפש ${retry.intent.goal} בלי לשנות את שאר בקשות הקנייה.` : `I retried ${retry.intent.goal} without changing the other shopping goals.`,
          intents: [{ intentId: retry.intent.id, constraints: retry.intent.constraints }],
        });
      } else if (input.clarification) {
        const prior = previous.get(input.clarification.intentId);
        if (!prior) {
          throw new OrchestrationError('invalid_refinement', 'The clarification intent is not part of the previous conversation state.');
        }
        const isHebrew = /[\u0590-\u05ff]/u.test(promptResult.data);
        plan = extractedTurnPlanSchema.parse({
          response: isHebrew ? `החלתי את ${input.clarification.value} על ${prior.intent.goal}.` : `I applied ${input.clarification.value} to ${prior.intent.goal}.`,
          intents: [clarificationUpdate(input.clarification, prior)],
        });
      } else {
        try {
          const rawPlan = await options.extractIntents({
            prompt: promptResult.data,
            previousIntents: previousOutcomes.map(({ intent }) => ({ ...intent })),
          });
          plan = extractedTurnPlanSchema.parse(rawPlan);
        } catch (error) {
          if (AgentBoundaryError.isInstance(error)) throw error;
          if (error instanceof OrchestrationError) throw error;
          throw new OrchestrationError('invalid_plan', 'The model returned an invalid intent plan.', error);
        }
      }

      const used = new Set<string>();
      const availableCategories = (await handlers.listCategories()).categories;
      const planned = plan.intents.map((draft) => {
        const draftContext = `${draft.goal ?? ''} ${draft.query ?? ''} ${draft.constraints.category ?? ''}`;
        const outsideProductCatalog = intentIsOutsideProductCatalog(
          promptResult.data,
          draftContext,
          plan.intents.length,
        );
        const safeDraft = outsideProductCatalog ? {
          ...draft,
          intentId: undefined,
          goal: draft.goal ?? 'Search outside the product catalog',
          query: draft.query ?? promptResult.data,
          constraints: {},
          status: 'ready' as const,
        } : draft;
        const intent = resolveIntent(safeDraft, input.turnId, previous, used);
        const requestedCategory = intent.constraints.category;
        const category = outsideProductCatalog ? undefined : resolveCatalogCategory(
          requestedCategory,
          `${intent.goal} ${intent.query}`,
          availableCategories,
        );
        const context = `${intent.goal} ${intent.query}`;
        const cheapOrdering = intentRequestsCheapOrdering(
          promptResult.data, context, plan.intents.length, category, availableCategories,
        );
        const explicitUsdBudget = intentHasExplicitUsdBudget(
          promptResult.data, context, plan.intents.length, category, availableCategories,
        );
        const preservesPriorBudget = safeDraft.intentId !== undefined
          && previous.get(safeDraft.intentId)?.intent.constraints.maxPrice !== undefined;
        return {
          ...intent,
          constraints: {
            ...intent.constraints,
            ...(cheapOrdering ? { sort: 'price_asc' as const } : {}),
            ...(!explicitUsdBudget && !preservesPriorBudget ? { maxPrice: undefined } : {}),
            ...(category ? { category } : { category: undefined }),
          },
          status: outsideProductCatalog || (requestedCategory !== undefined && !category)
            ? 'failed' as const
            : intent.status,
        };
      });
      const plannedIds = new Set(planned.map(({ id }) => id));
      const continuesPreviousIntent = planned.some(({ id }) => previous.has(id));
      const shouldPreserveSiblingIntents = Boolean(input.retryIntentId || input.clarification || continuesPreviousIntent);
      const preserved = await Promise.all((shouldPreserveSiblingIntents ? previousOutcomes : [])
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
        if (intent.status === 'failed' && !intent.constraints.category && !intentIsOutsideProductCatalog(
          promptResult.data,
          `${intent.goal} ${intent.query}`,
          planned.length,
        )) {
          return {
            intent,
            products: [],
            error: {
              code: 'unknown_catalog_category',
              message: /[\u0590-\u05ff]/u.test(promptResult.data)
                ? 'לא מצאתי קטגוריית קטלוג מתאימה לבקשה הזאת, ולכן לא אנחש מוצר אחר.'
                : 'I could not match this request to a catalog category, so I will not guess a different product.',
              retryable: false,
            },
          };
        }
        if (intent.status === 'failed' && intentIsOutsideProductCatalog(
          promptResult.data,
          `${intent.goal} ${intent.query}`,
          planned.length,
        )) {
          return {
            intent,
            products: [],
            error: {
              code: 'outside_product_catalog',
              message: /[\u0590-\u05ff]/u.test(promptResult.data)
                ? 'אני יכול לחפש מוצרים בקטלוג, אבל לא לחפש או להזמין טיסות.'
                : 'I can search products in this catalog, but I can’t search or book flights.',
              retryable: false,
            },
          };
        }
        if (intentHasUnsupportedIlsBudgetForCategory(
          promptResult.data,
          `${intent.goal} ${intent.query} ${intent.constraints.category ?? ''}`,
          planned.length,
          intent.constraints.category,
          availableCategories,
        )) {
          return {
            intent: { ...intent, constraints: { ...intent.constraints, maxPrice: undefined }, status: 'failed' },
            products: [],
            error: {
              code: 'unsupported_currency',
              message: /[\u0590-\u05ff]/u.test(promptResult.data) ? 'מחירי הקטלוג הם בדולר ולא ניתן לבצע המרת מטבע. יש לציין את התקציב לבקשה הזאת בדולר.' : 'Catalog prices are in USD and currency conversion is not available. Please provide this intent\'s budget in USD.',
              retryable: false,
            },
          };
        }
        if (intent.status === 'needs_clarification' && !intent.constraints.category) {
          return { intent, products: [], clarification: evaluateClarification(intent, []) };
        }
        try {
          const search = () => intent.constraints.category
            ? handlers.listCategoryProducts(intent.constraints.category)
            : handlers.searchCatalog({ query: intent.query, limit: 20 });
          const result = input.retryIntentId === intent.id
            ? await executeWithRetry(search, options.retryOptions)
            : await search();
          const products = rankCatalogProducts(result.products, {
            query: intent.query,
            constraints: intent.constraints,
            limit: undefined,
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
          return scopedFailure(intent, error, input.retryIntentId === intent.id, /[\u0590-\u05ff]/u.test(promptResult.data));
        }
      }));
      const outcomes = selectTurnClarification([...preserved, ...settled]);
      const hasOutsideCatalogGoal = outcomes.some(({ error }) => error?.code === 'outside_product_catalog');
      return {
        turnId: input.turnId,
        status: turnStatus(outcomes),
        response: hasOutsideCatalogGoal
          ? outcomes.length === 1
            ? /[\u0590-\u05ff]/u.test(promptResult.data)
              ? 'אני יכול לעזור עם מוצרים מהקטלוג, אבל טיסות אינן כלולות בו.'
              : 'I can help with products from this catalog, but flights are outside it.'
            : /[\u0590-\u05ff]/u.test(promptResult.data)
              ? 'טיפלתי בחיפושי המוצרים האפשריים. טיסות אינן חלק מקטלוג המוצרים.'
              : 'I handled the product searches I could. Flights are outside this product catalog.'
          : shopperSafeResponse(plan.response, outcomes.length),
        outcomes,
      };
    },
  };
}
