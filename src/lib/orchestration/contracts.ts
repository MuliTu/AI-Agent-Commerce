import { z } from 'zod';
import { productSchema, type Constraints, type Product, type ShoppingIntent, type TurnStatus } from '../domain/contracts';
import type { RankedProduct } from '../ranking';
import type { SemanticProductRelevance } from './semantic-evidence';

export const intentConstraintsSchema = z.object({
  maxPrice: z.number().nonnegative().optional(),
  minRating: z.number().min(0).max(5).optional(),
  category: z.string().trim().min(1).optional(),
  inStock: z.boolean().optional(),
  brands: z.array(z.string().trim().min(1)).min(1).optional(),
  requiredTags: z.array(z.string().trim().min(1)).min(1).optional(),
  sort: z.literal('price_asc').optional(),
}).strict();

export const extractedIntentSchema = z.object({
  intentId: z.string().trim().min(1).optional(),
  goal: z.string().trim().min(1).optional(),
  query: z.string().trim().min(1).optional(),
  constraints: intentConstraintsSchema.default({}),
  status: z.enum(['ready', 'needs_clarification']).default('ready'),
}).strict();

export const priceSemanticsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('sort_low_to_high') }).strict(),
  z.object({
    kind: z.literal('cheaper_than_reference'),
    referenceId: z.string().trim().min(1).optional(),
  }).strict(),
]);

export const semanticOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('pause_intent'), intentId: z.string().trim().min(1) }).strict(),
  z.object({ op: z.literal('resume_intent'), intentId: z.string().trim().min(1) }).strict(),
  z.object({ op: z.literal('search'), intentIndex: z.number().int().nonnegative() }).strict(),
  z.object({
    op: z.literal('refine_intent'),
    intentIndex: z.number().int().nonnegative(),
    intentId: z.string().trim().min(1),
  }).strict(),
  z.object({
    op: z.literal('select_product'),
    referenceId: z.string().trim().min(1),
    presentation: z.enum(['show', 'describe']),
  }).strict(),
  z.object({
    op: z.literal('clarify'),
    reason: z.enum(['missing_intent_target', 'missing_price_reference', 'ambiguous_budget_scope', 'unsupported_constraint']),
    candidateIntentIds: z.array(z.string().trim().min(1)).default([]),
  }).strict(),
]);

export const extractedTurnPlanSchema = z.object({
  intents: z.array(extractedIntentSchema).min(1).max(8),
  operations: z.array(semanticOperationSchema).min(1).max(16).optional(),
  priceSemantics: z.array(priceSemanticsSchema).max(8).optional(),
  response: z.string().trim().min(1),
}).strict();

const providerIntentConstraintsSchema = z.object({
  maxPrice: z.number().nonnegative().nullable(),
  minRating: z.number().min(0).max(5).nullable(),
  category: z.string().trim().min(1).nullable(),
  inStock: z.boolean().nullable(),
  brands: z.array(z.string().trim().min(1)).min(1).nullable(),
  requiredTags: z.array(z.string().trim().min(1)).min(1).nullable(),
  sort: z.literal('price_asc').nullable(),
}).strict().transform((constraints) => ({
  ...(constraints.maxPrice === null ? {} : { maxPrice: constraints.maxPrice }),
  ...(constraints.minRating === null ? {} : { minRating: constraints.minRating }),
  ...(constraints.category === null ? {} : { category: constraints.category }),
  ...(constraints.inStock === null ? {} : { inStock: constraints.inStock }),
  ...(constraints.brands === null ? {} : { brands: constraints.brands }),
  ...(constraints.requiredTags === null ? {} : { requiredTags: constraints.requiredTags }),
  ...(constraints.sort === null ? {} : { sort: constraints.sort }),
}));

const providerExtractedIntentSchema = z.object({
  intentId: z.string().trim().min(1).nullable(),
  goal: z.string().trim().min(1).nullable(),
  query: z.string().trim().min(1).nullable(),
  constraints: providerIntentConstraintsSchema,
  status: z.enum(['ready', 'needs_clarification']),
}).strict().transform((intent) => ({
  ...(intent.intentId === null ? {} : { intentId: intent.intentId }),
  ...(intent.goal === null ? {} : { goal: intent.goal }),
  ...(intent.query === null ? {} : { query: intent.query }),
  constraints: intent.constraints,
  status: intent.status,
}));

const providerPriceSemanticsSchema = z.object({
  kind: z.enum(['none', 'sort_low_to_high', 'cheaper_than_reference']),
  referenceId: z.string().trim().min(1).nullable(),
}).strict().transform(({ kind, referenceId }) => (
  kind === 'cheaper_than_reference'
    ? { kind, ...(referenceId === null ? {} : { referenceId }) }
    : { kind }
));

const providerSemanticOperationSchema = z.object({
  op: z.enum(['pause_intent', 'resume_intent', 'search', 'refine_intent', 'select_product', 'clarify']),
  intentId: z.string().trim().min(1).nullable(),
  intentIndex: z.number().int().nonnegative().nullable(),
  referenceId: z.string().trim().min(1).nullable(),
  presentation: z.enum(['show', 'describe']).nullable(),
  reason: z.enum(['missing_intent_target', 'missing_price_reference', 'ambiguous_budget_scope', 'unsupported_constraint']).nullable(),
  candidateIntentIds: z.array(z.string().trim().min(1)),
}).strict().transform((operation, context) => {
  const fail = (message: string): never => {
    context.addIssue({ code: 'custom', message });
    return z.NEVER;
  };
  switch (operation.op) {
    case 'pause_intent':
    case 'resume_intent':
      return operation.intentId ? { op: operation.op, intentId: operation.intentId } : fail(`${operation.op} requires intentId`);
    case 'search':
      return operation.intentIndex !== null ? { op: operation.op, intentIndex: operation.intentIndex } : fail('search requires intentIndex');
    case 'refine_intent':
      return operation.intentId && operation.intentIndex !== null
        ? { op: operation.op, intentId: operation.intentId, intentIndex: operation.intentIndex }
        : fail('refine_intent requires intentId and intentIndex');
    case 'select_product':
      return operation.referenceId && operation.presentation
        ? { op: operation.op, referenceId: operation.referenceId, presentation: operation.presentation }
        : fail('select_product requires referenceId and presentation');
    case 'clarify':
      return operation.reason
        ? { op: operation.op, reason: operation.reason, candidateIntentIds: operation.candidateIntentIds }
        : fail('clarify requires reason');
  }
});

/**
 * Provider-facing wire schema. OpenAI structured outputs require every object
 * property to be required, so optional domain values are nullable on the wire
 * and normalized back to the application shape.
 */
export const providerExtractedTurnPlanSchema = z.object({
  intents: z.array(providerExtractedIntentSchema).min(1).max(8),
  operations: z.array(providerSemanticOperationSchema).min(1).max(16),
  priceSemantics: z.array(providerPriceSemanticsSchema).min(1).max(8),
  response: z.string().trim().min(1),
}).strict();

const shoppingIntentSchema = z.object({
  id: z.string().trim().min(1),
  goal: z.string().trim().min(1),
  query: z.string().trim().min(1),
  constraints: intentConstraintsSchema,
  status: z.enum(['ready', 'needs_clarification', 'completed', 'failed']),
}).strict();

const matchReasonSchema = z.object({
  field: z.enum(['title', 'category', 'brand', 'tags', 'rating', 'price', 'availability']),
  value: z.string(),
}).strict();

const semanticProductRelevanceSchema = z.object({
  tier: z.enum(['supported', 'partial', 'unknown']),
  score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.object({
    field: z.enum(['title', 'description', 'tags']),
    quote: z.string().trim().min(1).max(500),
  }).strict()).max(4),
}).strict();

export const orchestrationResultSchema = z.object({
  turnId: z.string().trim().min(1),
  status: z.enum(['queued', 'running', 'completed', 'partial', 'failed']),
  response: z.string().trim().min(1),
  outcomes: z.array(z.object({
    intent: shoppingIntentSchema,
    products: z.array(z.object({
      product: productSchema,
      score: z.number(),
      matchReasons: z.array(matchReasonSchema),
      semanticRelevance: semanticProductRelevanceSchema.optional(),
    }).strict()),
    semanticStatus: z.enum(['applied', 'fallback']).optional(),
    semanticTruncated: z.boolean().optional(),
    clarification: z.object({
      field: z.enum(['maxPrice', 'minRating', 'category', 'inStock', 'brands', 'requiredTags', 'query']),
      question: z.string().trim().min(1),
      options: z.array(z.string().trim().min(1)).min(2),
      reason: z.enum(['requested', 'empty', 'broad', 'split']),
    }).strict().optional(),
    error: z.object({
      code: z.string().trim().min(1),
      message: z.string().trim().min(1),
      retryable: z.boolean(),
    }).strict().optional(),
  }).strict()),
  stateActions: z.object({
    pauseIntentIds: z.array(z.string().trim().min(1)).default([]),
    resumeIntentIds: z.array(z.string().trim().min(1)).default([]),
    selectedProduct: z.boolean().optional(),
  }).strict().optional(),
}).strict();

export type ExtractedTurnPlan = z.infer<typeof extractedTurnPlanSchema>;
export type ExtractedIntent = z.infer<typeof extractedIntentSchema>;
export type SemanticOperation = z.infer<typeof semanticOperationSchema>;
export type PriceSemantics = z.infer<typeof priceSemanticsSchema>;

export type IntentOutcome = {
  intent: ShoppingIntent;
  products: Array<RankedProduct & { semanticRelevance?: SemanticProductRelevance }>;
  semanticStatus?: 'applied' | 'fallback';
  semanticTruncated?: boolean;
  clarification?: import('./clarification').Clarification;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
};

export type OrchestrationResult = {
  turnId: string;
  status: TurnStatus;
  response: string;
  outcomes: IntentOutcome[];
  stateActions?: { pauseIntentIds: string[]; resumeIntentIds: string[]; selectedProduct?: boolean };
};

export type IntentExtractionContext = {
  prompt: string;
  displayedProductReference?: {
    referenceId?: string;
    intentId: string;
    position: number;
    product: Pick<Product, 'id' | 'title' | 'price' | 'category'>;
  };
  pausedIntents?: Array<{
    id: string;
    goal: string;
    query: string;
    constraints: Constraints;
    status: ShoppingIntent['status'];
  }>;
  previousIntents: Array<{
    id: string;
    goal: string;
    query: string;
    constraints: Constraints;
    status: ShoppingIntent['status'];
  }>;
};

export type ClarificationAnswer = {
  intentId: string;
  field: Exclude<keyof Constraints, 'sort'> | 'query';
  value: string;
};

export type IntentExtractor = (context: IntentExtractionContext) => Promise<unknown>;
