import { z } from 'zod';
import { orchestrationResultSchema } from './contracts';

export const orchestrationRequestSchema = z.object({
  prompt: z.string().trim().min(1),
  conversationId: z.string().trim().min(1).default('local-session'),
  turnId: z.string().trim().min(1),
  previous: orchestrationResultSchema.optional(),
  retryIntentId: z.string().trim().min(1).optional(),
}).strict();

export const orchestrationResponseSchema = z.object({
  result: orchestrationResultSchema,
}).strict();

export type OrchestrationResponse = z.infer<typeof orchestrationResponseSchema>;
