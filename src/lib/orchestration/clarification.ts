import type { Constraints, ShoppingIntent } from '../domain/contracts';
import type { RankedProduct } from '../ranking';
import type { IntentOutcome } from './contracts';

export type Clarification = {
  field: Exclude<keyof Constraints, 'sort'> | 'query';
  question: string;
  options: string[];
  reason: 'requested' | 'empty' | 'broad' | 'split';
};

const supplied = (constraints: Constraints, field: keyof Constraints): boolean => {
  const value = constraints[field];
  return Array.isArray(value) ? value.length > 0 : value !== undefined;
};

function categoryQuestion(
  products: readonly RankedProduct[],
  reason: Clarification['reason'],
  availableCategories: readonly string[],
): Clarification {
  const productCategories = [...new Set(products.map(({ product }) => product.category))];
  const categories = (productCategories.length > 1 ? productCategories : availableCategories)
    .slice(0, 3)
    .map((category) => category.split('-').map((word) => `${word[0]?.toLocaleUpperCase('en-US') ?? ''}${word.slice(1)}`).join(' '));
  return {
    field: 'category',
    question: reason === 'empty'
      ? 'What kind of product should I focus on?'
      : 'Which product category should I focus on?',
    options: categories,
    reason,
  };
}

function priceQuestion(products: readonly RankedProduct[], reason: Clarification['reason']): Clarification {
  const prices = products.map(({ product }) => product.price).sort((left, right) => left - right);
  const middle = prices.length ? prices[Math.floor((prices.length - 1) / 2)] : 100;
  const rounded = Math.max(25, Math.ceil(middle / 25) * 25);
  return {
    field: 'maxPrice',
    question: 'What is the most you want to spend?',
    options: [`Under $${rounded}`, `Under $${rounded * 2}`, `Under $${rounded * 4}`],
    reason,
  };
}

function ratingQuestion(reason: Clarification['reason']): Clarification {
  return {
    field: 'minRating',
    question: 'How important is a high customer rating?',
    options: ['4.5 stars or higher', '4 stars or higher', '3.5 stars or higher'],
    reason,
  };
}

function nextMissingQuestion(
  intent: ShoppingIntent,
  products: readonly RankedProduct[],
  reason: Clarification['reason'],
  availableCategories: readonly string[],
): Clarification | undefined {
  if (!supplied(intent.constraints, 'category')) return categoryQuestion(products, reason, availableCategories);
  if (!supplied(intent.constraints, 'maxPrice')) return priceQuestion(products, reason);
  if (!supplied(intent.constraints, 'minRating')) return ratingQuestion(reason);
  return {
    field: 'query',
    question: 'Should I broaden the product type to look for close alternatives?',
    options: ['Search related products', 'Use fewer search terms'],
    reason,
  };
}

/**
 * Decides whether a catalog result is useful enough to show without another
 * question. The policy is deliberately deterministic so provider and demo
 * plans cross the same boundary and can be tested without model judgment.
 */
export function evaluateClarification(
  intent: ShoppingIntent,
  products: readonly RankedProduct[],
  availableCategories: readonly string[] = [],
): Clarification | undefined {
  if (intent.status === 'needs_clarification') {
    if (products.length > 0 && supplied(intent.constraints, 'category')) return undefined;
    return nextMissingQuestion(intent, products, 'requested', availableCategories);
  }
  if (products.length === 0) {
    if (!supplied(intent.constraints, 'category')) return categoryQuestion(products, 'empty', availableCategories);
    return undefined;
  }

  if (supplied(intent.constraints, 'category')) return undefined;

  const [first, second, third] = products;
  const strongCluster = Boolean(
    second &&
    first.product.category === second.product.category &&
    (!third || second.score >= third.score * 1.25),
  );
  if (strongCluster) return undefined;

  const categories = new Set(products.map(({ product }) => product.category));
  const broad = products.length >= 5 && categories.size >= 3;
  const split = products.length >= 4 && categories.size >= 2;
  if (broad) return nextMissingQuestion(intent, products, 'broad', availableCategories);
  if (split) return nextMissingQuestion(intent, products, 'split', availableCategories);
  return undefined;
}

const INFORMATION_GAIN_PRIORITY: Record<Clarification['reason'], number> = {
  split: 4,
  broad: 3,
  empty: 2,
  requested: 1,
};

/** Keeps exactly one question per turn. Higher-entropy catalog evidence wins;
 * stable outcome order breaks ties so identical turns remain reproducible. */
export function selectTurnClarification(outcomes: IntentOutcome[]): IntentOutcome[] {
  let selectedIndex = -1;
  let selectedPriority = -1;
  outcomes.forEach((outcome, index) => {
    if (!outcome.clarification) return;
    const priority = INFORMATION_GAIN_PRIORITY[outcome.clarification.reason];
    if (priority > selectedPriority) {
      selectedIndex = index;
      selectedPriority = priority;
    }
  });
  return outcomes.map((outcome, index) =>
    outcome.clarification && index !== selectedIndex
      ? { ...outcome, clarification: undefined }
      : outcome);
}
