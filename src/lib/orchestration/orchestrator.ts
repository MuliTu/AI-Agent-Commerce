import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { AgentBoundaryError, createCatalogToolHandlers, type AgentCatalogClient } from '../agent';
import type { Constraints, Product, ShoppingIntent, TurnStatus } from '../domain/contracts';
import { rankCatalogProducts } from '../ranking';
import { executeWithRetry, type RetryOptions } from '../reliability';
import {
  extractedTurnPlanSchema,
  type ClarificationAnswer,
  type ExtractedIntent,
  type ExtractedTurnPlan,
  type IntentExtractor,
  type IntentExtractionContext,
  type IntentOutcome,
  type OrchestrationResult,
} from './contracts';
import { evaluateClarification, selectTurnClarification } from './clarification';
import type { Clarification } from './clarification';
import { analyzeConstraintSemantics, type ConstraintSemanticIssue } from './constraint-semantics';
import {
  filterProductsByFeatureEvidence,
  requestedFeatureEvidence,
  requestedFeatureEvidenceForIntent,
} from './feature-evidence';
import { coalesceAlternativeProductDrafts, decideFollowUpTargets, explicitPromptCategories, inspectPlanCategoryCoverage, isAdditiveNamedRequest, isExclusiveNamedFollowUp } from './plan-integrity';
import { classifyIntentRequest, classifyRequestText } from './request-classification';
import {
  applySemanticEvidenceRanking,
  negativePreferenceTerms,
  semanticEvidenceCandidateLimit,
  requiresOnlyVerifiedEvidence,
  runSemanticEvidenceEvaluation,
  type SemanticEvidenceEvaluator,
  type SemanticEvidenceReport,
} from './semantic-evidence';
import {
  intentHasExplicitUsdBudget,
  intentHasUnsupportedIlsBudgetForCategory,
  intentIsOutsideProductCatalog,
  intentRequestsCheapOrdering,
  explicitUsdMaxPrice,
  isConstraintOnlyFollowUp,
  isCatalogCategoryGrounded,
  requestsComparativeAffordability,
  resolveCatalogCategory,
} from './category-resolution';
import type { OrchestrationDecisionDiagnostic } from '../diagnostics/server-trace';

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
  semanticEvidenceEvaluator?: SemanticEvidenceEvaluator;
  observeSemanticEvidence?: (report: SemanticEvidenceReport) => void;
  observeDecision?: (event: OrchestrationDecisionDiagnostic) => void;
  runCatalogAttempt?: <T>(attempt: number, operation: () => Promise<T>) => Promise<T>;
  semanticEvidenceTimeoutMs?: number;
};

export type OrchestrateTurnInput = {
  turnId: string;
  conversationId: string;
  prompt: string;
  previous?: OrchestrationResult;
  retryIntentId?: string;
  clarification?: ClarificationAnswer;
  displayedProductReference?: IntentExtractionContext['displayedProductReference'];
  pausedOutcomes?: IntentOutcome[];
};

const SEMANTIC_RERANK_TIMEOUT_MS = 8_000;
const SEMANTIC_RERANK_CANDIDATE_LIMIT = 30;

async function evaluateSemanticRelevance(input: {
  evaluator: SemanticEvidenceEvaluator;
  products: Product[];
  requirements: ReturnType<typeof requestedFeatureEvidenceForIntent>;
  observer?: (report: SemanticEvidenceReport) => void;
  timeoutMs: number;
}): Promise<SemanticEvidenceReport> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutReport = new Promise<SemanticEvidenceReport>((resolve) => {
    timeout = setTimeout(() => resolve({ status: 'failed', code: 'evaluation_failed' }), input.timeoutMs);
    timeout.unref?.();
  });
  const report = await Promise.race([
    runSemanticEvidenceEvaluation({
      evaluator: input.evaluator,
      products: input.products,
      requirements: input.requirements,
    }),
    timeoutReport,
  ]);
  if (timeout) clearTimeout(timeout);
  try {
    input.observer?.(report);
  } catch {
    // Diagnostics cannot make an otherwise valid shopper request fail.
  }
  return report;
}

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

function cheaperPriceClarification(
  products: IntentOutcome['products'],
  isHebrew: boolean,
  existingMaxPrice?: number,
): Clarification {
  const prices = [...new Set(products.map(({ product }) => product.price))].sort((left, right) => left - right);
  const middle = prices.length > 0 ? prices[Math.floor((prices.length - 1) / 2)] : 100;
  const rounded = Math.max(25, Math.ceil(middle / 25) * 25);
  const suggestedPrices = existingMaxPrice === undefined
    ? [rounded, rounded * 2, rounded * 4]
    : [0.5, 0.75, 0.9].map((ratio) => Number((existingMaxPrice * ratio).toPrecision(6)));
  const options = [...new Set(suggestedPrices)]
    .filter((price) => existingMaxPrice === undefined || price < existingMaxPrice)
    .map((price) => `Under $${price}`);
  return {
    field: 'maxPrice',
    question: isHebrew
      ? 'מה המחיר המרבי שייחשב זול יותר עבורך?'
      : 'What maximum price should I use for the cheaper options?',
    options,
    reason: 'requested',
  };
}

function shopperSafeResponse(outcomes: IntentOutcome[], isHebrew: boolean): string {
  const unsupportedConstraint = outcomes.find(({ error }) => error?.code === 'unsupported_constraint');
  if (unsupportedConstraint?.error) return unsupportedConstraint.error.message;
  const unavailableEvidence = outcomes.find(({ error }) => error?.code === 'catalog_evidence_unavailable');
  if (unavailableEvidence) {
    if (unavailableEvidence.semanticStatus === 'fallback') {
      return isHebrew
        ? 'האימות הסמנטי לא היה זמין. כדי לשמור על בקשת האימות המחמירה שלך, לא אציג מוצרים שלא אומתו.'
        : 'Semantic verification was unavailable. To preserve your strict verified-only request, I won’t show unverified products.';
    }
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
  if (outcomes.some(({ semanticStatus }) => semanticStatus === 'fallback')) {
    return isHebrew
      ? 'הדירוג הסמנטי לא היה זמין, ולכן התוצאות מוצגות לפי הסינון והדירוג הדטרמיניסטיים של הקטלוג.'
      : 'Semantic reranking was unavailable, so these results use deterministic catalog filtering and ordering.';
  }
  const semanticTiers = outcomes.flatMap(({ products }) => products.flatMap(({ semanticRelevance }) =>
    semanticRelevance ? [semanticRelevance.tier] : []));
  if (semanticTiers.some((tier) => tier === 'partial' || tier === 'unknown')) {
    return isHebrew
      ? 'התאמות מאומתות מוצגות ראשונות; אחריהן חלופות קשורות או לא מאומתות עם תווית ברורה.'
      : 'Verified matches appear first; related or unverified alternatives follow with clear labels.';
  }
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
  const semanticEvidenceTimeoutMs = z.number().int().min(1).max(30_000).parse(
    options.semanticEvidenceTimeoutMs ?? SEMANTIC_RERANK_TIMEOUT_MS,
  );

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
        // Multi-intent budget scope depends on semantic activate/pause actions.
        // Validate that issue after the structured action plan, before products are fetched.
        const blockingIssues = semantics.issues.filter(({ kind }) => kind !== 'ambiguous_multi_intent_budget');
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
      let plan: ExtractedTurnPlan;
      let continuingCheaperClarification = false;
      let resolvedPendingBudget: {
        maxPrice: number;
        selectedCategory: string;
        candidateCategories: string[];
      } | undefined;
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
        const selectedCategory = input.clarification.field === 'category'
          ? resolveCatalogCategory(input.clarification.value, input.clarification.value, availableCategories)
          : undefined;
        const pendingBudget = input.previous?.stateActions?.pendingBudgetClarification;
        if (pendingBudget && pendingBudget.selectorIntentId === input.clarification.intentId) {
          if (!selectedCategory || !pendingBudget.candidates.some(({ category }) => category === selectedCategory)) {
            throw new OrchestrationError('invalid_refinement', 'The budget clarification must select one of its persisted product targets.');
          }
          resolvedPendingBudget = {
            maxPrice: pendingBudget.maxPrice,
            selectedCategory,
            candidateCategories: pendingBudget.candidates.map(({ category }) => category),
          };
          plan = extractedTurnPlanSchema.parse({
            response: isHebrew
              ? `החלתי תקציב של $${pendingBudget.maxPrice} על ${selectedCategory} והמשכתי גם את שאר בקשות הקנייה.`
              : `I applied the $${pendingBudget.maxPrice} budget to ${selectedCategory} and continued the other shopping requests.`,
            intents: pendingBudget.candidates.map(({ category, intent }) => ({
              ...intent,
              constraints: {
                ...intent.constraints,
                category,
                ...(category === selectedCategory ? { maxPrice: pendingBudget.maxPrice } : {}),
              },
            })),
          });
        } else {
        const selectedPriorIntent = !prior.intent.constraints.category && selectedCategory
          ? previousOutcomes.find(({ intent }) => intent.id !== prior.intent.id
            && intent.constraints.category === selectedCategory)
          : undefined;
        continuingCheaperClarification = input.clarification.field === 'category'
          && /(?:\bcheaper\b|(?:יותר\s+זול|זול\s+יותר))/iu.test(`${prior.intent.goal} ${prior.intent.query}`);
        const update = clarificationUpdate(input.clarification, prior);
        plan = extractedTurnPlanSchema.parse({
          response: isHebrew ? `החלתי את ${input.clarification.value} על בקשת הקנייה שבחרת.` : `I applied the update to the selected ${input.clarification.value} request.`,
          intents: selectedPriorIntent ? [{
            intentId: selectedPriorIntent.intent.id,
            constraints: { ...prior.intent.constraints, ...(selectedCategory ? { category: selectedCategory } : {}) },
            status: continuingCheaperClarification ? 'needs_clarification' : 'ready',
          }] : [{ ...update, ...(continuingCheaperClarification ? { status: 'needs_clarification' as const } : {}) }],
        });
        }
      } else {
        try {
          const rawPlan = await options.extractIntents({
            prompt: promptResult.data,
            previousIntents: previousOutcomes.map(({ intent }) => ({ ...intent })),
            pausedIntents: (input.pausedOutcomes ?? []).map(({ intent }) => ({ ...intent })),
            ...(input.displayedProductReference
              ? { displayedProductReference: input.displayedProductReference }
              : {}),
          });
          plan = extractedTurnPlanSchema.parse(rawPlan);
        } catch (error) {
          if (AgentBoundaryError.isInstance(error)) throw error;
          if (error instanceof OrchestrationError) throw error;
          throw new OrchestrationError('invalid_plan', 'The model returned an invalid intent plan.', error);
        }
      }

      const operations = plan.operations ?? plan.intents.map((intent, intentIndex) => (
        intent.intentId
          ? { op: 'refine_intent' as const, intentIndex, intentId: intent.intentId }
          : { op: 'search' as const, intentIndex }
      ));
      const priceSemantics = plan.priceSemantics ?? plan.intents.map((intent) => (
        intent.constraints.sort === 'price_asc'
          ? { kind: 'sort_low_to_high' as const }
          : { kind: 'none' as const }
      ));
      if (priceSemantics.length !== plan.intents.length) {
        throw new OrchestrationError('invalid_plan', 'Every planned intent must have exactly one price semantic.');
      }
      const executableIntentIndexes = new Set(operations.flatMap((operation) =>
        operation.op === 'search' || operation.op === 'refine_intent' ? [operation.intentIndex] : []));
      const pausedById = new Map((input.pausedOutcomes ?? []).map((outcome) => [outcome.intent.id, outcome]));
      const validReferenceId = input.displayedProductReference
        ? input.displayedProductReference.referenceId
          ?? `displayed:${input.displayedProductReference.intentId}:${input.displayedProductReference.position}`
        : undefined;
      for (const operation of operations) {
        if ('intentIndex' in operation && !plan.intents[operation.intentIndex]) {
          throw new OrchestrationError('invalid_plan', 'An action referenced an unavailable intent draft.');
        }
        if (operation.op === 'pause_intent' && !previous.has(operation.intentId)) {
          throw new OrchestrationError('invalid_plan', 'Only an active intent can be paused.');
        }
        if (operation.op === 'resume_intent' && !pausedById.has(operation.intentId)) {
          throw new OrchestrationError('invalid_plan', 'Only a paused intent can be resumed.');
        }
        if (operation.op === 'refine_intent'
          && (!previous.has(operation.intentId) || plan.intents[operation.intentIndex]?.intentId !== operation.intentId)) {
          throw new OrchestrationError('invalid_plan', 'A refine action must target its exact active intent.');
        }
        if (operation.op === 'select_product' && operation.referenceId !== validReferenceId) {
          throw new OrchestrationError('invalid_plan', 'A product action must use the trusted displayed reference.');
        }
        if (operation.op === 'clarify') {
          const unavailableCandidate = operation.candidateIntentIds.find((intentId) =>
            !previous.has(intentId) && !pausedById.has(intentId));
          if (unavailableCandidate) {
            throw new OrchestrationError('invalid_plan', 'A clarification can only name active or paused intents.');
          }
          if (new Set(operation.candidateIntentIds).size !== operation.candidateIntentIds.length) {
            throw new OrchestrationError('invalid_plan', 'A clarification cannot repeat an intent candidate.');
          }
          if (operation.reason === 'ambiguous_budget_scope' && operation.candidateIntentIds.length < 2) {
            throw new OrchestrationError('invalid_plan', 'An ambiguous target clarification requires at least two trusted candidates.');
          }
        }
      }
      const operationSignatures = operations.map((operation) => JSON.stringify(operation));
      if (new Set(operationSignatures).size !== operationSignatures.length) {
        throw new OrchestrationError('invalid_plan', 'The action plan cannot repeat the same operation.');
      }
      const pausedIntentIds = new Set(operations.flatMap((operation) => operation.op === 'pause_intent' ? [operation.intentId] : []));
      const resumedIntentIds = new Set(operations.flatMap((operation) => operation.op === 'resume_intent' ? [operation.intentId] : []));
      if ([...pausedIntentIds].some((intentId) => resumedIntentIds.has(intentId))) {
        throw new OrchestrationError('invalid_plan', 'The same intent cannot be paused and resumed in one plan.');
      }
      const refinedIntentIds = new Set(operations.flatMap((operation) => operation.op === 'refine_intent' ? [operation.intentId] : []));
      if ([...pausedIntentIds].some((intentId) => refinedIntentIds.has(intentId))) {
        throw new OrchestrationError('invalid_plan', 'The same intent cannot be paused and refined in one plan.');
      }
      const selectOperations = operations.filter((operation) => operation.op === 'select_product');
      if (selectOperations.length > 0 && operations.length !== 1) {
        throw new OrchestrationError('invalid_plan', 'Product selection must be the sole terminal action in its plan.');
      }
      const clarifyOperations = operations.filter((operation) => operation.op === 'clarify');
      if (clarifyOperations.length > 1) {
        throw new OrchestrationError('invalid_plan', 'A plan can contain only one clarification.');
      }
      const clarifyOperation = clarifyOperations[0];
      if (clarifyOperation && operations.length !== 1) {
        throw new OrchestrationError('invalid_plan', 'Clarification must be the sole terminal action in its plan.');
      }
      const executableTargets = operations.flatMap((operation) =>
        operation.op === 'search' || operation.op === 'refine_intent' ? [operation.intentIndex] : []);
      if (new Set(executableTargets).size !== executableTargets.length) {
        throw new OrchestrationError('invalid_plan', 'An intent draft can only be executed once per plan.');
      }
      const priceSemanticsToValidate = plan.operations
        ? priceSemantics.filter((_, index) => executableIntentIndexes.has(index))
        : priceSemantics;
      for (const price of priceSemanticsToValidate) {
        if (price.kind === 'cheaper_than_reference'
          && price.referenceId !== undefined
          && price.referenceId !== validReferenceId) {
          throw new OrchestrationError('invalid_plan', 'A price comparison must use a trusted displayed reference.');
        }
      }
      try {
        options.observeDecision?.({
          stage: 'semantic_action_plan',
          operations: operations.map((operation, index) => ({
            index,
            op: operation.op,
            targetKind: 'referenceId' in operation ? 'reference'
              : 'intentId' in operation ? 'intent'
                : 'intentIndex' in operation ? 'draft' : 'none',
          })),
          priceSemantics: priceSemantics.map(({ kind }) => kind),
        });
      } catch {
        // Bounded diagnostics cannot fail an otherwise valid shopper request.
      }
      const pauseIntentIds = operations.flatMap((operation) => operation.op === 'pause_intent' ? [operation.intentId] : []);
      const resumeIntentIds = operations.flatMap((operation) => operation.op === 'resume_intent' ? [operation.intentId] : []);
      const stateActions = { pauseIntentIds, resumeIntentIds };
      if (clarifyOperation?.op === 'clarify') {
        const isHebrew = /[\u0590-\u05ff]/u.test(promptResult.data);
        const priceQuestion = isHebrew
          ? 'לאיזה מחיר או מוצר ייחוס להשוות את האפשרויות הזולות יותר?'
          : 'What price or displayed product should I use as the comparison baseline?';
        const targetQuestion = isHebrew
          ? 'לאיזו בקשת קנייה להחיל את השינוי?'
          : 'Which shopping request should I update?';
        const question = clarifyOperation.reason === 'missing_price_reference' ? priceQuestion : targetQuestion;
        const candidateOutcomes = clarifyOperation.candidateIntentIds.flatMap((intentId) => {
          const outcome = previous.get(intentId) ?? pausedById.get(intentId);
          return outcome ? [outcome] : [];
        });
        const sourceOutcomes = candidateOutcomes.length > 0 ? candidateOutcomes : [{
          intent: {
            id: `${input.turnId}:intent:1`,
            goal: plan.intents[0]?.goal ?? 'Clarify the shopping request',
            query: plan.intents[0]?.query ?? promptResult.data,
            constraints: plan.intents[0]?.constraints ?? {},
            status: 'needs_clarification' as const,
          },
          products: [],
        }];
        const outcomes = sourceOutcomes.map((outcome, index) => ({
          ...outcome,
          intent: { ...outcome.intent, status: 'needs_clarification' as const },
          ...(index === 0 ? { clarification: {
            field: clarifyOperation.reason === 'missing_price_reference' ? 'maxPrice' as const : 'category' as const,
            question,
            options: clarifyOperation.reason === 'missing_price_reference'
              ? ['Choose a displayed product', 'Set a maximum price']
              : sourceOutcomes.length >= 2
                ? sourceOutcomes.map(({ intent }) => intent.constraints.category ?? intent.goal).slice(0, 8)
                : [sourceOutcomes[0].intent.constraints.category ?? sourceOutcomes[0].intent.goal, 'Choose another product category'],
            reason: 'requested' as const,
          } } : { clarification: undefined }),
        }));
        return {
          turnId: input.turnId,
          status: turnStatus(outcomes),
          response: question,
          outcomes,
          stateActions,
        };
      }
      const selectOperation = operations.find((operation) => operation.op === 'select_product');
      if (selectOperation?.op === 'select_product' && input.displayedProductReference) {
        const selected = previous.get(input.displayedProductReference.intentId)?.products[input.displayedProductReference.position];
        if (!selected) throw new OrchestrationError('invalid_refinement', 'The displayed product is no longer available in conversation state.');
        const isHebrew = /[\u0590-\u05ff]/u.test(promptResult.data);
        return {
          turnId: input.turnId,
          status: 'completed',
          response: isHebrew
            ? `${selected.product.title} הוא המוצר שנבחר מהתוצאות שהוצגו, במחיר $${selected.product.price}.`
            : `${selected.product.title} is the selected product from the displayed results at $${selected.product.price}.`,
          outcomes: [{
            ...previous.get(input.displayedProductReference.intentId)!,
            products: [selected],
          }],
          stateActions: { ...stateActions, selectedProduct: true },
        };
      }
      const searchOrRefineOperations = operations.filter(({ op }) => op === 'search' || op === 'refine_intent');
      if (searchOrRefineOperations.length === 0 && (resumeIntentIds.length > 0 || pauseIntentIds.length > 0)) {
        const resumed = resumeIntentIds.flatMap((intentId) => pausedById.get(intentId) ? [pausedById.get(intentId)!] : []);
        const isHebrew = /[\u0590-\u05ff]/u.test(promptResult.data);
        const response = pauseIntentIds.length > 0 && resumeIntentIds.length > 0
          ? isHebrew ? 'עדכנתי את חיפושי המוצרים המושהים.' : 'I updated the paused product searches.'
          : pauseIntentIds.length > 0
            ? isHebrew ? 'השהיתי את חיפוש המוצרים.' : 'I paused the product search.'
            : isHebrew ? 'חידשתי את חיפוש המוצרים שהושהה.' : 'I resumed the paused product search.';
        return {
          turnId: input.turnId,
          status: turnStatus(resumed),
          response,
          outcomes: resumed,
          stateActions,
        };
      }
      const ambiguousBudget = analyzeConstraintSemantics(promptResult.data, availableCategories).issues
        .some(({ kind }) => kind === 'ambiguous_multi_intent_budget');
      const activeSearchCount = operations.filter(({ op }) => op === 'search' || op === 'refine_intent').length;
      if (ambiguousBudget && activeSearchCount > 1) {
        const isHebrew = /[\u0590-\u05ff]/u.test(promptResult.data);
        const maxPrice = explicitUsdMaxPrice(promptResult.data);
        const candidates = [...executableIntentIndexes].flatMap((index) => {
          const intent = plan.intents[index];
          if (!intent?.goal || !intent.query) return [];
          const category = resolveCatalogCategory(
            intent.constraints.category,
            `${intent.goal} ${intent.query} ${intent.constraints.category ?? ''}`,
            availableCategories,
          );
          if (!category) return [];
          const constraints = { ...intent.constraints, category };
          delete constraints.maxPrice;
          return [{ category, intent: { goal: intent.goal, query: intent.query, constraints, status: 'ready' as const } }];
        });
        if (maxPrice === undefined || candidates.length !== activeSearchCount
          || new Set(candidates.map(({ category }) => category)).size !== candidates.length) {
          throw new OrchestrationError('invalid_plan', 'An ambiguous multi-product budget requires distinct persisted product targets and an explicit USD amount.');
        }
        const selectorIntentId = `${input.turnId}:intent:1`;
        const message = isHebrew
          ? 'לא ברור לאיזה מוצר התקציב מתייחס. לאיזה מוצר להחיל אותו?'
          : 'It is unclear which product the budget applies to. Which product should I update?';
        return {
          turnId: input.turnId,
          status: 'partial',
          response: message,
          outcomes: [{
            intent: {
              id: selectorIntentId, goal: isHebrew ? 'בחירת מוצר לתקציב' : 'Choose a product for the budget',
              query: promptResult.data, constraints: { maxPrice }, status: 'needs_clarification',
            },
            products: [],
            clarification: {
              field: 'category', question: message,
              options: candidates.map(({ category }) => category), reason: 'split',
            },
          }],
          stateActions: {
            ...stateActions,
            pendingBudgetClarification: {
              kind: 'ambiguous_multi_intent_budget', selectorIntentId, maxPrice, candidates,
            },
          },
        };
      }
      if (plan.operations) {
        plan = {
          ...plan,
          intents: plan.intents.filter((_, index) => executableIntentIndexes.has(index)),
          priceSemantics: priceSemantics.filter((_, index) => executableIntentIndexes.has(index)),
        };
      }
      const executablePriceSemantics = plan.priceSemantics ?? priceSemantics;
      plan = {
        ...plan,
        intents: plan.intents.map((intent, index) => executablePriceSemantics[index]?.kind === 'sort_low_to_high'
          ? { ...intent, constraints: { ...intent.constraints, sort: 'price_asc' as const } }
          : intent),
      };

      if (plan.operations) {
        plan = {
          ...plan,
          intents: plan.intents.map((draft) => {
            const category = resolveCatalogCategory(
              draft.constraints.category,
              `${draft.goal ?? ''} ${draft.query ?? ''}`,
              availableCategories,
            );
            return category
              ? { ...draft, constraints: { ...draft.constraints, category } }
              : draft;
          }),
        };
      } else {
        plan = {
          ...plan,
          intents: coalesceAlternativeProductDrafts(
            promptResult.data,
            plan.intents,
            availableCategories,
            resolveCatalogCategory,
          ),
        };
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
      }
      const displayedReference = input.displayedProductReference;
      const referencedOutcome = displayedReference ? previous.get(displayedReference.intentId) : undefined;
      const referencedRankedProduct = displayedReference
        ? referencedOutcome?.products[displayedReference.position]
        : undefined;
      if (displayedReference && (!referencedOutcome || !referencedRankedProduct
        || referencedRankedProduct.product.id !== displayedReference.product.id
        || referencedRankedProduct.product.title !== displayedReference.product.title
        || referencedRankedProduct.product.price !== displayedReference.product.price
        || referencedRankedProduct.product.category !== displayedReference.product.category)) {
        throw new OrchestrationError(
          'invalid_refinement',
          'The displayed product reference does not match the persisted catalog result.',
        );
      }
      const referencedRefinement = Boolean(displayedReference && (plan.operations
        ? operations.some((operation) => operation.op === 'refine_intent'
          && operation.intentId === displayedReference.intentId)
        : isConstraintOnlyFollowUp(promptResult.data, availableCategories)));
      const actionRequiresPriceClarification = executablePriceSemantics.some(({ kind, ...price }) =>
        kind === 'cheaper_than_reference' && !('referenceId' in price));
      if (actionRequiresPriceClarification && explicitUsdMaxPrice(promptResult.data) === undefined) {
        const isHebrew = /[\u0590-\u05ff]/u.test(promptResult.data);
        const draft = plan.intents[0];
        const prior = draft?.intentId ? previous.get(draft.intentId) : undefined;
        const intent = prior?.intent ?? {
          id: `${input.turnId}:intent:1`,
          goal: draft?.goal ?? (isHebrew ? 'הבהרת השוואת מחיר' : 'Clarify the price comparison'),
          query: draft?.query ?? promptResult.data,
          constraints: draft?.constraints ?? {},
          status: 'needs_clarification' as const,
        };
        return {
          turnId: input.turnId,
          status: 'partial',
          response: isHebrew
            ? 'צריך מחיר או מוצר ייחוס מפורש כדי לחפש אפשרויות זולות יותר.'
            : 'I need an explicit price or displayed-product baseline to find lower-priced alternatives.',
          outcomes: [{
            intent: { ...intent, status: 'needs_clarification' },
            products: [],
            clarification: cheaperPriceClarification(prior?.products ?? [], isHebrew, intent.constraints.maxPrice),
          }],
          stateActions,
        };
      }
      const requiresCheaperPriceClarification = !displayedReference
        && explicitUsdMaxPrice(promptResult.data) === undefined
        && (actionRequiresPriceClarification || continuingCheaperClarification
          || requestsComparativeAffordability(promptResult.data));
      const namedCompoundCategories = displayedReference
        ? explicitPromptCategories(promptResult.data, availableCategories, resolveCatalogCategory)
          .filter((category) => category !== displayedReference.product.category)
        : [];
      if (!plan.operations && displayedReference && referencedRefinement && referencedOutcome) {
        const requestedReferenceBudget = explicitUsdMaxPrice(promptResult.data);
        const previousReferenceBudget = referencedOutcome.intent.constraints.maxPrice;
        const effectiveReferenceBudget = requestedReferenceBudget === undefined
          ? previousReferenceBudget
          : previousReferenceBudget === undefined
            ? requestedReferenceBudget
            : Math.min(previousReferenceBudget, requestedReferenceBudget);
        const modelDraft = plan.intents.find(({ intentId }) => intentId === displayedReference.intentId)
          ?? plan.intents.find((draft) => resolveCatalogCategory(
            draft.constraints.category,
            `${draft.goal ?? ''} ${draft.query ?? ''}`,
            availableCategories,
          ) === displayedReference.product.category)
          ?? plan.intents[0];
        const additionalDrafts = namedCompoundCategories.map((category) => {
          const matching = plan.intents.find((draft) => resolveCatalogCategory(
            draft.constraints.category,
            `${draft.goal ?? ''} ${draft.query ?? ''}`,
            availableCategories,
          ) === category);
          return {
            ...matching,
            intentId: undefined,
            goal: matching?.goal ?? `Find ${category.replace(/-/gu, ' ')}`,
            query: matching?.query ?? category,
            constraints: { ...matching?.constraints, category },
            status: matching?.status ?? 'ready' as const,
          };
        });
        plan = {
          ...plan,
          intents: [{
            ...modelDraft,
            intentId: displayedReference.intentId,
            goal: undefined,
            query: undefined,
            constraints: {
              ...referencedOutcome.intent.constraints,
              category: displayedReference.product.category,
              ...(effectiveReferenceBudget === undefined ? {} : { maxPrice: effectiveReferenceBudget }),
              ...(intentRequestsCheapOrdering(
                promptResult.data,
                `${modelDraft?.goal ?? ''} ${modelDraft?.query ?? ''}`,
                1,
                displayedReference.product.category,
                availableCategories,
              ) ? { sort: 'price_asc' as const } : {}),
            },
            status: modelDraft?.status ?? 'ready' as const,
          }, ...additionalDrafts],
        };
      } else if (!plan.operations && displayedReference && namedCompoundCategories.length > 0) {
        plan = {
          ...plan,
          intents: namedCompoundCategories.map((category) => {
            const matching = plan.intents.find((draft) => resolveCatalogCategory(
              draft.constraints.category,
              `${draft.goal ?? ''} ${draft.query ?? ''}`,
              availableCategories,
            ) === category);
            return {
              ...matching,
              intentId: undefined,
              goal: matching?.goal ?? `Find ${category.replace(/-/gu, ' ')}`,
              query: matching?.query ?? category,
              constraints: { ...matching?.constraints, category },
              status: matching?.status ?? 'ready' as const,
            };
          }),
        };
      }
      try {
        options.observeDecision?.({
          stage: 'intent_interpretation',
          intents: plan.intents.map((intent, index) => ({
            intentId: intent.intentId ?? `new-intent-${index}`,
            status: intent.status,
            ...(intent.constraints.category ? { category: intent.constraints.category } : {}),
            constraintKeys: Object.entries(intent.constraints)
              .filter(([, value]) => value !== undefined)
              .map(([key]) => key)
              .sort(),
          })),
        });
      } catch {
        // Development diagnostics cannot fail a shopper request.
      }

      const used = new Set<string>();
      const previousProductOutcomes = previousOutcomes.filter(({ intent, error }) =>
        intent.constraints.category
        && error?.code !== 'outside_product_catalog'
        && error?.code !== 'unknown_catalog_category');
      const constraintOnlyFollowUp = isConstraintOnlyFollowUp(promptResult.data, availableCategories);
      const deterministicBudget = explicitUsdMaxPrice(promptResult.data);
      const plannedSearches = plan.operations?.filter(({ op }) => op === 'search') ?? [];
      const plannedRefinements = plan.operations?.filter((operation) => operation.op === 'refine_intent') ?? [];
      const followUpTarget = plannedSearches.length > 0
        ? { kind: 'not_refinement' as const }
        : plannedRefinements.length === 1 && plannedRefinements[0]?.op === 'refine_intent'
          ? { kind: 'single' as const, intentId: plannedRefinements[0].intentId }
          : plannedRefinements.length > 1
            ? {
                kind: 'clarify' as const,
                intentIds: plannedRefinements.flatMap((operation) => operation.op === 'refine_intent' ? [operation.intentId] : []),
                categories: previousProductOutcomes.flatMap(({ intent }) => intent.constraints.category ? [intent.constraints.category] : []),
              }
            : decideFollowUpTargets({
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
      const additiveNamedRequest = isAdditiveNamedRequest(
        promptResult.data,
        availableCategories,
        resolveCatalogCategory,
      );
      try {
        options.observeDecision?.({
          stage: 'follow_up_target',
          previousIntentCount: previousProductOutcomes.length,
          previousCategories: previousProductOutcomes.flatMap(({ intent }) =>
            intent.constraints.category ? [intent.constraints.category] : []),
          constraintOnly: constraintOnlyFollowUp,
          additiveNamedRequest,
          decision: followUpTarget.kind,
          targetCount: followUpTarget.kind === 'single'
            ? 1
            : followUpTarget.kind === 'all' || followUpTarget.kind === 'clarify'
              ? followUpTarget.intentIds.length
              : 0,
        });
      } catch {
        // Development diagnostics cannot fail a shopper request.
      }
      const drafts: ExtractedIntent[] = displayedReference
        ? plan.intents
        : followUpTarget.kind === 'clarify'
        ? [{
          goal: /[\u0590-\u05ff]/u.test(promptResult.data) ? 'בחירת מוצר לעדכון' : 'Choose which product to refine',
          query: promptResult.data,
          constraints: deterministicBudget === undefined ? {} : { maxPrice: deterministicBudget },
          status: 'needs_clarification' as const,
        }]
        : requiresCheaperPriceClarification && followUpTarget.kind === 'single'
          ? [{
            ...plan.intents[0],
            intentId: followUpTarget.intentId,
            constraints: {
              ...plan.intents[0].constraints,
              ...(previous.get(followUpTarget.intentId)?.intent.constraints.category
                ? { category: previous.get(followUpTarget.intentId)!.intent.constraints.category }
                : {}),
            },
            status: 'needs_clarification' as const,
          }]
          : requiresCheaperPriceClarification && previousProductOutcomes.length === 0
            ? plan.intents.map((intent) => ({ ...intent, status: 'needs_clarification' as const }))
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
      const wholePromptOutsideCatalog = classifyRequestText(promptResult.data, availableCategories) === 'outside_catalog';
      const planned = drafts.map((draft) => {
        const draftContext = `${draft.goal ?? ''} ${draft.query ?? ''} ${draft.constraints.category ?? ''}`;
        const trustedDraftCategory = resolveCatalogCategory(
          draft.constraints.category,
          draftContext,
          availableCategories,
        );
        const outsideProductCatalog = !trustedDraftCategory && (wholePromptOutsideCatalog || classifyIntentRequest({
          prompt: promptResult.data,
          intentContext: draftContext,
          intentCount: drafts.length,
          availableCategories,
        }) === 'outside_catalog' || intentIsOutsideProductCatalog(promptResult.data, draftContext, drafts.length));
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
        const explicitPromptCategory = !plan.operations && drafts.length === 1
          ? resolveCatalogCategory(undefined, promptResult.data, availableCategories)
          : undefined;
        const resolvedCategory = outsideProductCatalog ? undefined : resolveCatalogCategory(
          requestedCategory,
          `${intent.goal} ${intent.query}`,
          availableCategories,
        );
        const persistedPendingCategory = resolvedPendingBudget && requestedCategory
          && resolvedPendingBudget.candidateCategories.includes(requestedCategory)
          ? requestedCategory
          : undefined;
        const category = persistedPendingCategory ?? explicitPromptCategory ?? (resolvedCategory && (previous.has(intent.id) || isCatalogCategoryGrounded(
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
        const preservesResolvedPendingBudget = resolvedPendingBudget !== undefined
          && category === resolvedPendingBudget.selectedCategory
          && intent.constraints.maxPrice === resolvedPendingBudget.maxPrice;
        return {
          ...intent,
          constraints: {
            ...intent.constraints,
            ...(cheapOrdering ? { sort: 'price_asc' as const } : {}),
            ...(!explicitUsdBudget && !preservesPriorBudget && !preservesResolvedPendingBudget ? { maxPrice: undefined } : {}),
            ...(category ? { category } : { category: undefined }),
          },
          status: outsideProductCatalog || (requestedCategory !== undefined && !category)
            ? 'failed' as const
            : intent.status,
        };
      });
      if (resolvedPendingBudget) {
        const byCategory = new Map(planned.flatMap((intent) =>
          intent.constraints.category ? [[intent.constraints.category, intent] as const] : []));
        const hasExactCandidates = planned.length === resolvedPendingBudget.candidateCategories.length
          && resolvedPendingBudget.candidateCategories.every((category) => byCategory.has(category));
        const selected = byCategory.get(resolvedPendingBudget.selectedCategory);
        const leakedBudget = [...byCategory.entries()].some(([category, intent]) =>
          category !== resolvedPendingBudget?.selectedCategory && intent.constraints.maxPrice !== undefined);
        if (!hasExactCandidates || selected?.constraints.maxPrice !== resolvedPendingBudget.maxPrice || leakedBudget) {
          throw new OrchestrationError('invalid_refinement', 'The persisted budget clarification was not preserved exactly before catalog search.');
        }
      }
      const cheaperComparisonIntentIds = new Set(planned.flatMap((intent, index) => {
        const price = executablePriceSemantics[index];
        const structured = price?.kind === 'cheaper_than_reference' && price.referenceId === validReferenceId;
        const legacy = !plan.operations && displayedReference
          && intent.id === displayedReference.intentId
          && requestsComparativeAffordability(promptResult.data);
        return structured || legacy ? [intent.id] : [];
      }));
      const plannedIds = new Set(planned.map(({ id }) => id));
      const continuesPreviousIntent = planned.some(({ id }) => previous.has(id));
      const shouldPreserveSiblingIntents = Boolean(
        input.retryIntentId
        || input.clarification
        || additiveNamedRequest
        || Boolean(displayedReference && namedCompoundCategories.length > 0)
        || (continuesPreviousIntent && !exclusiveNamedFollowUp),
      );
      const previousOutcomesToPreserve = (shouldPreserveSiblingIntents ? previousOutcomes : [])
        .filter(({ intent }) => !plannedIds.has(intent.id) && intent.id !== input.clarification?.intentId)
        .map((outcome) => displayedReference && !referencedRefinement
          && outcome.intent.id === displayedReference.intentId && referencedRankedProduct
          ? { ...outcome, products: [referencedRankedProduct] }
          : outcome);
      const preserved = await Promise.all(previousOutcomesToPreserve
        .map(async (outcome): Promise<IntentOutcome> => {
          for (const ranked of outcome.products) {
            let trusted;
            try {
              trusted = await handlers.getProduct({ id: ranked.product.id });
            } catch (error) {
              throw new OrchestrationError('invalid_refinement', 'Previous catalog results could not be revalidated.', error);
            }
            if (!isDeepStrictEqual(trusted, ranked.product)) {
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
        const finalOutsideCatalog = !intent.constraints.category && (wholePromptOutsideCatalog || finalClassification === 'outside_catalog' || intentIsOutsideProductCatalog(
          promptResult.data,
          `${intent.goal} ${intent.query}`,
          planned.length,
        ));
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
        if (intent.status === 'needs_clarification' && requiresCheaperPriceClarification
          && intent.constraints.category) {
          if (intent.constraints.maxPrice === 0) {
            return { intent: { ...intent, status: 'completed' }, products: [] };
          }
          const priorProducts = previous.get(intent.id)?.products ?? [];
          return {
            intent,
            products: [],
            clarification: cheaperPriceClarification(
              priorProducts,
              /[\u0590-\u05ff]/u.test(promptResult.data),
              intent.constraints.maxPrice,
            ),
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
          try {
            options.observeDecision?.({
              stage: 'catalog_search',
              intentId: intent.id,
              ...(intent.constraints.category ? { category: intent.constraints.category } : {}),
              filters: {
                maxPrice: intent.constraints.maxPrice,
                minRating: intent.constraints.minRating,
                inStock: intent.constraints.inStock,
                brands: intent.constraints.brands,
                sort: intent.constraints.sort,
              },
            });
          } catch {
            // Development diagnostics cannot fail a shopper request.
          }
          const search = (attempt = 1) => {
            const operation = () => intent.constraints.category
              ? handlers.listCategoryProducts(intent.constraints.category)
              : handlers.searchCatalog({ query: intent.query, limit: 20 });
            return options.runCatalogAttempt
              ? options.runCatalogAttempt(attempt, operation)
              : operation();
          };
          const result = input.retryIntentId === intent.id
            ? await executeWithRetry(search, options.retryOptions)
            : await search();
          const catalogProducts = displayedReference
            && cheaperComparisonIntentIds.has(intent.id)
            ? result.products.filter((product) =>
              product.id !== displayedReference.product.id
              && product.price < displayedReference.product.price)
            : result.products;
          const featureRequirements = requestedFeatureEvidenceForIntent({
            prompt: promptResult.data,
            intentContext: `${intent.goal} ${intent.query}`,
            category: intent.constraints.category,
            intentCount: planned.length,
            availableCategories,
          });
          const hardFiltered = rankCatalogProducts(catalogProducts, {
            query: intent.query,
            constraints: intent.constraints,
            limit: undefined,
          });
          const semanticRequirements = featureRequirements.length > 0
            ? featureRequirements
            : [{ label: intent.query, alternatives: [] as readonly string[] }];
          const onlyVerified = requiresOnlyVerifiedEvidence(promptResult.data);
          const semanticCandidateLimit = semanticEvidenceCandidateLimit(
            semanticRequirements.length,
            SEMANTIC_RERANK_CANDIDATE_LIMIT,
          );
          let semanticStatus: IntentOutcome['semanticStatus'];
          if (options.semanticEvidenceEvaluator && hardFiltered.length > 0 && semanticCandidateLimit > 0) {
            const semanticCandidates = hardFiltered.slice(0, semanticCandidateLimit);
            const report = await evaluateSemanticRelevance({
                evaluator: options.semanticEvidenceEvaluator,
                products: semanticCandidates.map(({ product }) => product),
                requirements: semanticRequirements,
                observer: options.observeSemanticEvidence,
                timeoutMs: semanticEvidenceTimeoutMs,
            });
            if (report.status === 'completed') {
              semanticStatus = 'applied';
              const ranked = applySemanticEvidenceRanking({
                ranked: semanticCandidates,
                assessments: report.assessments,
                onlyVerified,
                negativeTerms: negativePreferenceTerms(promptResult.data),
                priceFirst: intent.constraints.sort === 'price_asc',
              });
              const products = ranked;
              if (products.length === 0) {
                return {
                  intent: { ...intent, status: 'completed' },
                  products: [],
                  semanticStatus,
                  semanticTruncated: hardFiltered.length > semanticCandidates.length,
                  error: {
                    code: 'catalog_evidence_unavailable',
                    message: 'The catalog does not verify the requested feature.',
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
              return {
                intent: { ...intent, status: 'completed' },
                products,
                semanticStatus,
                semanticTruncated: hardFiltered.length > semanticCandidates.length,
              };
            }
            semanticStatus = 'fallback';
          }
          if (onlyVerified && featureRequirements.length === 0) {
            return {
              intent: { ...intent, status: 'completed' },
              products: [],
              ...(semanticStatus ? { semanticStatus } : {}),
              error: {
                code: 'catalog_evidence_unavailable',
                message: 'The catalog does not provide deterministic evidence for the requested verified-only feature.',
                retryable: false,
              },
            };
          }
          const evidenceProducts = filterProductsByFeatureEvidence(catalogProducts, featureRequirements);
          const products = rankCatalogProducts(evidenceProducts, {
            query: intent.query,
            constraints: intent.constraints,
            limit: undefined,
          });
          if (featureRequirements.length > 0 && products.length === 0) {
            return {
              intent: { ...intent, status: 'completed' },
              products: [],
              ...(semanticStatus ? { semanticStatus } : {}),
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
          return {
            intent: { ...intent, status: 'completed' },
            products,
            ...(semanticStatus ? { semanticStatus } : {}),
          };
        } catch (error) {
          return scopedFailure(intent, error, input.retryIntentId === intent.id, /[\u0590-\u05ff]/u.test(promptResult.data));
        }
      }));
      const outcomes = selectTurnClarification([...preserved, ...settled]);
      const isHebrew = /[\u0590-\u05ff]/u.test(promptResult.data);
      return {
        turnId: input.turnId,
        status: turnStatus(outcomes),
        response: evidenceAwareResponse(promptResult.data, settled.length > 0 ? settled : outcomes, isHebrew),
        outcomes,
        stateActions,
      };
    },
  };
}
