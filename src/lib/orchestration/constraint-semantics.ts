import { resolveCatalogCategory } from './category-resolution';

export type ConstraintSemanticIssue = {
  kind:
    | 'brand_exclusion'
    | 'minimum_price'
    | 'contradictory_price'
    | 'aggregate_budget'
    | 'ambiguous_multi_intent_budget';
  disposition: 'needs_clarification' | 'unsupported';
  message: string;
  excludedBrands?: string[];
  minPrice?: number;
  maxPrice?: number;
  categories?: string[];
};

export type ConstraintSemantics = {
  status: 'supported' | 'needs_clarification' | 'unsupported';
  budgetScope: 'single' | 'each' | 'aggregate' | 'ambiguous' | 'none';
  issues: ConstraintSemanticIssue[];
};

const amount = String.raw`\$?\s*([0-9]+(?:\.[0-9]+)?)`;

function numericMatch(prompt: string, pattern: RegExp): number | undefined {
  const match = prompt.match(pattern);
  const value = Number(match?.[1]);
  return Number.isFinite(value) ? value : undefined;
}

function excludedBrands(prompt: string): string[] {
  const patterns = [
    /\b(?:not(?!\s+sure\b)|except|excluding|exclude|without|anything\s+(?:but|except))\s+(?:made\s+by\s+)?([\p{L}\p{N}][\p{L}\p{N} .&'-]{0,40})/giu,
    /(?:לא|בלי|ללא|חוץ\s+מ|מלבד)\s+(?:של\s+)?([\p{L}\p{N}][\p{L}\p{N} .&'-]{0,40})/gu,
  ];
  const blockedTail = /\b(?:under|over|below|above|price|budget|expensive|cheap|in stock|with|guess|recommend|state|states|stated|list|lists|listed|mention|mentions|mentioned|omit|omits|omitted|show|shows|shown|available|sell|sells|sold|catalog)\b|(?:יקר|זול|לנחש|תנחש)/iu;
  const brands = patterns.flatMap((pattern) => [...prompt.matchAll(pattern)].flatMap((match) => {
    const candidate = match[1]
      ?.replace(/^(?:anything\s+(?:made\s+by|from)|products?\s+(?:made\s+by|from))\s+/iu, '')
      .split(/[,;]|\s+(?:and|but|with|under|over|that|which|וגם|אבל|עם|עד|מעל)\b/iu)[0]
      ?.trim().replace(/[.?!]+$/u, '');
    return candidate && !blockedTail.test(candidate) ? [candidate] : [];
  }));
  return [...new Set(brands)];
}

function mentionedCategories(prompt: string, availableCategories: readonly string[]): string[] {
  const segments = prompt.split(/[,;]|\s+(?:and|plus|וגם|בנוסף)\s+|\s+ו(?=\p{L})/iu);
  const categories = segments.flatMap((segment) => {
    const category = resolveCatalogCategory(undefined, segment, availableCategories);
    return category ? [category] : [];
  });
  return [...new Set(categories)];
}

function hasUnscopedTrailingBudget(prompt: string, availableCategories: readonly string[]): boolean {
  const segments = prompt.split(/[,;]|\s+(?:and|plus|וגם|בנוסף)\s+|\s+ו(?=\p{L})/iu)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const budgetPattern = /(?:\b(?:under|below|less\s+than|no\s+more\s+than|at\s+most|maximum|max|ceiling|budget(?:\s+of)?)\b|עד|פחות\s+מ|מקסימום|תקציב(?:\s+של)?)\s*\$?\s*[0-9]+(?:\.[0-9]+)?(?:\s*(?:USD|dollars?|דולר(?:ים)?))?/iu;
  if ([...prompt.matchAll(new RegExp(budgetPattern.source, 'giu'))].length !== 1) return false;
  const budgetSegments = segments.flatMap((segment, index) => budgetPattern.test(segment) ? [index] : []);
  if (budgetSegments.length !== 1 || budgetSegments[0] !== segments.length - 1) return false;

  const segment = segments[budgetSegments[0]];
  const category = resolveCatalogCategory(undefined, segment, availableCategories);
  if (!category) return false;
  const withoutBudget = segment.replace(budgetPattern, ' ')
    .replace(/\b(?:find|show|need|want|a|an|the|me|please)\b/giu, ' ')
    .replace(/(?:מצא|הצג|תראה|לי|בבקשה)/gu, ' ')
    .trim();
  const remainingWords = withoutBudget.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  const categoryWords = category.match(/[\p{L}\p{N}]+/gu)?.length ?? 1;
  return remainingWords <= categoryWords;
}

export function analyzeConstraintSemantics(
  prompt: string,
  availableCategories: readonly string[] = [],
): ConstraintSemantics {
  const issues: ConstraintSemanticIssue[] = [];
  const exclusions = excludedBrands(prompt);
  if (exclusions.length) {
    issues.push({
      kind: 'brand_exclusion',
      disposition: 'unsupported',
      excludedBrands: exclusions,
      message: `Brand exclusion is not supported. Requested exclusion: ${exclusions.join(', ')}.`,
    });
  }

  // Keep rating phrases such as "at least 4 stars" / "לפחות 4" out of
  // price semantics. The currency-less forms below are deliberately limited
  // to unambiguous price language.
  const minPrice = numericMatch(prompt, new RegExp(String.raw`(?:\b(?:over|above|(?<!no\s)more\s+than|minimum\s+price|min\s+price)\b|מעל|מחיר\s+מינימלי|מינימום\s+מחיר)\s*${amount}`, 'iu'))
    ?? numericMatch(prompt, /(?:\bat\s+least\b|לפחות)\s*\$\s*([0-9]+(?:\.[0-9]+)?)/iu)
    ?? numericMatch(prompt, /(?:\bat\s+least\b|לפחות)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:USD|dollars?|דולר(?:ים)?)/iu);
  const maxPrice = numericMatch(prompt, new RegExp(String.raw`(?:\b(?:under|below|less\s+than|no\s+more\s+than|at\s+most|maximum|max|ceiling|budget(?:\s+of)?)\b|עד|פחות\s+מ|מקסימום|תקציב(?:\s+של)?)\s*${amount}`, 'iu'));
  if (minPrice !== undefined && maxPrice !== undefined && minPrice >= maxPrice) {
    issues.push({
      kind: 'contradictory_price',
      disposition: 'needs_clarification',
      minPrice,
      maxPrice,
      message: `The requested minimum price (${minPrice}) conflicts with the maximum price (${maxPrice}).`,
    });
  } else if (minPrice !== undefined) {
    issues.push({
      kind: 'minimum_price',
      disposition: 'unsupported',
      minPrice,
      ...(maxPrice === undefined ? {} : { maxPrice }),
      message: 'Minimum-price filtering is not supported.',
    });
  }

  const hasBudget = /(?:\$\s*\d|\b\d+(?:\.\d+)?\s*(?:USD|dollars?)\b|\b(?:budget|under|below|at most|max(?:imum)?|ceiling)\b|תקציב|עד\s*\d)/iu.test(prompt);
  const aggregate = /\b(?:total|together|combined|altogether|in\s+total|all\s+in)\b|בסך\s*הכל|ביחד|יחד|סך\s*כולל/iu.test(prompt);
  const each = /\b(?:each|apiece|per\s+(?:item|product)|both\s+of\s+them\s+under)\b|כל\s+אחד|לכל\s+(?:פריט|מוצר)|שניהם\s+עד/iu.test(prompt);
  const categories = mentionedCategories(prompt, availableCategories);

  let budgetScope: ConstraintSemantics['budgetScope'] = 'none';
  if (aggregate && hasBudget) {
    budgetScope = 'aggregate';
    issues.push({
      kind: 'aggregate_budget',
      disposition: 'needs_clarification',
      ...(maxPrice === undefined ? {} : { maxPrice }),
      ...(categories.length ? { categories } : {}),
      message: 'Combined or aggregate budgets are not supported; ask for separate per-product limits.',
    });
  } else if (each && hasBudget) {
    budgetScope = 'each';
  } else if (hasBudget && categories.length > 1 && hasUnscopedTrailingBudget(prompt, availableCategories)) {
    budgetScope = 'ambiguous';
    issues.push({
      kind: 'ambiguous_multi_intent_budget',
      disposition: 'needs_clarification',
      ...(maxPrice === undefined ? {} : { maxPrice }),
      categories,
      message: 'The budget could apply to more than one product intent; ask which product it applies to.',
    });
  } else if (hasBudget) {
    budgetScope = 'single';
  }

  const status = issues.some(({ disposition }) => disposition === 'needs_clarification')
    ? 'needs_clarification'
    : issues.length
      ? 'unsupported'
      : 'supported';
  return { status, budgetScope, issues };
}
