import { z, type ZodType } from 'zod';
import { productSchema, type Product } from '../domain/contracts';
import {
  catalogCategoriesSchema,
  catalogPageSchema,
  categoryListSchema,
  type CatalogCategory,
  type CatalogPage,
  type ListProductsQuery,
  type PaginationQuery,
  type SearchProductsQuery,
} from './contracts';
import { CatalogError } from './errors';

export type CatalogFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type CatalogClientOptions = {
  baseUrl?: string;
  fetch?: CatalogFetch;
  timeoutMs?: number;
};

const paginationSchema = z.object({
  limit: z.number().int().nonnegative().optional(),
  skip: z.number().int().nonnegative().optional(),
});

const listQuerySchema = paginationSchema.extend({
  select: z.array(z.string().trim().min(1)).min(1).optional(),
  sortBy: z.string().trim().min(1).optional(),
  order: z.enum(['asc', 'desc']).optional(),
}).superRefine((query, context) => {
  if (query.order && !query.sortBy) {
    context.addIssue({ code: 'custom', path: ['order'], message: 'order requires sortBy' });
  }
});

const searchQuerySchema = paginationSchema.extend({
  query: z.string().trim().min(1),
});

const productIdSchema = z.number().int().positive();
const categorySlugSchema = z.string().trim().min(1);
const requiredProductFields = ['id', 'title', 'category', 'price'] as const;

function appendPagination(search: URLSearchParams, query: PaginationQuery): void {
  if (query.limit !== undefined) search.set('limit', String(query.limit));
  if (query.skip !== undefined) search.set('skip', String(query.skip));
}

function parseRequest<T>(schema: ZodType<T>, input: unknown, endpoint: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new CatalogError('invalid_request', `Invalid catalog request for ${endpoint}`, {
      endpoint,
      cause: result.error,
    });
  }
  return result.data;
}

export class DummyJsonCatalogClient {
  private readonly baseUrl: string;
  private readonly fetchImplementation: CatalogFetch;
  private readonly timeoutMs: number;

  constructor(options: CatalogClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://dummyjson.com').replace(/\/+$/, '');
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;

    if (!this.baseUrl) throw new Error('Catalog baseUrl must not be empty');
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('Catalog timeoutMs must be a positive number');
    }
  }

  async listProducts(query: ListProductsQuery = {}): Promise<CatalogPage> {
    const endpoint = '/products';
    const parsed = parseRequest(listQuerySchema, query, endpoint);
    const search = new URLSearchParams();
    appendPagination(search, parsed);
    if (parsed.select) {
      const selectedFields = [...new Set([...requiredProductFields, ...parsed.select])];
      search.set('select', selectedFields.join(','));
    }
    if (parsed.sortBy) search.set('sortBy', parsed.sortBy);
    if (parsed.order) search.set('order', parsed.order);
    return this.request(endpoint, catalogPageSchema, search);
  }

  async getProduct(id: number): Promise<Product> {
    const endpoint = '/products/{id}';
    const parsedId = parseRequest(productIdSchema, id, endpoint);
    return this.request(`/products/${parsedId}`, productSchema);
  }

  async searchProducts(query: SearchProductsQuery): Promise<CatalogPage> {
    const endpoint = '/products/search';
    const parsed = parseRequest(searchQuerySchema, query, endpoint);
    const search = new URLSearchParams({ q: parsed.query });
    appendPagination(search, parsed);
    return this.request(endpoint, catalogPageSchema, search);
  }

  async listCategories(): Promise<CatalogCategory[]> {
    return this.request('/products/categories', catalogCategoriesSchema);
  }

  async listCategorySlugs(): Promise<string[]> {
    return this.request('/products/category-list', categoryListSchema);
  }

  async listProductsByCategory(slug: string, query: PaginationQuery = {}): Promise<CatalogPage> {
    const endpoint = '/products/category/{slug}';
    const parsedSlug = parseRequest(categorySlugSchema, slug, endpoint);
    const parsedQuery = parseRequest(paginationSchema, query, endpoint);
    const search = new URLSearchParams();
    appendPagination(search, parsedQuery);
    return this.request(`/products/category/${encodeURIComponent(parsedSlug)}`, catalogPageSchema, search);
  }

  private async request<T>(path: string, schema: ZodType<T>, search?: URLSearchParams): Promise<T> {
    const endpoint = search?.size ? `${path}?${search.toString()}` : path;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImplementation(`${this.baseUrl}${endpoint}`, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new CatalogError('http', `Catalog request returned HTTP ${response.status} for ${path}`, {
          endpoint: path,
          status: response.status,
        });
      }
      const payload: unknown = await response.json();
      const result = schema.safeParse(payload);
      if (!result.success) {
        throw new CatalogError('invalid_response', `Catalog response failed validation for ${path}`, {
          endpoint: path,
          cause: result.error,
        });
      }
      return result.data;
    } catch (error) {
      if (error instanceof CatalogError) throw error;
      if (controller.signal.aborted) {
        throw new CatalogError('timeout', `Catalog request timed out for ${path}`, {
          endpoint: path,
          cause: error,
        });
      }
      if (error instanceof SyntaxError) {
        throw new CatalogError('invalid_response', `Catalog returned invalid JSON for ${path}`, {
          endpoint: path,
          cause: error,
        });
      }
      throw new CatalogError('network', `Catalog request failed for ${path}`, {
        endpoint: path,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
