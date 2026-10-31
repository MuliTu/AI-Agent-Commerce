const CATEGORY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'mobile-accessories': ['phone case', 'phone cases', 'phone charger', 'phone chargers', 'screen protector', 'screen protectors', 'mobile accessory', 'mobile accessories'],
  smartphones: ['iphone', 'iphones', 'phone', 'phones', 'smartphone', 'smartphones', 'mobile', 'mobiles', 'טלפון', 'טלפונים', 'סמארטפון', 'סמארטפונים'],
  fragrances: ['perfume', 'perfumes', 'fragrance', 'fragrances', 'cologne', 'colognes', 'בושם', 'בשמים'],
  laptops: ['laptop', 'laptops', 'notebook', 'notebooks', 'לפטופ', 'לפטופים', 'מחשב נייד', 'מחשבים ניידים'],
  luggage: ['luggage', 'suitcase', 'suitcases', 'bag', 'bags', 'מזוודה', 'מזוודות', 'תיק נסיעות'],
  'kitchen-accessories': ['kitchen', 'kitchen accessory', 'kitchen accessories', 'plate', 'plates', 'dish', 'dishes', 'מטבח', 'למטבח', 'אביזרי מטבח', 'צלחת', 'צלחות', 'כלי אוכל'],
  tablets: ['tablet', 'tablets', 'ipad', 'ipads'],
  'mens-shoes': ['mens shoe', "men's shoe", 'mens shoes', "men's shoes"],
  'womens-shoes': ['womens shoe', "women's shoe", 'womens shoes', "women's shoes"],
};

function normalize(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function categoryIsMentioned(
  context: string,
  category: string,
  availableCategories: readonly string[],
): boolean {
  const trustedCategory = availableCategories.find((candidate) => candidate === category);
  if (!trustedCategory) return false;
  const searchable = normalize(context);
  const terms = [trustedCategory, ...(CATEGORY_ALIASES[category] ?? [])];
  return terms.some((term) => {
    const normalizedTerm = normalize(term).replace(/ /g, '\\s+');
    const hebrewPrefix = /[\u0590-\u05ff]/u.test(term) ? '(?:ו?ה?)?' : '';
    return new RegExp(
      `(?:^|\\s)${hebrewPrefix}${normalizedTerm}(?:$|\\s)`,
      'u',
    ).test(searchable);
  });
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
  for (const [normalizedCategory, category] of available) {
    if (new RegExp(`(?:^|\\s)${normalizedCategory.replace(/ /g, '\\s+')}(?:$|\\s)`, 'u').test(searchable)) {
      return category;
    }
  }
  for (const [category, aliases] of Object.entries(CATEGORY_ALIASES)) {
    const trustedCategory = available.get(normalize(category));
    if (!trustedCategory) continue;
    if (aliases.some((alias) => {
      const prefix = /[\u0590-\u05ff]/u.test(alias) ? '(?:ו?ה?)?' : '';
      return new RegExp(`(?:^|\\s)${prefix}${normalize(alias).replace(/ /g, '\\s+')}(?:$|\\s)`, 'u').test(searchable);
    })) {
      return trustedCategory;
    }
  }

  return undefined;
}

export function isCatalogCategoryGrounded(
  prompt: string,
  intentContext: string,
  category: string,
  availableCategories: readonly string[],
): boolean {
  return categoryIsMentioned(prompt, category, availableCategories)
    && categoryIsMentioned(intentContext, category, availableCategories);
}

export function isConstraintOnlyFollowUp(
  prompt: string,
  availableCategories: readonly string[],
): boolean {
  if (resolveCatalogCategory(undefined, prompt, availableCategories)) return false;
  return /(?:\b(?:under|below|less than|at most|max(?:imum)?|budget|cheaper|cheap|cheapest|only in stock|in stock only)\b|\$\s*\d|\d\s*(?:USD|dollars?)\b|(?:עד|פחות מ|תקציב|זול(?:ה|ים|ות)?|רק במלאי))/iu.test(prompt);
}

export function explicitUsdMaxPrice(prompt: string): number | undefined {
  const match = prompt.match(/(?:\$\s*(\d+(?:\.\d+)?)|\b(?:under|below|less than|no more than|at most|max(?:imum)?|budget(?: of)?)\s+\$?(\d+(?:\.\d+)?)\b|\b(\d+(?:\.\d+)?)\s*(?:USD|dollars?)\b|(?:עד|פחות מ|תקציב(?: של)?)\s*\$?\s*(\d+(?:\.\d+)?)(?:\s*דולר(?:ים)?)?)/iu);
  const value = Number(match?.slice(1).find(Boolean));
  return Number.isFinite(value) ? value : undefined;
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
  const outsideCatalog = /(?:\b(?:flight|flights|airfare|airline|hotel|hotels|booking|bookings|weather|forecast|temperature|news|politics|joke|recipe)\b|\b(?:how are you|who are you|ignore (?:all |the )?(?:previous )?instructions|reveal (?:the |your )?(?:system )?prompt)\b|טיס(?:ה|ות)|מלונ(?:ות|ון)|הזמנ(?:ה|ות)|מזג\s+האוויר|תחזית|חדשות|פוליטיקה|ספר\s+לי\s+בדיחה|התעלם\s+מההנחיות)/iu;
  if (outsideCatalog.test(context)) return true;
  if (intentCount === 1) return outsideCatalog.test(prompt);
  return false;
}
