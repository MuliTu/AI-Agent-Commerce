import { z } from 'zod';
import type { Product } from '../domain/contracts';
import type { FeatureEvidenceRequirement } from './feature-evidence';

export const semanticEvidenceVerdictSchema = z.enum(['supported', 'contradicted', 'unknown']);
export const semanticEvidenceFieldSchema = z.enum(['title', 'description', 'tags']);

export const semanticEvidenceAssessmentSchema = z.object({
  productId: z.number().int().positive(),
  requirement: z.string().trim().min(1),
  verdict: semanticEvidenceVerdictSchema,
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.object({
    field: semanticEvidenceFieldSchema,
    quote: z.string().trim().min(1).max(500),
  }).strict()).max(4),
}).strict();

export const semanticEvidenceBatchSchema = z.object({
  assessments: z.array(semanticEvidenceAssessmentSchema).max(40),
}).strict();

export type SemanticEvidenceAssessment = z.infer<typeof semanticEvidenceAssessmentSchema>;
export type SemanticEvidenceBatch = z.infer<typeof semanticEvidenceBatchSchema>;

export type SemanticEvidenceInput = {
  products: Product[];
  requirements: FeatureEvidenceRequirement[];
};

export type SemanticEvidenceEvaluator = (input: SemanticEvidenceInput) => Promise<unknown>;

export type SemanticEvidenceShadowReport =
  | { status: 'completed'; assessments: SemanticEvidenceAssessment[] }
  | { status: 'failed'; code: 'invalid_assessment' | 'evaluation_failed' };

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
      throw new Error('A supported or contradicted semantic evidence verdict requires an exact catalog quote.');
    }
  }
  if (seen.size !== expected.size) {
    throw new Error('Semantic evidence output is incomplete.');
  }
  return parsed;
}

export async function runSemanticEvidenceShadow(input: {
  evaluator: SemanticEvidenceEvaluator;
  products: Product[];
  requirements: FeatureEvidenceRequirement[];
}): Promise<SemanticEvidenceShadowReport> {
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
