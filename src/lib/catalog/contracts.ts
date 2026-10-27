import { z } from 'zod';
import { productSchema, type Product } from '../domain/contracts';

export const catalogCategorySchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  url: z.url(),
});

export const catalogPageSchema = z.object({
  products: z.array(productSchema),
  total: z.number().int().nonnegative(),
  skip: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
});

export const categoryListSchema = z.array(z.string().min(1));
export const catalogCategoriesSchema = z.array(catalogCategorySchema);

export type CatalogCategory = z.infer<typeof catalogCategorySchema>;
export type CatalogPage = z.infer<typeof catalogPageSchema>;

export type PaginationQuery = {
  limit?: number;
  skip?: number;
};

export type ListProductsQuery = PaginationQuery & {
  select?: string[];
  sortBy?: string;
  order?: 'asc' | 'desc';
};

export type SearchProductsQuery = PaginationQuery & {
  query: string;
};

export type CatalogProduct = Product;
