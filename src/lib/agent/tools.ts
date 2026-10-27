import { tool } from 'ai';
import type { CatalogCategory, CatalogPage } from '../catalog';
import { productSchema, type Product } from '../domain/contracts';
import {
  getProductInputSchema,
  getProductOutputSchema,
  listCategoriesInputSchema,
  listCategoriesOutputSchema,
  searchCatalogInputSchema,
  searchCatalogOutputSchema,
  type GetProductInput,
  type SearchCatalogInput,
} from './contracts';
import { AgentBoundaryError, toCatalogAgentError } from './errors';

export type AgentCatalogClient = {
  searchProducts(query: { query: string; limit?: number }): Promise<CatalogPage>;
  getProduct(id: number): Promise<Product>;
  listCategories(): Promise<CatalogCategory[]>;
};

export function createCatalogToolHandlers(client: AgentCatalogClient) {
  return {
    async searchCatalog({ query, limit }: SearchCatalogInput) {
      try {
        const page = await client.searchProducts({ query, limit });
        return searchCatalogOutputSchema.parse({ products: page.products, total: page.total });
      } catch (error) {
        throw toCatalogAgentError(error);
      }
    },
    async getProduct({ id }: GetProductInput) {
      try {
        const product = productSchema.parse(await client.getProduct(id));
        if (product.id !== id) {
          throw new AgentBoundaryError(
            'unknown_product',
            'The catalog returned a different product than requested.',
            false,
          );
        }
        return product;
      } catch (error) {
        throw toCatalogAgentError(error);
      }
    },
    async listCategories() {
      try {
        const categories = await client.listCategories();
        return listCategoriesOutputSchema.parse({ categories: categories.map((category) => category.slug) });
      } catch (error) {
        throw toCatalogAgentError(error);
      }
    },
  };
}

export function createCatalogTools(client: AgentCatalogClient) {
  const handlers = createCatalogToolHandlers(client);
  return {
    searchCatalog: tool({
      description: 'Search the trusted catalog for products matching a shopper query.',
      inputSchema: searchCatalogInputSchema,
      outputSchema: searchCatalogOutputSchema,
      execute: handlers.searchCatalog,
    }),
    getProduct: tool({
      description: 'Load one trusted catalog product by its positive integer ID.',
      inputSchema: getProductInputSchema,
      outputSchema: getProductOutputSchema,
      execute: handlers.getProduct,
    }),
    listCategories: tool({
      description: 'List trusted catalog categories for resolving category ambiguity.',
      inputSchema: listCategoriesInputSchema,
      outputSchema: listCategoriesOutputSchema,
      execute: handlers.listCategories,
    }),
  };
}
