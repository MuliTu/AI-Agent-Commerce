import { z } from 'zod';
import type { Product } from '../domain/contracts';
import type { FeatureEvidenceRequirement } from './feature-evidence';

export const semanticEvidenceVerdictSchema = z.enum(['supported', 'partial', 'contradicted', 'unknown']);
export const semanticEvidenceFieldSchema = z.enum(['title', 'description', 'tags']);
export const SEMANTIC_EVIDENCE_MAX_ASSESSMENTS = 40;

export const semanticEvidenceAssessmentSchema = z.object({
  productId: z.number().int().positive(),
  requirement: z.string().trim().min(1),
  verdict: semanticEvidenceVerdictSchema,
  confidence: z.number().min(0).max(1),
  relevanceScore: z.number().min(0).max(1),
  evidence: z.array(z.object({
    field: semanticEvidenceFieldSchema,
    quote: z.string().trim().min(1).max(500),
  }).strict()).max(4),
}).strict();

export const semanticEvidenceBatchSchema = z.object({
  assessments: z.array(semanticEvidenceAssessmentSchema).max(SEMANTIC_EVIDENCE_MAX_ASSESSMENTS),
}).strict();

export type SemanticEvidenceAssessment = z.infer<typeof semanticEvidenceAssessmentSchema>;
export type SemanticEvidenceBatch = z.infer<typeof semanticEvidenceBatchSchema>;
export type SemanticProductRelevance = {
  tier: 'supported' | 'partial' | 'unknown';
  score: number;
  confidence: number;
  evidence: Array<{ field: 'title' | 'description' | 'tags'; quote: string }>;
};

export type SemanticEvidenceInput = {
  products: Product[];
  requirements: FeatureEvidenceRequirement[];
};

export type SemanticEvidenceEvaluator = (input: SemanticEvidenceInput) => Promise<unknown>;

export type SemanticEvidenceReport =
  | { status: 'completed'; assessments: SemanticEvidenceAssessment[] }
  | { status: 'failed'; code: 'invalid_assessment' | 'evaluation_failed' };

export function semanticEvidenceCandidateLimit(requirementCount: number, preferredLimit = 30): number {
  const validatedRequirementCount = z.number().int().min(1).parse(requirementCount);
  const validatedPreferredLimit = z.number().int().min(1).parse(preferredLimit);
  if (validatedRequirementCount > SEMANTIC_EVIDENCE_MAX_ASSESSMENTS) return 0;
  return Math.min(
    validatedPreferredLimit,
    Math.max(1, Math.floor(SEMANTIC_EVIDENCE_MAX_ASSESSMENTS / validatedRequirementCount)),
  );
}

function fieldContainsQuote(product: Product, field: 'title' | 'description' | 'tags', quote: string): boolean {
  if (field === 'tags') return product.tags.some((tag) => tag.includes(quote));
  return product[field].includes(quote);
}

function normalize(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function containsNormalizedPhrase(haystack: string, needle: string): boolean {
  return needle.length > 0 && ` ${haystack} `.includes(` ${needle} `);
}

const NON_FEATURE_TOKENS = new Set([
  'a', 'an', 'the', 'only', 'show', 'find', 'me', 'please', 'with', 'whose', 'that', 'actually',
  'verified', 'documented', 'confirmed', 'confirms', 'catalog', 'listing', 'product', 'products',
  'phone', 'phones', 'smartphone', 'smartphones', 'laptop', 'laptops', 'fragrance', 'fragrances',
  'shoe', 'shoes', 'makeup', 'under', 'below', 'over', 'usd', 'dollars', 'dollar', 'and', 'or',
  'i', 'want', 'in', 'stock', 'are', 'is', 'no', 'guessing', 'guess', 'from', 'photo', 'for', 'to',
]);

function meaningfulTokens(requirement: FeatureEvidenceRequirement): string[] {
  return [...new Set(normalize(requirement.label).split(/\s+/u)
    .filter((token) => token.length > 1 && !/^\d+(?:\.\d+)?$/u.test(token) && !NON_FEATURE_TOKENS.has(token)))];
}

function directCatalogEvidence(
  product: Product,
  requirement: FeatureEvidenceRequirement,
): Array<{ field: 'title' | 'description' | 'tags'; quote: string }> | undefined {
  const fields = [
    { field: 'title' as const, values: [product.title] },
    { field: 'description' as const, values: [product.description] },
    { field: 'tags' as const, values: product.tags },
  ];
  const alternatives = requirement.alternatives.map(normalize).filter(Boolean);
  const requiredTokens = meaningfulTokens(requirement);
  for (const { field, values } of fields) {
    for (const value of values) {
      const normalizedValue = normalize(value);
      const alternativeMatch = alternatives.some((alternative) => containsNormalizedPhrase(normalizedValue, alternative));
      if (alternativeMatch) return [{ field, quote: value.slice(0, 500) }];
    }
  }
  const searchable = normalize(fields.flatMap(({ values }) => values).join(' '));
  if (requiredTokens.length > 0 && requiredTokens.every((token) => containsNormalizedPhrase(searchable, token))) {
    return fields.flatMap(({ field, values }) => values.flatMap((value) => {
      const normalizedValue = normalize(value);
      return requiredTokens.some((token) => containsNormalizedPhrase(normalizedValue, token))
        ? [{ field, quote: value.slice(0, 500) }]
        : [];
    })).slice(0, 4);
  }
  return undefined;
}

export function negativePreferenceTerms(prompt: string): string[] {
  const match = prompt.match(/\bnot\s+(?:a|an)\s+daytime\s+(?:freshie|fresh(?:\s+fragrance)?)\b/iu);
  return match ? ['everyday', 'fresh'] : [];
}

function productMatchesNegativePreference(product: Product, terms: readonly string[]): boolean {
  if (terms.length === 0) return false;
  const searchable = normalize([product.title, product.description, ...product.tags].join(' '));
  return terms.every((term) => containsNormalizedPhrase(searchable, normalize(term)));
}

/**
 * Treat model output as an untrusted proposal. Every requested product/claim
 * pair must be present exactly once, and every quote must be a literal span
 * from the trusted catalog fields. A supported verdict without a quote is
 * invalid rather than evidence.
 */
export function validateSemanticEvidenceBatch(
  value: unknown,
  input: SemanticEvidenceInput,
): SemanticEvidenceBatch {
  const parsed = semanticEvidenceBatchSchema.parse(value);
  const products = new Map(input.products.map((product) => [product.id, product]));
  const expected = new Set(input.products.flatMap((product) =>
    input.requirements.map((requirement) => `${product.id}\u0000${requirement.label}`)));
  const seen = new Set<string>();

  const normalizedAssessments: SemanticEvidenceAssessment[] = [];
  for (const assessment of parsed.assessments) {
    const key = `${assessment.productId}\u0000${assessment.requirement}`;
    if (!expected.has(key) || seen.has(key)) {
      throw new Error('Semantic evidence output contains an unexpected or duplicate assessment.');
    }
    seen.add(key);
    const product = products.get(assessment.productId);
    const requirement = input.requirements.find(({ label }) => label === assessment.requirement);
    if (!product || !requirement) throw new Error('Semantic evidence output references an unknown product or requirement.');
    const directEvidence = directCatalogEvidence(product, requirement);
    const quotedEvidenceIsValid = assessment.evidence.every(({ field, quote }) => fieldContainsQuote(product, field, quote));
    if (directEvidence && assessment.verdict !== 'contradicted') {
      normalizedAssessments.push({
        ...assessment,
        verdict: 'supported',
        evidence: directEvidence,
      });
      continue;
    }
    if (!quotedEvidenceIsValid
      || (assessment.verdict !== 'unknown' && assessment.evidence.length === 0)
      || (assessment.verdict === 'unknown' && assessment.evidence.length > 0)) {
      normalizedAssessments.push({ ...assessment, verdict: 'unknown', evidence: [] });
      continue;
    }
    normalizedAssessments.push(assessment);
  }
  if (seen.size !== expected.size) {
    throw new Error('Semantic evidence output is incomplete.');
  }
  return { assessments: normalizedAssessments };
}

export function requiresOnlyVerifiedEvidence(prompt: string): boolean {
  return /(?:\bonly\b[^.?!]{0,120}\b(?:verified|documented|confirmed|confirms?|stated|listed)\b|\bmust\s+be\s+(?:verified|documented|confirmed)\b|\bif\b[^.?!]{0,100}\b(?:does\s+not|doesn't|is\s+not|isn't)\b[^.?!]{0,50}\b(?:state|stated|mention|mentioned|list|listed|return\s+no|no\s+products?)\b|(?:רק|אך\s+ורק)[^.?!]{0,80}(?:מאומת|מתועד|מוזכר))/iu.test(prompt);
}

const tierOrder = { supported: 0, partial: 1, unknown: 2 } as const;

export function applySemanticEvidenceRanking<T extends { product: Product; score: number }>(input: {
  ranked: T[];
  assessments: SemanticEvidenceAssessment[];
  onlyVerified: boolean;
  negativeTerms?: string[];
}): Array<T & { semanticRelevance: SemanticProductRelevance }> {
  const byProduct = new Map<number, SemanticEvidenceAssessment[]>();
  for (const assessment of input.assessments) {
    const current = byProduct.get(assessment.productId) ?? [];
    current.push(assessment);
    byProduct.set(assessment.productId, current);
  }
  return input.ranked.flatMap((ranked) => {
    if (productMatchesNegativePreference(ranked.product, input.negativeTerms ?? [])) return [];
    const assessments = byProduct.get(ranked.product.id) ?? [];
    if (assessments.length === 0 || assessments.some(({ verdict }) => verdict === 'contradicted')) return [];
    const tier: SemanticProductRelevance['tier'] = assessments.every(({ verdict }) => verdict === 'supported')
      ? 'supported'
      : assessments.some(({ verdict }) => verdict === 'unknown')
        ? 'unknown'
        : 'partial';
    if (input.onlyVerified && tier !== 'supported') return [];
    const score = assessments.reduce((sum, assessment) => sum + assessment.relevanceScore, 0) / assessments.length;
    const confidence = assessments.reduce((sum, assessment) => sum + assessment.confidence, 0) / assessments.length;
    const evidence = assessments.flatMap(({ evidence: cited }) => cited)
      .filter((item, index, all) => all.findIndex((candidate) => candidate.field === item.field && candidate.quote === item.quote) === index)
      .slice(0, 4);
    return [{ ...ranked, semanticRelevance: { tier, score, confidence, evidence } }];
  }).sort((left, right) => tierOrder[left.semanticRelevance.tier] - tierOrder[right.semanticRelevance.tier]
    || right.semanticRelevance.score - left.semanticRelevance.score
    || right.score - left.score
    || left.product.id - right.product.id);
}

export async function runSemanticEvidenceEvaluation(input: {
  evaluator: SemanticEvidenceEvaluator;
  products: Product[];
  requirements: FeatureEvidenceRequirement[];
}): Promise<SemanticEvidenceReport> {
  let generated: unknown;
  try {
    generated = await input.evaluator({ products: input.products, requirements: input.requirements });
  } catch {
    return { status: 'failed', code: 'evaluation_failed' };
  }
  try {
    const validated = validateSemanticEvidenceBatch(generated, input);
    return { status: 'completed', assessments: validated.assessments };
  } catch {
    return { status: 'failed', code: 'invalid_assessment' };
  }
}
