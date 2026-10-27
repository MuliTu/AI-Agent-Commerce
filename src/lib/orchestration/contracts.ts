import { z } from 'zod';
import type { Constraints, ShoppingIntent, TurnStatus } from '../domain/contracts';
import type { RankedProduct } from '../ranking';

export const intentConstraintsSchema = z.object({
  maxPrice: z.number().nonnegative().optional(),
  minRating: z.number().min(0).max(5).optional(),
  category: z.string().trim().min(1).optional(),
  inStock: z.boolean().optional(),
  brands: z.array(z.string().trim().min(1)).min(1).optional(),
  requiredTags: z.array(z.string().trim().min(1)).min(1).optional(),
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

export type ExtractedTurnPlan = z.infer<typeof extractedTurnPlanSchema>;
export type ExtractedIntent = z.infer<typeof extractedIntentSchema>;

export type IntentOutcome = {
  intent: ShoppingIntent;
  products: RankedProduct[];
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

export type IntentExtractor = (context: IntentExtractionContext) => Promise<unknown>;
