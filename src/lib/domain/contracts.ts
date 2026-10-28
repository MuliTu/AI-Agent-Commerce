import { z } from 'zod';

export const productSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1),
  description: z.string().default(''),
  category: z.string().min(1),
  price: z.number().nonnegative(),
  rating: z.number().min(0).max(5).optional(),
  stock: z.number().int().nonnegative().optional(),
  tags: z.array(z.string()).default([]),
  brand: z.string().optional(),
  thumbnail: z.url().optional(),
  images: z.array(z.url()).default([]),
  availabilityStatus: z.string().optional(),
  discountPercentage: z.number().min(0).max(100).optional(),
  warrantyInformation: z.string().optional(),
  shippingInformation: z.string().optional(),
});

export type Product = z.infer<typeof productSchema>;
export type Constraints = {
  maxPrice?: number;
  minRating?: number;
  category?: string;
  inStock?: boolean;
  brands?: string[];
  requiredTags?: string[];
  sort?: 'price_asc';
};
export type IntentStatus = 'ready' | 'needs_clarification' | 'completed' | 'failed';
export type ShoppingIntent = { id: string; goal: string; query: string; constraints: Constraints; status: IntentStatus };
export type TurnStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';
export type Turn = { id: string; conversationId: string; status: TurnStatus; intents: ShoppingIntent[]; createdAt: string };
export type Conversation = { id: string; createdAt: string; updatedAt: string };
export type Message = { id: string; conversationId: string; turnId: string; role: 'user' | 'assistant'; content: string; createdAt: string };
export type DomainError = { code: 'validation' | 'unavailable' | 'unauthorized' | 'not_found' | 'unknown'; message: string; retryable: boolean };
export type ToolResult<T> = { ok: true; data: T } | { ok: false; error: DomainError };
