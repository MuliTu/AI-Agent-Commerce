const CATEGORY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'mobile-accessories': ['phone case', 'phone cases', 'phone charger', 'phone chargers', 'screen protector', 'screen protectors', 'mobile accessory', 'mobile accessories'],
  smartphones: ['iphone', 'iphones', 'phone', 'phones', 'smartphone', 'smartphones', 'mobile', 'mobiles', 'טלפון', 'טלפונים', 'סמארטפון', 'סמארטפונים'],
  fragrances: ['perfume', 'perfumes', 'fragrance', 'fragrances', 'cologne', 'colognes', 'בושם', 'בשמים'],
  laptops: ['laptop', 'laptops', 'notebook', 'notebooks', 'לפטופ', 'לפטופים', 'מחשב נייד', 'מחשבים ניידים'],
  luggage: ['luggage', 'suitcase', 'suitcases', 'bag', 'bags', 'מזוודה', 'מזוודות', 'תיק נסיעות'],
  'kitchen-accessories': ['plate', 'plates', 'dish', 'dishes', 'צלחת', 'צלחות', 'כלי אוכל'],
  tablets: ['tablet', 'tablets', 'ipad', 'ipads'],
  'mens-shoes': ['mens shoe', "men's shoe", 'mens shoes', "men's shoes"],
  'womens-shoes': ['womens shoe', "women's shoe", 'womens shoes', "women's shoes"],
};

function normalize(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function resolveCatalogCategory(
  requested: string | undefined,
  context: string,
  availableCategories: readonly string[],
): string | undefined {
  const available = new Map(availableCategories.map((category) => [normalize(category), category]));
  if (requested) {
    const exact = available.get(normalize(requested));
    if (exact) return exact;
  }

  const searchable = normalize(`${requested ?? ''} ${context}`);
  for (const [category, aliases] of Object.entries(CATEGORY_ALIASES)) {
    const trustedCategory = available.get(normalize(category));
    if (!trustedCategory) continue;
    if (aliases.some((alias) => new RegExp(`(?:^|\\s)${normalize(alias).replace(/ /g, '\\s+')}(?:$|\\s)`, 'u').test(searchable))) {
      return trustedCategory;
    }
  }

  return undefined;
}

function matchingSegments(
  prompt: string,
  context: string,
  intentCount: number,
  category: string | undefined,
  availableCategories: readonly string[],
): string[] {
  const segments = prompt.split(/\s+(?:and|plus|וגם|בנוסף)\s+|[,;]/iu).flatMap((segment) => {
    const attachedConjunction = /\s+ו(?=\p{L})/gu;
    for (const match of segment.matchAll(attachedConjunction)) {
      const prefix = segment.slice(0, match.index).trim();
      const suffix = segment.slice(match.index + match[0].length).trim();
      const prefixCategory = resolveCatalogCategory(undefined, prefix, availableCategories);
      const suffixCategory = resolveCatalogCategory(undefined, suffix, availableCategories);
      if (prefixCategory && suffixCategory && prefixCategory !== suffixCategory) return [prefix, suffix];
    }
    return [segment];
  });
  if (intentCount === 1) return segments;
  const contextTokens = new Set(normalize(context).split(/\s+/u).filter((token) => token.length > 2));
  return segments.filter((segment) => {
    if (category && resolveCatalogCategory(undefined, segment, availableCategories) === category) return true;
    return normalize(segment).split(/\s+/u).some((token) => token.length > 2 && contextTokens.has(token));
  });
}

export function intentHasUnsupportedIlsBudgetForCategory(
  prompt: string,
  context: string,
  intentCount: number,
  category: string | undefined,
  availableCategories: readonly string[],
): boolean {
  return matchingSegments(prompt, context, intentCount, category, availableCategories)
    .some((segment) => /(?:₪|\bILS\b|\bNIS\b)/iu.test(segment));
}

export function intentRequestsCheapOrdering(
  prompt: string,
  context: string,
  intentCount: number,
  category: string | undefined,
  availableCategories: readonly string[],
): boolean {
  return matchingSegments(prompt, context, intentCount, category, availableCategories)
    .some((segment) => /\b(?:cheap|cheaper|cheapest|lowest[ -]price|least expensive)\b/iu.test(segment));
}

export function intentHasExplicitUsdBudget(
  prompt: string,
  context: string,
  intentCount: number,
  category: string | undefined,
  availableCategories: readonly string[],
): boolean {
  return matchingSegments(prompt, context, intentCount, category, availableCategories)
    .some((segment) => /(?:\$\s*\d|\bUSD\s*\d|\d\s*USD\b|\bdollars?\s+\d|\d\s*dollars?\b|(?:^|\s)דולר(?:ים)?\s+\d|\d\s*דולר(?:ים)?(?![\p{L}\p{N}]))/iu.test(segment));
}

export function intentIsOutsideProductCatalog(
  prompt: string,
  context: string,
  intentCount: number,
): boolean {
  const outsideCatalog = /(?:\b(?:flight|flights|airfare|airline|hotel|hotels|booking|bookings)\b|טיס(?:ה|ות)|מלונ(?:ות|ון)|הזמנ(?:ה|ות))/iu;
  if (outsideCatalog.test(context)) return true;
  if (intentCount === 1) return outsideCatalog.test(prompt);
  return false;
}
