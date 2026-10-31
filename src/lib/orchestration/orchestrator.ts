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
import { analyzeConstraintSemantics, type ConstraintSemanticIssue } from './constraint-semantics';
import {
  filterProductsByFeatureEvidence,
  requestedFeatureEvidence,
  requestedFeatureEvidenceForIntent,
} from './feature-evidence';
import { decideFollowUpTargets, inspectPlanCategoryCoverage, isExclusiveNamedFollowUp } from './plan-integrity';
import { classifyIntentRequest } from './request-classification';
import {
  intentHasExplicitUsdBudget,
  intentHasUnsupportedIlsBudgetForCategory,
  intentIsOutsideProductCatalog,
  intentRequestsCheapOrdering,
  explicitUsdMaxPrice,
  isConstraintOnlyFollowUp,
  isCatalogCategoryGrounded,
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

function shopperSafeResponse(outcomes: IntentOutcome[], isHebrew: boolean): string {
  const unsupportedConstraint = outcomes.find(({ error }) => error?.code === 'unsupported_constraint');
  if (unsupportedConstraint?.error) return unsupportedConstraint.error.message;
  const unavailableEvidence = outcomes.find(({ error }) => error?.code === 'catalog_evidence_unavailable');
  if (unavailableEvidence) {
    return isHebrew
      ? 'הקטלוג אינו מציין את התכונה שביקשת, ולכן לא אציג מוצרים כלליים כאילו היא אומתה.'
      : 'The catalog does not state the requested feature, so I won’t present generic products as verified matches.';
  }
  const unknownCategory = outcomes.filter(({ error }) => error?.code === 'unknown_catalog_category').length;
  const outsideCatalog = outcomes.filter(({ error }) => error?.code === 'outside_product_catalog').length;
  const supported = outcomes.length - unknownCategory - outsideCatalog;
  if (unknownCategory > 0) {
    if (supported > 0 || outsideCatalog > 0) {
      const unknownMessage = isHebrew
        ? 'לא הצלחתי להתאים את בקשת המוצר האחרת לקטגוריה בקטלוג, ולכן לא החלפתי אותה במוצר לא קשור.'
        : 'I could not match the other product request to a catalog category, so I did not substitute an unrelated product.';
      if (outsideCatalog > 0) {
        return isHebrew
          ? `${unknownMessage} בקשה נוספת הייתה מחוץ לחיפוש המוצרים שבו אני יכול לעזור.`
          : `${unknownMessage} Another request was outside the product shopping I can help with.`;
      }
      return isHebrew
        ? `טיפלתי בבקשות המוצרים שיכולתי. ${unknownMessage}`
        : `I handled the product requests I could. ${unknownMessage}`;
    }
    return isHebrew
      ? 'לא הצלחתי להתאים את בקשת המוצר לקטגוריה בקטלוג, ולכן לא אחליף אותה במוצר לא קשור. אפשר לנסות סוג מוצר אחר שנמצא בקטלוג.'
      : 'I could not match that product request to a catalog category, so I will not substitute an unrelated product. Try another product type available in the catalog.';
  }
  if (outsideCatalog > 0) {
    if (supported > 0) {
      return isHebrew
        ? 'טיפלתי בבקשות המוצרים שיכולתי. בשאר הנושאים אני מתמקד רק במוצרים מהקטלוג — אשמח לעזור למצוא בו מוצר מתאים.'
        : 'I handled the product requests I could. For everything else, I focus only on products in this catalog, and I’d be happy to help you find one.';
    }
    return isHebrew
      ? 'אני מתמקד במוצרים מהקטלוג ולא יכול לענות על הנושא הזה. אשמח לעזור לך למצוא מוצר מתאים בקטלוג.'
      : 'I focus on products in this catalog, so I can’t answer that request. I’d be happy to help you find a suitable product here.';
  }
  if (outcomes.some(({ intent }) => intent.status === 'needs_clarification')) {
    return isHebrew
      ? 'אני צריך עוד פרט אחד כדי להמשיך בחיפוש בקטלוג.'
      : 'I need one more detail to continue the catalog search.';
  }
  const empty = outcomes.find(({ intent, products }) =>
    intent.status === 'completed' && products.length === 0 && intent.constraints.category);
  if (empty) {
    const category = empty.intent.constraints.category!.replace(/-/g, ' ');
    const budget = empty.intent.constraints.maxPrice;
    return isHebrew
      ? `החיפוש הושלם, אבל אין בקטלוג ${category}${budget === undefined ? '' : ` עד $${budget}`} שמתאימים לכל התנאים. אפשר לשנות תנאי ואחפש שוב.`
      : `The search completed, but the catalog has no ${category}${budget === undefined ? '' : ` under $${budget}`} matching every filter. Try relaxing a constraint and I’ll search again.`;
  }
  return outcomes.length > 1
    ? isHebrew
      ? 'חיפשתי בקטלוג בנפרד עבור כל אחת מבקשות הקנייה שלך.'
      : 'I searched the catalog separately for each of your shopping goals.'
    : isHebrew
      ? 'חיפשתי בקטלוג עבור בקשת הקנייה שלך.'
      : 'I searched the catalog for your shopping request.';
}

function constraintIssueMessage(issue: ConstraintSemanticIssue, isHebrew: boolean): string {
  switch (issue.kind) {
    case 'brand_exclusion':
      return isHebrew
        ? 'סינון שמחריג מותג אינו נתמך כרגע. אפשר לציין אילו מותגים כן לכלול.'
        : `Brand exclusion is not supported${issue.excludedBrands?.length ? ` (${issue.excludedBrands.join(', ')})` : ''}. Please name brands you do want included.`;
    case 'minimum_price':
      return isHebrew
        ? 'סינון לפי מחיר מינימום אינו נתמך כרגע. אפשר לציין מחיר מרבי.'
        : 'Minimum-price filtering is not supported. Please provide a maximum price instead.';
    case 'contradictory_price':
      return isHebrew
        ? `מחיר המינימום $${issue.minPrice} סותר את המחיר המרבי $${issue.maxPrice}. איזה גבול תרצה לשנות?`
        : `The minimum price of $${issue.minPrice} conflicts with the maximum price of $${issue.maxPrice}. Which bound should I change?`;
    case 'aggregate_budget':
      return isHebrew
        ? 'תקציב משותף למספר מוצרים אינו נתמך כרגע. אפשר לציין תקציב מרבי נפרד לכל מוצר.'
        : 'A combined budget across products is not supported. Please provide a separate maximum price for each product.';
    case 'ambiguous_multi_intent_budget':
      return isHebrew
        ? 'לא ברור לאיזה מוצר התקציב מתייחס. לאיזה מוצר להחיל אותו?'
        : 'It is unclear which product the budget applies to. Which product should I update?';
  }
}

function evidenceAwareResponse(prompt: string, outcomes: IntentOutcome[], isHebrew: boolean): string {
  const safe = shopperSafeResponse(outcomes, isHebrew);
  if (outcomes.some(({ error, intent }) => error || intent.status !== 'completed')) return safe;
  const requirements = requestedFeatureEvidence(prompt).map(({ label }) => label);
  if (requirements.includes('camera capabilities') && /\bgood\s+camera\b/iu.test(prompt)) {
    return isHebrew
      ? 'הצגתי רק מוצרים שהטקסט המהימן בקטלוג מציין בהם יכולות מצלמה; הקטלוג אינו מודד באופן אובייקטיבי את איכות המצלמה.'
      : 'I returned only products whose trusted catalog text mentions camera capabilities; the catalog does not objectively verify camera quality.';
  }
  if (requirements.includes('camera capabilities') || requirements.includes('evening use')) {
    return isHebrew
      ? 'הצגתי רק מוצרים שהטקסט המהימן בקטלוג מציין בהם את השימוש או היכולת שביקשת.'
      : 'I returned only products whose trusted catalog text mentions the requested capability or use case.';
  }
  return safe;
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
      const availableCategories = (await handlers.listCategories()).categories;
      if (!input.retryIntentId && !input.clarification) {
        const semantics = analyzeConstraintSemantics(promptResult.data, availableCategories);
        const blockingIssues = semantics.issues;
        if (blockingIssues.length > 0) {
          const isHebrew = /[\u0590-\u05ff]/u.test(promptResult.data);
          const message = blockingIssues.map((issue) => constraintIssueMessage(issue, isHebrew)).join(' ');
          const intent: ShoppingIntent = {
            id: `${input.turnId}:intent:1`,
            goal: isHebrew ? 'הבהרת תנאי קנייה' : 'Clarify unsupported shopping constraints',
            query: promptResult.data,
            constraints: {},
            status: 'failed',
          };
          return {
            turnId: input.turnId,
            status: 'failed',
            response: message,
            outcomes: [{
              intent,
              products: [],
              error: { code: 'unsupported_constraint', message, retryable: false },
            }],
          };
        }
      }
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

      const coverage = inspectPlanCategoryCoverage(
        promptResult.data,
        plan.intents,
        availableCategories,
        resolveCatalogCategory,
      );
      if (coverage.requiresRepair) {
        const remainingDrafts = [...plan.intents];
        plan = {
          ...plan,
          intents: coverage.explicitCategories.map((category) => {
            const matchingIndex = remainingDrafts.findIndex((draft) => resolveCatalogCategory(
              draft.constraints.category,
              `${draft.goal ?? ''} ${draft.query ?? ''}`,
              availableCategories,
            ) === category);
            const [draft] = remainingDrafts.splice(matchingIndex >= 0 ? matchingIndex : 0, 1);
            return {
              ...draft,
              intentId: undefined,
              goal: draft?.goal ?? `Find ${category.replace(/-/g, ' ')}`,
              query: category,
              constraints: { ...draft?.constraints, category },
              status: 'ready' as const,
            };
          }),
        };
      }

      const used = new Set<string>();
      const previousProductOutcomes = previousOutcomes.filter(({ intent, error }) =>
        intent.constraints.category
        && error?.code !== 'outside_product_catalog'
        && error?.code !== 'unknown_catalog_category');
      const constraintOnlyFollowUp = isConstraintOnlyFollowUp(promptResult.data, availableCategories);
      const deterministicBudget = explicitUsdMaxPrice(promptResult.data);
      const followUpTarget = decideFollowUpTargets({
        prompt: promptResult.data,
        previousIntents: previousProductOutcomes.map(({ intent }) => intent),
        availableCategories,
        resolveCategory: resolveCatalogCategory,
      });
      const exclusiveNamedFollowUp = followUpTarget.kind === 'single' && isExclusiveNamedFollowUp(
        promptResult.data,
        availableCategories,
        resolveCatalogCategory,
      );
      const drafts: ExtractedIntent[] = followUpTarget.kind === 'clarify'
        ? [{
          goal: /[\u0590-\u05ff]/u.test(promptResult.data) ? 'בחירת מוצר לעדכון' : 'Choose which product to refine',
          query: promptResult.data,
          constraints: deterministicBudget === undefined ? {} : { maxPrice: deterministicBudget },
          status: 'needs_clarification' as const,
        }]
        : followUpTarget.kind === 'all' && plan.intents.length === 1
          ? followUpTarget.intentIds.map((intentId) => ({
            intentId,
            status: plan.intents[0].status,
            constraints: {
              ...plan.intents[0].constraints,
              ...(deterministicBudget === undefined ? {} : { maxPrice: deterministicBudget }),
            },
          }))
          : followUpTarget.kind === 'single' && plan.intents.length === 1
            ? (() => {
              const constraintUpdate = { ...plan.intents[0].constraints };
              delete constraintUpdate.category;
              return [{
                ...plan.intents[0],
                intentId: followUpTarget.intentId,
                constraints: {
                  ...constraintUpdate,
                  ...(deterministicBudget === undefined ? {} : { maxPrice: deterministicBudget }),
                },
              }];
            })()
            : constraintOnlyFollowUp && plan.intents.length === 1 && !plan.intents[0].intentId
        ? previousProductOutcomes.length === 1
          ? (() => {
            const constraintUpdate = { ...plan.intents[0].constraints };
            delete constraintUpdate.category;
            return [{
              ...plan.intents[0],
              intentId: previousProductOutcomes[0].intent.id,
              goal: undefined,
              query: undefined,
              constraints: {
                ...constraintUpdate,
                ...(deterministicBudget === undefined ? {} : { maxPrice: deterministicBudget }),
              },
            }];
          })()
          : previousProductOutcomes.length > 1
            ? [{
              goal: /[\u0590-\u05ff]/u.test(promptResult.data) ? 'בחירת מוצר לעדכון' : 'Choose which product to refine',
              query: promptResult.data,
              constraints: deterministicBudget === undefined ? {} : { maxPrice: deterministicBudget },
              status: 'needs_clarification' as const,
            }]
            : plan.intents
        : plan.intents;
      const planned = drafts.map((draft) => {
        const draftContext = `${draft.goal ?? ''} ${draft.query ?? ''} ${draft.constraints.category ?? ''}`;
        const outsideProductCatalog = classifyIntentRequest({
          prompt: promptResult.data,
          intentContext: draftContext,
          intentCount: drafts.length,
          availableCategories,
        }) === 'outside_catalog' || intentIsOutsideProductCatalog(promptResult.data, draftContext, drafts.length);
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
        const explicitPromptCategory = drafts.length === 1
          ? resolveCatalogCategory(undefined, promptResult.data, availableCategories)
          : undefined;
        const resolvedCategory = outsideProductCatalog ? undefined : resolveCatalogCategory(
          requestedCategory,
          `${intent.goal} ${intent.query}`,
          availableCategories,
        );
        const category = explicitPromptCategory ?? (resolvedCategory && (previous.has(intent.id) || isCatalogCategoryGrounded(
          promptResult.data,
          `${intent.goal} ${intent.query}`,
          resolvedCategory,
          availableCategories,
        )) ? resolvedCategory : undefined);
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
      const shouldPreserveSiblingIntents = Boolean(
        input.retryIntentId || input.clarification || (continuesPreviousIntent && !exclusiveNamedFollowUp),
      );
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
            clarification: evaluateClarification(outcome.intent, outcome.products, availableCategories),
          };
        }));
      const settled = await Promise.all(planned.map(async (intent): Promise<IntentOutcome> => {
        const finalClassification = classifyIntentRequest({
          prompt: promptResult.data,
          intentContext: `${intent.goal} ${intent.query}`,
          intentCount: planned.length,
          availableCategories,
        });
        const finalOutsideCatalog = finalClassification === 'outside_catalog' || intentIsOutsideProductCatalog(
          promptResult.data,
          `${intent.goal} ${intent.query}`,
          planned.length,
        );
        if (intent.status === 'failed' && !intent.constraints.category && !finalOutsideCatalog) {
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
        if (intent.status === 'failed' && finalOutsideCatalog) {
          return {
            intent,
            products: [],
            error: {
              code: 'outside_product_catalog',
              message: /[\u0590-\u05ff]/u.test(promptResult.data)
                ? 'אני מתמקד במוצרים מהקטלוג ולא יכול לטפל בבקשה הזאת.'
                : 'I focus on products in this catalog and cannot handle this request.',
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
          const relevantCategories = constraintOnlyFollowUp && previousProductOutcomes.length > 1
            ? [...new Set(previousProductOutcomes.flatMap(({ intent: previousIntent }) =>
              previousIntent.constraints.category ? [previousIntent.constraints.category] : []))]
            : availableCategories;
          return { intent, products: [], clarification: evaluateClarification(intent, [], relevantCategories) };
        }
        try {
          const search = () => intent.constraints.category
            ? handlers.listCategoryProducts(intent.constraints.category)
            : handlers.searchCatalog({ query: intent.query, limit: 20 });
          const result = input.retryIntentId === intent.id
            ? await executeWithRetry(search, options.retryOptions)
            : await search();
          const featureRequirements = requestedFeatureEvidenceForIntent({
            prompt: promptResult.data,
            intentContext: `${intent.goal} ${intent.query}`,
            category: intent.constraints.category,
            intentCount: planned.length,
            availableCategories,
          });
          const evidenceProducts = filterProductsByFeatureEvidence(result.products, featureRequirements);
          const products = rankCatalogProducts(evidenceProducts, {
            query: intent.query,
            constraints: intent.constraints,
            limit: undefined,
          });
          if (featureRequirements.length > 0 && products.length === 0) {
            return {
              intent: { ...intent, status: 'completed' },
              products: [],
              error: {
                code: 'catalog_evidence_unavailable',
                message: 'The catalog does not state the requested feature.',
                retryable: false,
              },
            };
          }
          const clarification = evaluateClarification(intent, products, availableCategories);
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
      const isHebrew = /[\u0590-\u05ff]/u.test(promptResult.data);
      return {
        turnId: input.turnId,
        status: turnStatus(outcomes),
        response: evidenceAwareResponse(promptResult.data, outcomes, isHebrew),
        outcomes,
      };
    },
  };
}
