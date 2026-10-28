import { z } from 'zod';
import { productSchema, type Constraints, type ShoppingIntent, type TurnStatus } from '../domain/contracts';
import type { RankedProduct } from '../ranking';

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

export const extractedTurnPlanSchema = z.object({
  intents: z.array(extractedIntentSchema).min(1).max(8),
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

/**
 * Provider-facing wire schema. OpenAI structured outputs require every object
 * property to be required, so optional domain values are nullable on the wire
 * and normalized back to the application shape.
 */
export const providerExtractedTurnPlanSchema = z.object({
  intents: z.array(providerExtractedIntentSchema).min(1).max(8),
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
    }).strict()),
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
}).strict();

export type ExtractedTurnPlan = z.infer<typeof extractedTurnPlanSchema>;
export type ExtractedIntent = z.infer<typeof extractedIntentSchema>;

export type IntentOutcome = {
  intent: ShoppingIntent;
  products: RankedProduct[];
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
};

export type IntentExtractionContext = {
  prompt: string;
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
