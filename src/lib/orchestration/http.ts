import { z } from 'zod';
import { orchestrationResultSchema } from './contracts';

export const orchestrationRequestSchema = z.object({
  prompt: z.string().trim().min(1),
  conversationId: z.string().trim().min(1).default('local-demo'),
  turnId: z.string().trim().min(1),
  previous: orchestrationResultSchema.optional(),
}).strict();

export const orchestrationResponseSchema = z.object({
  mode: z.enum(['demo', 'live']),
  result: orchestrationResultSchema,
}).strict();

export type OrchestrationResponse = z.infer<typeof orchestrationResponseSchema>;
