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

export const conversationStateSchema = z.object({
  conversation: z.object({
    id: z.string().min(1),
    title: z.string().optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  }).strict(),
  turns: z.array(z.object({
    id: z.string().min(1),
    conversationId: z.string().min(1),
    status: z.enum(['queued', 'running', 'completed', 'partial', 'failed']),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    completedAt: z.string().optional(),
    result: orchestrationResultSchema.optional(),
    failure: z.object({ code: z.string().min(1), message: z.string().min(1), retryable: z.boolean() }).strict().optional(),
  }).strict()),
  messages: z.array(z.object({
    id: z.string().min(1),
    turnId: z.string().min(1),
    role: z.enum(['user', 'assistant']),
    content: z.string(),
    status: z.enum(['pending', 'completed', 'failed']),
    createdAt: z.string().min(1),
  }).strict()),
}).strict();

export type ConversationState = z.infer<typeof conversationStateSchema>;

export type OrchestrationResponse = z.infer<typeof orchestrationResponseSchema>;
