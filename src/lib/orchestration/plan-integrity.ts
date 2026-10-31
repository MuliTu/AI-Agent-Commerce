import type { ShoppingIntent } from '../domain/contracts';
import type { ExtractedIntent } from './contracts';

export type CategoryResolver = (
  requested: string | undefined,
  context: string,
  availableCategories: readonly string[],
) => string | undefined;

export type PlanCategoryCoverage = {
  explicitCategories: string[];
  extractedCategories: Array<string | undefined>;
  missingCategories: string[];
  duplicatedCategories: string[];
  requiresRepair: boolean;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function categorySegments(prompt: string): string[] {
  const coarse = prompt.split(/\s+(?:and|plus|וגם|בנוסף)\s+|[,;]|\([0-9]+\)/iu);
  return coarse.flatMap((segment) => {
    const attached = [...segment.matchAll(/\s+ו(?=\p{L})/gu)];
    if (attached.length === 0) return [segment];
    const parts: string[] = [];
    let start = 0;
    for (const match of attached) {
      const index = match.index;
      if (index === undefined) continue;
      parts.push(segment.slice(start, index));
      start = index + match[0].length;
    }
    parts.push(segment.slice(start));
    return parts;
  }).map((segment) => segment.trim()).filter(Boolean);
}

export function explicitPromptCategories(
  prompt: string,
  availableCategories: readonly string[],
  resolveCategory: CategoryResolver,
): string[] {
  return unique(categorySegments(prompt).flatMap((segment) => {
    const category = resolveCategory(undefined, segment, availableCategories);
    return category ? [category] : [];
  }));
}

export function inspectPlanCategoryCoverage(
  prompt: string,
  drafts: readonly ExtractedIntent[],
  availableCategories: readonly string[],
  resolveCategory: CategoryResolver,
): PlanCategoryCoverage {
  const explicitCategories = explicitPromptCategories(prompt, availableCategories, resolveCategory);
  const extractedCategories = drafts.map((draft) => resolveCategory(
    draft.constraints.category,
    `${draft.goal ?? ''} ${draft.query ?? ''}`,
    availableCategories,
  ));
  const extractedCounts = new Map<string, number>();
  for (const category of extractedCategories) {
    if (category) extractedCounts.set(category, (extractedCounts.get(category) ?? 0) + 1);
  }
  const missingCategories = explicitCategories.filter((category) => !extractedCounts.has(category));
  const duplicatedCategories = [...extractedCounts]
    .filter(([, count]) => count > 1)
    .map(([category]) => category);
  const multiCategoryPrompt = explicitCategories.length > 1;
  const hasOneDraftPerExplicitCategory = explicitCategories.length === drafts.length;
  return {
    explicitCategories,
    extractedCategories,
    missingCategories,
    duplicatedCategories,
    requiresRepair: multiCategoryPrompt
      && hasOneDraftPerExplicitCategory
      && (missingCategories.length > 0 || duplicatedCategories.length > 0),
  };
}

export type PriorIntentReference = Pick<ShoppingIntent, 'id'> & {
  constraints: Pick<ShoppingIntent['constraints'], 'category'>;
};

export type FollowUpTargetDecision =
  | { kind: 'not_refinement' }
  | { kind: 'single'; intentId: string; category?: string }
  | { kind: 'all'; intentIds: string[] }
  | { kind: 'clarify'; intentIds: string[]; categories: string[] };

function hasRefinementSignal(prompt: string): boolean {
  return /(?:\b(?:make|only|under|below|over|above|at least|at most|cheaper|cheap|rated|rating|stock|brand|budget)\b|\$\s*\d|(?:עד|מעל|מתחת|לפחות|רק|זול|דירוג|מלאי|תקציב))/iu.test(prompt);
}

function explicitlyTargetsAll(prompt: string): boolean {
  return /(?:\b(?:both|all|each|both of them|all of them)\b|(?:שניהם|שתיהן|שניהם|כולם|כולן|כל אחד|כל אחת))/iu.test(prompt);
}

export function isExclusiveNamedFollowUp(
  prompt: string,
  availableCategories: readonly string[],
  resolveCategory: CategoryResolver,
): boolean {
  const hasExclusiveMarker = /(?:\bonly\b|(?:^|\s)רק(?:\s|$))/iu.test(prompt);
  return hasExclusiveMarker
    && explicitPromptCategories(prompt, availableCategories, resolveCategory).length === 1;
}

export function decideFollowUpTargets(input: {
  prompt: string;
  previousIntents: readonly PriorIntentReference[];
  availableCategories: readonly string[];
  resolveCategory: CategoryResolver;
}): FollowUpTargetDecision {
  const { prompt, previousIntents, availableCategories, resolveCategory } = input;
  if (previousIntents.length === 0 || !hasRefinementSignal(prompt)) return { kind: 'not_refinement' };
  if (explicitlyTargetsAll(prompt)) {
    return { kind: 'all', intentIds: previousIntents.map(({ id }) => id) };
  }
  const explicitCategories = explicitPromptCategories(prompt, availableCategories, resolveCategory);
  if (explicitCategories.length === 1) {
    const category = explicitCategories[0];
    const matches = previousIntents.filter((intent) => intent.constraints.category === category);
    if (matches.length === 1) return { kind: 'single', intentId: matches[0].id, category };
  }
  if (previousIntents.length === 1) {
    const [intent] = previousIntents;
    return {
      kind: 'single',
      intentId: intent.id,
      ...(intent.constraints.category ? { category: intent.constraints.category } : {}),
    };
  }
  return {
    kind: 'clarify',
    intentIds: previousIntents.map(({ id }) => id),
    categories: unique(previousIntents.flatMap(({ constraints }) =>
      constraints.category ? [constraints.category] : [])),
  };
}
