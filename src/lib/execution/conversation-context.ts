import { isDeepStrictEqual } from 'node:util';
import type { OrchestrationResult } from '../orchestration/contracts';
import type { ConversationMemoryState, IntentOperation } from '../persistence';
import type { Product } from '../domain/contracts';

export type DisplayedProductReference = {
  referenceId: string;
  intentId: string;
  position: number;
  product: { id: number; title: string; price: number; category: string };
  selectionOnly: boolean;
  result: OrchestrationResult;
};

export type DisplayGroupReference = {
  groupRef: string;
  sourceTurnId: string;
  intentId: string;
  category?: string;
  lifecycle: 'active' | 'paused' | 'inactive';
  visibleOrder: number[];
  outcome: OrchestrationResult['outcomes'][number];
};

export type DisplayedProductSelection = {
  position: number;
  groups: Array<{ group: DisplayGroupReference; product: Product }>;
  result: OrchestrationResult;
};

export type ConversationContext = {
  previous?: OrchestrationResult;
  stateRevision: number;
  currentFocusIntentId?: string;
  displayedProductReference?: DisplayedProductReference;
  displayedProductSelection?: DisplayedProductSelection;
  displayGroups?: DisplayGroupReference[];
  ordinalResolutionIssue?: {
    position: number;
    categories: string[];
    missingCategories?: string[];
    reason: 'missing_position' | 'ambiguous_group';
  };
  pausedOutcomes?: OrchestrationResult['outcomes'];
  selectedProducts?: ConversationMemoryState['selectedProducts'];
};

export const MAX_ACTIVE_CONVERSATION_INTENTS = 8;

const ORDINALS: ReadonlyArray<{ pattern: RegExp; position: number }> = [
  { pattern: /(?:\b(?:the\s+)?first(?:\s+(?:one|option|product|result))\b|(?:^|\s)הראשו(?:ן|נה)(?:\s|$))/iu, position: 0 },
  { pattern: /(?:\b(?:the\s+)?second(?:\s+(?:one|option|product|result))\b|(?:^|\s)השני(?:ה)?(?:\s|$))/iu, position: 1 },
  { pattern: /(?:\b(?:the\s+)?third\s+(?:one|option|product|result)\b|(?:^|\s)השלישי(?:ת)?(?:\s|$))/iu, position: 2 },
  { pattern: /(?:\b(?:the\s+)?fourth\s+(?:one|option|product|result)\b|(?:^|\s)הרביעי(?:ת)?(?:\s|$))/iu, position: 3 },
  { pattern: /\b(?:the\s+)?fifth\s+(?:one|option|product|result)\b/iu, position: 4 },
  { pattern: /\b(?:the\s+)?sixth\s+(?:one|option|product|result)\b/iu, position: 5 },
  { pattern: /\b(?:the\s+)?seventh\s+(?:one|option|product|result)\b/iu, position: 6 },
  { pattern: /\b(?:the\s+)?eighth\s+(?:one|option|product|result)\b/iu, position: 7 },
  { pattern: /\b(?:the\s+)?ninth\s+(?:one|option|product|result)\b/iu, position: 8 },
  { pattern: /\b(?:the\s+)?tenth\s+(?:one|option|product|result)\b/iu, position: 9 },
  { pattern: /\b(?:option|product|result)\s*(?:number\s*)?#?([1-9]|10)\b/iu, position: -1 },
];

function ordinalPosition(prompt: string): number | undefined {
  for (const { pattern, position } of ORDINALS) {
    const match = prompt.match(pattern);
    if (match) return position >= 0 ? position : Number(match[1]) - 1;
  }
  return undefined;
}

function isSelectionOnly(prompt: string): boolean {
  return /^(?:(?:please\s+)?(?:show|give|open|select)\s+(?:me\s+)?(?:the\s+)?(?:first|second|third)\s+one|(?:בבקשה\s+)?(?:הצג|תראה|בחר)(?:\s+לי)?\s+את\s+ה(?:ראשו(?:ן|נה)|שני(?:ה)?|שלישי(?:ת)?))[.!?\s]*$/iu.test(prompt.trim());
}

export function buildConversationContext(input: {
  prompt: string;
  persistedState?: ConversationMemoryState;
  latestCompletedResult?: OrchestrationResult;
  completedResults?: OrchestrationResult[];
}): ConversationContext {
  const previous = input.persistedState?.activeResult ?? input.latestCompletedResult;
  const position = ordinalPosition(input.prompt);
  const activeIds = new Set(input.persistedState?.activeResult?.outcomes.map(({ intent }) => intent.id) ?? []);
  const pausedIds = new Set(input.persistedState?.pausedOutcomes?.map(({ intent }) => intent.id) ?? []);
  const results = input.completedResults?.length ? input.completedResults : previous ? [previous] : [];
  const displayGroups: DisplayGroupReference[] = results.filter((result) => result.stateActions?.selectedProduct !== true).flatMap((result) => result.outcomes
    .filter(({ products }) => products.length > 0)
    .map((outcome) => ({
      groupRef: `display:${result.turnId}:${outcome.intent.id}`,
      sourceTurnId: result.turnId,
      intentId: outcome.intent.id,
      category: outcome.intent.constraints.category ?? outcome.products[0]?.product.category,
      lifecycle: activeIds.has(outcome.intent.id) ? 'active' as const : pausedIds.has(outcome.intent.id) ? 'paused' as const : 'inactive' as const,
      visibleOrder: outcome.products.map(({ product }) => product.id),
      outcome,
    })));
  const selectedFollowUp = position === undefined
    && /\b(?:tell|describe|details?|information|about|show)\b|(?:ספר|פרטים|מידע|הצג)/iu.test(input.prompt)
    && /\b(?:that|this|selected|chosen)\b|(?:הזה|הזאת|שבחר)/iu.test(input.prompt)
    && !/\b(?:find|search|like|similar|cheaper|under|below)\b/iu.test(input.prompt)
    ? [...(input.persistedState?.selectedProducts ?? [])].reverse().find(({ product }) => {
        const prompt = input.prompt.toLocaleLowerCase();
        if (/\b(?:phone|smartphone|mobile)\b/iu.test(prompt)) return product.category === 'smartphones';
        if (/\b(?:perfume|fragrance|scent)\b/iu.test(prompt)) return product.category === 'fragrances';
        return true;
      })
    : undefined;
  if (selectedFollowUp) {
    const source = [...displayGroups].reverse().find(({ intentId, outcome }) => intentId === selectedFollowUp.intentId
      && outcome.products.some(({ product }) => product.id === selectedFollowUp.product.id && isDeepStrictEqual(product, selectedFollowUp.product)));
    if (source) return {
      previous,
      stateRevision: input.persistedState?.revision ?? 0,
      currentFocusIntentId: selectedFollowUp.intentId,
      pausedOutcomes: input.persistedState?.pausedOutcomes,
      selectedProducts: input.persistedState?.selectedProducts,
      displayGroups,
      displayedProductReference: {
        referenceId: `selected:${selectedFollowUp.selectedAtTurnId}:${selectedFollowUp.product.id}`,
        intentId: selectedFollowUp.intentId,
        position: selectedFollowUp.position,
        product: { id: selectedFollowUp.product.id, title: selectedFollowUp.product.title, price: selectedFollowUp.product.price, category: selectedFollowUp.product.category },
        selectionOnly: true,
        result: {
          turnId: previous?.turnId ?? selectedFollowUp.selectedAtTurnId,
          status: 'completed',
          response: `${selectedFollowUp.product.title} is priced at $${selectedFollowUp.product.price}.`,
          outcomes: [{
            ...source.outcome,
            intent: { ...source.outcome.intent, status: 'completed' },
            products: [{ product: selectedFollowUp.product, score: 1, matchReasons: [] }],
            clarification: undefined,
            error: undefined,
          }],
        },
      },
    };
  }
  if (position === undefined || !previous) {
    return {
      previous,
      stateRevision: input.persistedState?.revision ?? 0,
      currentFocusIntentId: input.persistedState?.currentFocusIntentId,
      pausedOutcomes: input.persistedState?.pausedOutcomes,
      selectedProducts: input.persistedState?.selectedProducts,
      displayGroups,
    };
  }
  const normalized = input.prompt.toLocaleLowerCase();
  const latestByIntent = [...displayGroups].reverse().filter((group, index, all) =>
    all.findIndex((candidate) => candidate.intentId === group.intentId) === index).reverse();
  const requestedGroups = latestByIntent.filter((group) => {
    const category = group.category?.toLocaleLowerCase();
    return category && (normalized.includes(category) || normalized.includes(category.replace(/-/gu, ' ')));
  });
  const wantsAll = /\b(?:both|all|each)\b|(?:שתי|כל)\s+(?:הרשימות|האפשרויות)/iu.test(input.prompt);
  const wantsBoth = /\bboth\b|שתי\s+(?:הרשימות|האפשרויות)/iu.test(input.prompt);
  const candidates = requestedGroups.length > 0
    ? requestedGroups
    : wantsAll ? latestByIntent
      : latestByIntent.filter((group) => group.lifecycle === 'active');
  if (wantsAll && (candidates.length < 2 || (wantsBoth && candidates.length !== 2))) return {
    previous, stateRevision: input.persistedState?.revision ?? 0,
    currentFocusIntentId: input.persistedState?.currentFocusIntentId,
    pausedOutcomes: input.persistedState?.pausedOutcomes, selectedProducts: input.persistedState?.selectedProducts, displayGroups,
    ordinalResolutionIssue: { position, categories: candidates.map(({ category, intentId }) => category ?? intentId), reason: 'ambiguous_group' },
  };
  if (wantsAll && candidates.length > 1) {
    const missing = candidates.filter(({ outcome }) => !outcome.products[position]);
    if (missing.length > 0) return {
      previous, stateRevision: input.persistedState?.revision ?? 0,
      currentFocusIntentId: input.persistedState?.currentFocusIntentId,
      pausedOutcomes: input.persistedState?.pausedOutcomes, displayGroups,
      selectedProducts: input.persistedState?.selectedProducts,
      ordinalResolutionIssue: {
        position,
        categories: candidates.map(({ category, intentId }) => category ?? intentId),
        missingCategories: missing.map(({ category, intentId }) => category ?? intentId),
        reason: 'missing_position',
      },
    };
    const groups = candidates.map((group) => ({ group, product: group.outcome.products[position].product }));
    return {
      previous, stateRevision: input.persistedState?.revision ?? 0,
      currentFocusIntentId: input.persistedState?.currentFocusIntentId,
      pausedOutcomes: input.persistedState?.pausedOutcomes, displayGroups,
      selectedProducts: input.persistedState?.selectedProducts,
      displayedProductSelection: {
        position, groups,
        result: { turnId: previous.turnId, status: 'completed', response: `Here is option ${position + 1} from each displayed list.`, outcomes: groups.map(({ group }) => ({ ...group.outcome, products: [group.outcome.products[position]], clarification: undefined, error: undefined })) },
      },
    };
  }
  const productOutcomes = candidates.map(({ outcome }) => outcome);
  if (productOutcomes.length !== 1 || !productOutcomes[0].products[position]) {
    return {
      previous,
      stateRevision: input.persistedState?.revision ?? 0,
      currentFocusIntentId: input.persistedState?.currentFocusIntentId,
      pausedOutcomes: input.persistedState?.pausedOutcomes,
      selectedProducts: input.persistedState?.selectedProducts,
      displayGroups,
      ordinalResolutionIssue: { position, categories: candidates.map(({ category, intentId }) => category ?? intentId), reason: productOutcomes.length > 1 ? 'ambiguous_group' : 'missing_position' },
    };
  }
  const outcome = productOutcomes[0];
  const selected = outcome.products[position];
  const isHebrew = /[\u0590-\u05ff]/u.test(input.prompt);
  const selectionOnly = isSelectionOnly(input.prompt)
    || (/\b(?:show|give|open|select|tell me about)\b/iu.test(input.prompt)
      && !/\b(?:and\s+find|cheaper|under|below|less than|with)\b/iu.test(input.prompt));
  return {
    previous,
    stateRevision: input.persistedState?.revision ?? 0,
    currentFocusIntentId: outcome.intent.id,
    pausedOutcomes: input.persistedState?.pausedOutcomes,
    selectedProducts: input.persistedState?.selectedProducts,
    displayGroups,
    displayedProductReference: {
      referenceId: `displayed:${outcome.intent.id}:${position}`,
      intentId: outcome.intent.id,
      position,
      product: { id: selected.product.id, title: selected.product.title, price: selected.product.price, category: selected.product.category },
      selectionOnly,
      result: {
        turnId: previous.turnId,
        status: 'completed',
        response: isHebrew
          ? `זו האפשרות מספר ${position + 1} מהתוצאות שהוצגו.`
          : `Here is option ${position + 1} from the displayed results.`,
        outcomes: [{
          ...outcome,
          intent: { ...outcome.intent, status: 'completed' },
          products: [selected],
          clarification: undefined,
          error: undefined,
        }],
      },
    },
  };
}

function inferOperation(
  previous: OrchestrationResult | undefined,
  result: OrchestrationResult,
  selectedProduct: boolean,
): IntentOperation {
  if (selectedProduct) return 'select_product';
  if (!previous) {
    return result.outcomes.some(({ intent }) => intent.status === 'needs_clarification') ? 'clarify' : 'add';
  }
  const previousById = new Map(previous.outcomes.map((outcome) => [outcome.intent.id, outcome]));
  const changedOutcomes = result.outcomes.filter((outcome) =>
    !isDeepStrictEqual(previousById.get(outcome.intent.id), outcome));
  if (changedOutcomes.some(({ intent }) => intent.status === 'needs_clarification')) return 'clarify';
  const previousIds = new Set(previous.outcomes.map(({ intent }) => intent.id));
  const resultIds = new Set(result.outcomes.map(({ intent }) => intent.id));
  const retained = [...resultIds].some((id) => previousIds.has(id));
  const added = [...resultIds].some((id) => !previousIds.has(id));
  if (retained && added) return 'add';
  if (retained) return 'refine';
  return 'replace';
}

export function nextConversationMemoryState(input: {
  conversationId: string;
  turnId: string;
  completedAt: string;
  context: ConversationContext;
  result: OrchestrationResult;
}): ConversationMemoryState {
  const exactSelectedProduct = input.context.displayedProductReference
    ? input.result.outcomes.flatMap(({ products }) => products.map(({ product }) => product)).find((product) =>
        product.id === input.context.displayedProductReference?.product.id
        && product.title === input.context.displayedProductReference.product.title
        && product.price === input.context.displayedProductReference.product.price
        && product.category === input.context.displayedProductReference.product.category)
    : undefined;
  const selectedProduct = input.context.displayedProductReference?.selectionOnly === true
    || input.context.displayedProductSelection !== undefined
    || input.result.stateActions?.selectedProduct === true;
  const operation = inferOperation(input.context.previous, input.result, selectedProduct);
  const previousById = new Map(input.context.previous?.outcomes.map((outcome) => [outcome.intent.id, outcome]) ?? []);
  const changedOutcomes = input.result.outcomes.filter((outcome) =>
    !isDeepStrictEqual(previousById.get(outcome.intent.id), outcome));
  const pauseIds = new Set(input.result.stateActions?.pauseIntentIds ?? []);
  const resumeIds = new Set(input.result.stateActions?.resumeIntentIds ?? []);
  const previouslyPaused = input.context.pausedOutcomes ?? [];
  const previouslyPausedIds = new Set(previouslyPaused.map(({ intent }) => intent.id));
  const resumedOutcomes = previouslyPaused.filter(({ intent }) => resumeIds.has(intent.id));
  const newlyPaused = input.context.previous?.outcomes.filter(({ intent }) => pauseIds.has(intent.id)) ?? [];
  const resultIntentIds = new Set(input.result.outcomes.map(({ intent }) => intent.id));
  const hasStateMutation = pauseIds.size > 0 || resumeIds.size > 0;
  const unboundedActiveResult = operation === 'select_product'
    ? input.context.previous
    : operation === 'clarify' && input.context.previous
      ? {
          ...input.result,
          outcomes: [
            ...input.context.previous.outcomes.filter(({ intent }) => !pauseIds.has(intent.id) && !input.result.outcomes
              .some(({ intent: currentIntent }) => currentIntent.id === intent.id)),
            ...resumedOutcomes.filter(({ intent }) => !input.result.outcomes
              .some(({ intent: currentIntent }) => currentIntent.id === intent.id)),
            ...input.result.outcomes.filter(({ intent }) => !pauseIds.has(intent.id)
              && (!previouslyPausedIds.has(intent.id) || resumeIds.has(intent.id))),
          ],
        }
      : hasStateMutation
        ? {
            ...input.result,
            outcomes: [
              ...(input.context.previous?.outcomes ?? []).filter(({ intent }) => !pauseIds.has(intent.id)
                && !resultIntentIds.has(intent.id)),
              ...resumedOutcomes.filter(({ intent }) => !resultIntentIds.has(intent.id)),
              ...input.result.outcomes.filter(({ intent }) => !pauseIds.has(intent.id)),
            ],
          }
        : {
          ...input.result,
          outcomes: [
            ...resumedOutcomes.filter(({ intent }) => !resultIntentIds.has(intent.id)),
            ...input.result.outcomes.filter(({ intent }) => !pauseIds.has(intent.id)),
          ],
        };
  const activeResult = unboundedActiveResult && unboundedActiveResult.outcomes.length > MAX_ACTIVE_CONVERSATION_INTENTS
    ? { ...unboundedActiveResult, outcomes: unboundedActiveResult.outcomes.slice(-MAX_ACTIVE_CONVERSATION_INTENTS) }
    : unboundedActiveResult;
  const activeIntentIds = new Set(activeResult?.outcomes.map(({ intent }) => intent.id) ?? []);
  const activeChangedOutcomes = changedOutcomes.filter(({ intent }) => activeIntentIds.has(intent.id));
  const focusCandidates = activeChangedOutcomes.filter(({ intent }) =>
    intent.status !== 'failed' && intent.status !== 'needs_clarification');
  const clarificationFocus = activeChangedOutcomes.find(({ intent }) => intent.status === 'needs_clarification')?.intent.id;
  const proposedFocus = selectedProduct
    ? input.context.displayedProductReference?.intentId
    : focusCandidates.length === 1
      ? focusCandidates[0].intent.id
      : operation === 'add'
        ? focusCandidates.find(({ intent }) => !input.context.previous?.outcomes
          .some(({ intent: previousIntent }) => previousIntent.id === intent.id))?.intent.id
        : operation === 'clarify'
          ? clarificationFocus ?? (input.context.currentFocusIntentId
            && activeIntentIds.has(input.context.currentFocusIntentId) ? input.context.currentFocusIntentId : undefined)
          : hasStateMutation && input.context.currentFocusIntentId
            && activeIntentIds.has(input.context.currentFocusIntentId) ? input.context.currentFocusIntentId : undefined;
  const focus = proposedFocus && activeIntentIds.has(proposedFocus) ? proposedFocus : undefined;
  return {
    conversationId: input.conversationId,
    revision: input.context.stateRevision + 1,
    activeResult,
    ...(focus ? { currentFocusIntentId: focus } : {}),
    lastOperation: operation,
    lastTurnId: input.turnId,
    updatedAt: input.completedAt,
    pausedOutcomes: [
      ...previouslyPaused.filter(({ intent }) => !resumeIds.has(intent.id) && !input.result.outcomes
        .some(({ intent: currentIntent }) => currentIntent.id === intent.id)),
      ...input.result.outcomes.filter(({ intent }) => previouslyPausedIds.has(intent.id) && !resumeIds.has(intent.id)),
      ...newlyPaused.filter(({ intent }) => !previouslyPaused.some(({ intent: prior }) => prior.id === intent.id)),
    ].slice(-MAX_ACTIVE_CONVERSATION_INTENTS),
    selectedProducts: [
      ...(input.context.selectedProducts ?? []),
      ...(input.context.displayedProductReference && exactSelectedProduct ? [{
        intentId: input.context.displayedProductReference.intentId,
        position: input.context.displayedProductReference.position,
        product: exactSelectedProduct,
        selectedAtTurnId: input.turnId,
      }] : []),
      ...(input.context.displayedProductSelection?.groups.map(({ group, product }) => ({ intentId: group.intentId, position: input.context.displayedProductSelection!.position, product, selectedAtTurnId: input.turnId })) ?? []),
    ].slice(-8),
  };
}
