import { z } from 'zod';
import { productSchema } from '../domain/contracts';

export const searchCatalogInputSchema = z.object({
  query: z.string().trim().min(1),
  limit: z.number().int().min(1).max(20).default(10),
});

export const searchCatalogOutputSchema = z.object({
  products: z.array(productSchema),
  total: z.number().int().nonnegative(),
});

export const getProductInputSchema = z.object({
  id: z.number().int().positive(),
});

export const listCategoriesOutputSchema = z.object({
  categories: z.array(z.string().trim().min(1)),
});

export type SearchCatalogInput = z.infer<typeof searchCatalogInputSchema>;
export type GetProductInput = z.infer<typeof getProductInputSchema>;
