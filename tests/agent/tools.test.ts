import { describe, expect, it } from 'vitest';
import { CatalogError, type CatalogCategory, type CatalogPage } from '../../src/lib/catalog';
import {
  AgentBoundaryError,
  createCatalogToolHandlers,
  getProductInputSchema,
  listCategoriesOutputSchema,
  searchCatalogInputSchema,
} from '../../src/lib/agent';
import type { Product } from '../../src/lib/domain/contracts';

const product: Product = {
  id: 1,
  title: 'Phone',
  description: 'A catalog phone',
  category: 'smartphones',
  price: 499,
  rating: 4.5,
  stock: 3,
  tags: ['mobile'],
  images: [],
};

function createClient(overrides: {
  searchProducts?: () => Promise<CatalogPage>;
  getProduct?: (id: number) => Promise<Product>;
  listCategories?: () => Promise<CatalogCategory[]>;
} = {}) {
  return {
    searchProducts: overrides.searchProducts ?? (async () => ({
      products: [product], total: 1, skip: 0, limit: 10,
    })),
    getProduct: overrides.getProduct ?? (async () => product),
    listCategories: overrides.listCategories ?? (async () => ([{
      slug: 'smartphones', name: 'Smartphones', url: 'https://dummyjson.com/products/category/smartphones',
    }])),
  };
}

describe('catalog agent tools', () => {
  it('rejects invalid tool inputs before execution', () => {
    expect(searchCatalogInputSchema.safeParse({ query: ' ', limit: 10 }).success).toBe(false);
    expect(searchCatalogInputSchema.safeParse({ query: 'phone', limit: 21 }).success).toBe(false);
    expect(getProductInputSchema.safeParse({ id: 0 }).success).toBe(false);
  });

  it('returns only schema-validated catalog products and categories', async () => {
    const handlers = createCatalogToolHandlers(createClient());
    await expect(handlers.searchCatalog({ query: 'phone', limit: 10 })).resolves.toEqual({
      products: [product], total: 1,
    });
    await expect(handlers.getProduct({ id: 1 })).resolves.toEqual(product);
    const categories = await handlers.listCategories();
    expect(listCategoriesOutputSchema.parse(categories)).toEqual({ categories: ['smartphones'] });
  });

  it('rejects malformed catalog output at the tool boundary', async () => {
    const handlers = createCatalogToolHandlers(createClient({
      searchProducts: async () => ({
        products: [{ ...product, id: 0 }], total: 1, skip: 0, limit: 10,
      }),
    }));
    await expect(handlers.searchCatalog({ query: 'phone', limit: 10 })).rejects.toMatchObject({
      name: 'AgentBoundaryError', code: 'catalog_unavailable', retryable: false,
    });
  });

  it('rejects unknown and mismatched product IDs before returning product data', async () => {
    const missing = createCatalogToolHandlers(createClient({
      getProduct: async () => { throw new CatalogError('http', 'not found', { endpoint: '/products/99', status: 404 }); },
    }));
    await expect(missing.getProduct({ id: 99 })).rejects.toMatchObject({
      code: 'unknown_product', retryable: false,
    });

    const mismatch = createCatalogToolHandlers(createClient({ getProduct: async () => product }));
    await expect(mismatch.getProduct({ id: 2 })).rejects.toBeInstanceOf(AgentBoundaryError);
    await expect(mismatch.getProduct({ id: 2 })).rejects.toMatchObject({ code: 'unknown_product' });
  });

  it('classifies transient catalog failures without exposing raw errors', async () => {
    const handlers = createCatalogToolHandlers(createClient({
      searchProducts: async () => { throw new CatalogError('http', 'private upstream body', {
        endpoint: '/products/search', status: 503,
      }); },
    }));
    try {
      await handlers.searchCatalog({ query: 'phone', limit: 10 });
    } catch (error) {
      expect(error).toMatchObject({ code: 'catalog_unavailable', retryable: true });
      expect(String(error)).not.toContain('private upstream body');
      return;
    }
    throw new Error('Expected catalog failure');
  });
});
