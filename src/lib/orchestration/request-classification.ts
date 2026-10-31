import { resolveCatalogCategory } from './category-resolution';

export type RequestClassification = 'catalog_product' | 'outside_catalog' | 'unknown';

export type ClassifiedRequestSegment = {
  text: string;
  classification: RequestClassification;
};

const OUTSIDE_CATALOG = /(?:\b(?:weather|forecast|temperature|flight|flights|airfare|airline|hotel|hotels|booking|bookings|news|politics|recipe|joke)\b|\b(?:explain|define|calculate|compute|solve)\b|\b(?:what\s+is|who\s+is|how\s+does|how\s+do|tell\s+me\s+about)\b|\b\d+(?:\.\d+)?\s*(?:times|multiplied\s+by|divided\s+by|plus|minus)\s*\d+(?:\.\d+)?\b|מזג\s+האוויר|תחזית|טיס(?:ה|ות)|מלונ(?:ות|ון)|הזמנ(?:ה|ות)|חדשות|פוליטיקה|מתכון|בדיחה|(?:הסבר|הגדירו?|חשב|פתור)\b|מה\s+(?:זה|הם|היא|הוא)|מי\s+(?:זה|היא|הוא)|כמה\s+זה)/iu;

const BROAD_PRODUCT_LANGUAGE = /(?:\b(?:buy|shop|shopping|product|products|item|items|catalog|in\s+stock|brand|price|budget)\b|\b(?:find|show|recommend|looking\s+for|i\s+need|i\s+want)\b|מוצר(?:ים)?|קטלוג|מחיר|תקציב|מותג|במלאי|לקנות|קנייה|מחפש(?:ת|ים|ות)?|צריך(?:ה|ים|ות)?|רוצה|הראה|המלץ)/iu;

function normalize(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalize(value).split(/\s+/u).filter((token) => token.length > 2));
}

export function classifyRequestText(
  text: string,
  availableCategories: readonly string[],
): RequestClassification {
  const productCategory = resolveCatalogCategory(undefined, text, availableCategories);
  const outsideCatalog = OUTSIDE_CATALOG.test(text);
  if (productCategory && outsideCatalog) return 'unknown';
  if (productCategory) return 'catalog_product';
  if (outsideCatalog) return 'outside_catalog';
  if (BROAD_PRODUCT_LANGUAGE.test(text)) return 'unknown';
  return 'unknown';
}

/**
 * Splits only at strong request boundaries. Plain conjunctions remain intact so
 * product phrases such as "phone and charger" are not fragmented unnecessarily.
 */
export function classifyRequestSegments(
  prompt: string,
  availableCategories: readonly string[],
): ClassifiedRequestSegment[] {
  const segments = prompt
    .split(/\s*(?:[;,]|\band\s+then\b|\bthen\b|\band\s+(?=(?:explain|define|calculate|compute|solve|tell)\b)|וגם\s+(?=(?:הסבר|חשב|פתור)\b)|ואז)\s*/iu)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const bounded = segments.length > 0 ? segments : [prompt.trim()];
  return bounded.map((text) => ({ text, classification: classifyRequestText(text, availableCategories) }));
}

export function classifyIntentRequest(input: {
  prompt: string;
  intentContext: string;
  intentCount: number;
  availableCategories: readonly string[];
}): RequestClassification {
  const contextClassification = classifyRequestText(input.intentContext, input.availableCategories);
  if (contextClassification !== 'unknown') return contextClassification;
  if (input.intentCount === 1) return classifyRequestText(input.prompt, input.availableCategories);

  const contextTokens = tokens(input.intentContext);
  const matching = classifyRequestSegments(input.prompt, input.availableCategories)
    .filter(({ text }) => [...tokens(text)].some((token) => contextTokens.has(token)));
  const classifications = new Set(matching.map(({ classification }) => classification));
  if (classifications.size === 1) return matching[0].classification;
  return 'unknown';
}
