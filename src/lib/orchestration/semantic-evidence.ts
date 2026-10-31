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

export function semanticEvidenceCandidateLimit(requirementCount: number, preferredLimit = 12): number {
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

  for (const assessment of parsed.assessments) {
    const key = `${assessment.productId}\u0000${assessment.requirement}`;
    if (!expected.has(key) || seen.has(key)) {
      throw new Error('Semantic evidence output contains an unexpected or duplicate assessment.');
    }
    seen.add(key);
    const product = products.get(assessment.productId);
    if (!product || assessment.evidence.some(({ field, quote }) => !fieldContainsQuote(product, field, quote))) {
      throw new Error('Semantic evidence output cites text outside the trusted catalog fields.');
    }
    if (assessment.verdict !== 'unknown' && assessment.evidence.length === 0) {
      throw new Error('A supported, partial, or contradicted semantic evidence verdict requires an exact catalog quote.');
    }
    if (assessment.verdict === 'unknown' && assessment.evidence.length > 0) {
      throw new Error('An unknown semantic evidence verdict cannot claim catalog evidence.');
    }
  }
  if (seen.size !== expected.size) {
    throw new Error('Semantic evidence output is incomplete.');
  }
  return parsed;
}

export function requiresOnlyVerifiedEvidence(prompt: string): boolean {
  return /(?:\bonly\b[^.?!]{0,50}\b(?:verified|documented|confirmed|stated|listed)\b|\bmust\s+be\s+(?:verified|documented|confirmed)\b|\bif\b[^.?!]{0,100}\b(?:does\s+not|doesn't|is\s+not|isn't)\b[^.?!]{0,50}\b(?:state|stated|mention|mentioned|list|listed|return\s+no|no\s+products?)\b|(?:רק|אך\s+ורק)[^.?!]{0,50}(?:מאומת|מתועד|מוזכר))/iu.test(prompt);
}

const tierOrder = { supported: 0, partial: 1, unknown: 2 } as const;

export function applySemanticEvidenceRanking<T extends { product: Product; score: number }>(input: {
  ranked: T[];
  assessments: SemanticEvidenceAssessment[];
  onlyVerified: boolean;
}): Array<T & { semanticRelevance: SemanticProductRelevance }> {
  const byProduct = new Map<number, SemanticEvidenceAssessment[]>();
  for (const assessment of input.assessments) {
    const current = byProduct.get(assessment.productId) ?? [];
    current.push(assessment);
    byProduct.set(assessment.productId, current);
  }
  return input.ranked.flatMap((ranked) => {
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
