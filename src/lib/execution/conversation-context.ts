import type { OrchestrationResult } from '../orchestration/contracts';
import type { ConversationMemoryState, IntentOperation } from '../persistence';

export type DisplayedProductReference = {
  intentId: string;
  position: number;
  product: {
    id: number;
    title: string;
    price: number;
    category: string;
  };
  selectionOnly: boolean;
  result: OrchestrationResult;
};

export type ConversationContext = {
  previous?: OrchestrationResult;
  stateRevision: number;
  currentFocusIntentId?: string;
  displayedProductReference?: DisplayedProductReference;
};

export const MAX_ACTIVE_CONVERSATION_INTENTS = 8;

const ORDINALS: ReadonlyArray<{ pattern: RegExp; position: number }> = [
  { pattern: /(?:\b(?:the\s+)?first\s+one\b|(?:^|\s)הראשו(?:ן|נה)(?:\s|$))/iu, position: 0 },
  { pattern: /(?:\b(?:the\s+)?second\s+one\b|(?:^|\s)השני(?:ה)?(?:\s|$))/iu, position: 1 },
  { pattern: /(?:\b(?:the\s+)?third\s+one\b|(?:^|\s)השלישי(?:ת)?(?:\s|$))/iu, position: 2 },
];

function ordinalPosition(prompt: string): number | undefined {
  return ORDINALS.find(({ pattern }) => pattern.test(prompt))?.position;
}

function isSelectionOnly(prompt: string): boolean {
  return /^(?:(?:please\s+)?(?:show|give|open|select)\s+(?:me\s+)?(?:the\s+)?(?:first|second|third)\s+one|(?:בבקשה\s+)?(?:הצג|תראה|בחר)(?:\s+לי)?\s+את\s+ה(?:ראשו(?:ן|נה)|שני(?:ה)?|שלישי(?:ת)?))[.!?\s]*$/iu.test(prompt.trim());
}

export function buildConversationContext(input: {
  prompt: string;
  persistedState?: ConversationMemoryState;
  latestCompletedResult?: OrchestrationResult;
}): ConversationContext {
  const previous = input.persistedState?.activeResult ?? input.latestCompletedResult;
  const position = ordinalPosition(input.prompt);
  if (position === undefined || !previous) {
    return {
      previous,
      stateRevision: input.persistedState?.revision ?? 0,
      currentFocusIntentId: input.persistedState?.currentFocusIntentId,
    };
  }
  const productOutcomes = previous.outcomes.filter(({ products }) => products.length > 0);
  if (productOutcomes.length !== 1 || !productOutcomes[0].products[position]) {
    return {
      previous,
      stateRevision: input.persistedState?.revision ?? 0,
      currentFocusIntentId: input.persistedState?.currentFocusIntentId,
    };
  }
  const outcome = productOutcomes[0];
  const selected = outcome.products[position];
  const isHebrew = /[\u0590-\u05ff]/u.test(input.prompt);
  return {
    previous,
    stateRevision: input.persistedState?.revision ?? 0,
    currentFocusIntentId: outcome.intent.id,
    displayedProductReference: {
      intentId: outcome.intent.id,
      position,
      product: {
        id: selected.product.id,
        title: selected.product.title,
        price: selected.product.price,
        category: selected.product.category,
      },
      selectionOnly: isSelectionOnly(input.prompt),
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
  if (result.outcomes.some(({ intent }) => intent.status === 'needs_clarification')) return 'clarify';
  if (!previous) return 'add';
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
  const selectedProduct = input.context.displayedProductReference?.selectionOnly === true;
  const operation = inferOperation(input.context.previous, input.result, selectedProduct);
  const unboundedActiveResult = operation === 'select_product'
    ? input.context.previous
    : operation === 'clarify' && input.context.previous
      ? {
          ...input.result,
          outcomes: [
            ...input.context.previous.outcomes.filter(({ intent }) => !input.result.outcomes
              .some(({ intent: currentIntent }) => currentIntent.id === intent.id)),
            ...input.result.outcomes,
          ],
        }
      : input.result;
  const activeResult = unboundedActiveResult && unboundedActiveResult.outcomes.length > MAX_ACTIVE_CONVERSATION_INTENTS
    ? { ...unboundedActiveResult, outcomes: unboundedActiveResult.outcomes.slice(-MAX_ACTIVE_CONVERSATION_INTENTS) }
    : unboundedActiveResult;
  const focusCandidates = input.result.outcomes.filter(({ intent }) =>
    intent.status !== 'failed' && intent.status !== 'needs_clarification');
  const focus = selectedProduct
    ? input.context.displayedProductReference?.intentId
    : focusCandidates.length === 1
      ? focusCandidates[0].intent.id
      : operation === 'add'
        ? focusCandidates.find(({ intent }) => !input.context.previous?.outcomes
          .some(({ intent: previousIntent }) => previousIntent.id === intent.id))?.intent.id
        : operation === 'clarify'
          ? input.context.currentFocusIntentId
          : undefined;
  return {
    conversationId: input.conversationId,
    revision: input.context.stateRevision + 1,
    activeResult,
    ...(focus ? { currentFocusIntentId: focus } : {}),
    lastOperation: operation,
    lastTurnId: input.turnId,
    updatedAt: input.completedAt,
  };
}
