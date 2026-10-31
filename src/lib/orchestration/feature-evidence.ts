import type { Product } from '../domain/contracts';
import { resolveCatalogCategory } from './category-resolution';

export type FeatureEvidenceRequirement = {
  label: string;
  alternatives: readonly string[];
};

const FEATURE_REQUIREMENTS: readonly FeatureEvidenceRequirement[] = [
  { label: 'IP68 certification', alternatives: ['ip68'] },
  { label: 'wireless charging', alternatives: ['wireless charging', 'wireless charge'] },
  { label: 'eSIM support', alternatives: ['esim'] },
  { label: 'NFC support', alternatives: ['nfc'] },
  { label: 'camera capabilities', alternatives: ['camera', 'photography', 'photographic'] },
  { label: 'evening use', alternatives: ['evening', 'night'] },
];

function normalize(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const EXPLICIT_PROOF_LANGUAGE = /\b(?:verified|documented|catalog|description|details|listing|product\s+text)\b[^.?!]{0,100}\b(?:state|states|stated|mention|mentions|mentioned|list|lists|listed|show|shows|shown|describe|describes|described|say|says)\b/iu;

function cleanFeaturePhrase(value: string): string | undefined {
  const cleaned = normalize(value)
    .replace(/^(?:if|when|whether|the|a|an)\s+/u, '')
    .split(/\b(?:if|when|but|otherwise|return|say|rather|instead)\b/u)[0]
    ?.replace(/\b(?:support|feature|capability|capabilities)\s*$/u, '')
    .trim();
  if (!cleaned || cleaned.split(/\s+/u).length > 8) return undefined;
  if (/^(?:it|this|that|them|the feature|such a phone|phone|smartphone|product|products)$/u.test(cleaned)) return undefined;
  return cleaned;
}

function genericExplicitRequirements(prompt: string): FeatureEvidenceRequirement[] {
  if (!EXPLICIT_PROOF_LANGUAGE.test(prompt)) return [];
  const candidates: string[] = [];
  const patterns = [
    /(?:catalog|description|details|listing|product\s+text)[^.?!,;]{0,40}\b(?:does\s+not|doesn't|do\s+not|is\s+not|isn't)?\s*(?:state|mention|list|show|describe|say)s?\s+([^,.!?;]{2,80})/giu,
    /([^,.!?;]{2,70}?)\s+(?:is|are)\s+not\s+(?:stated|mentioned|listed|shown|described)\b/giu,
    /\b(?:with|having)\s+(?:verified|documented)\s+([^,.!?;]{2,70})/giu,
  ];
  for (const pattern of patterns) {
    for (const match of prompt.matchAll(pattern)) {
      const phrase = cleanFeaturePhrase(match[1] ?? '');
      if (phrase) candidates.push(phrase);
    }
  }
  if (candidates.length === 0) {
    for (const match of prompt.matchAll(/\bwith\s+([^,.!?;]{2,70})/giu)) {
      const phrase = cleanFeaturePhrase(match[1] ?? '');
      if (phrase) candidates.push(phrase.replace(/^(?:verified|documented)\s+/u, ''));
    }
  }
  if (candidates.length === 0) {
    return [{ label: 'explicitly requested catalog feature', alternatives: [] }];
  }
  return [...new Set(candidates)].map((phrase) => ({
    label: phrase,
    alternatives: [phrase],
  }));
}

/**
 * Returns only requirements the shopper clearly asks the catalog to establish.
 * The vocabulary is deliberately bounded: an unknown adjective remains ranking
 * context instead of being silently promoted to a hard catalog fact.
 */
export function requestedFeatureEvidence(prompt: string): FeatureEvidenceRequirement[] {
  const normalized = normalize(prompt);
  const requiresEvidence = /\b(?:verified|verify|must have|must support|with|has|have|supports?|mentions?|stated|says?|capabilit(?:y|ies)|certification)\b/u.test(normalized);
  const curated = FEATURE_REQUIREMENTS.filter(({ label, alternatives }) => {
    const hebrewEveningMention = label === 'evening use'
      && /(?:בושם|ניחוח).{0,20}(?:לערב|ערב)|(?:לערב|ערב).{0,20}(?:בושם|ניחוח)/u.test(prompt);
    const mentioned = hebrewEveningMention
      || alternatives.some((term) => normalized.includes(normalize(term)));
    if (!mentioned) return false;
    if (requiresEvidence) return true;
    if (label === 'camera capabilities') return /\b(?:camera focused|good camera|camera capabilities)\b/u.test(normalized);
    if (label === 'evening use') {
      return /\bevening\s+(?:fragrance|perfume|scent)\b/u.test(normalized) || hebrewEveningMention;
    }
    return false;
  });
  const curatedTerms = curated.flatMap(({ alternatives }) => alternatives.map(normalize));
  const generic = genericExplicitRequirements(prompt).filter(({ alternatives }) =>
    alternatives.length === 0 || !alternatives.some((candidate) => {
      const normalizedCandidate = normalize(candidate);
      return curatedTerms.some((term) => term.includes(normalizedCandidate) || normalizedCandidate.includes(term));
    }));
  return [...curated, ...generic];
}

export function requestedFeatureEvidenceForIntent(input: {
  prompt: string;
  intentContext: string;
  category: string | undefined;
  intentCount: number;
  availableCategories: readonly string[];
}): FeatureEvidenceRequirement[] {
  if (input.intentCount === 1 || !input.category) {
    return requestedFeatureEvidence(`${input.prompt} ${input.intentContext}`);
  }
  const segments = input.prompt
    .split(/[.!?;,]|\s+(?:and|plus|וגם|בנוסף)\s+|\s+ו(?=\p{L})/iu)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const categorySegments = segments.filter((segment) =>
    resolveCatalogCategory(undefined, segment, input.availableCategories) === input.category);
  const scopedText = `${categorySegments.join(' ')} ${input.intentContext}`;
  const scoped = requestedFeatureEvidence(scopedText);
  const normalizedScope = normalize(scopedText);
  const relevantGlobal = requestedFeatureEvidence(input.prompt).filter(({ alternatives }) =>
    alternatives.length > 0 && alternatives.some((term) => normalizedScope.includes(normalize(term))));
  const byLabel = new Map([...scoped, ...relevantGlobal].map((requirement) => [requirement.label, requirement]));
  return [...byLabel.values()];
}

export function productEstablishesFeatureEvidence(
  product: Product,
  requirement: FeatureEvidenceRequirement,
): boolean {
  const searchable = normalize([
    product.title,
    product.description,
    ...product.tags,
  ].join(' '));
  return requirement.alternatives.some((term) => searchable.includes(normalize(term)));
}

export function filterProductsByFeatureEvidence(
  products: readonly Product[],
  requirements: readonly FeatureEvidenceRequirement[],
): Product[] {
  if (requirements.length === 0) return [...products];
  return products.filter((product) => requirements.every((requirement) =>
    productEstablishesFeatureEvidence(product, requirement)));
}
