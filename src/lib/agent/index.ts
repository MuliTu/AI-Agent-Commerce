export {
  getProductInputSchema,
  listCategoriesOutputSchema,
  searchCatalogInputSchema,
  searchCatalogOutputSchema,
  type GetProductInput,
  type SearchCatalogInput,
} from './contracts';
export { AgentBoundaryError, type AgentErrorCode } from './errors';
export { createCatalogToolHandlers, type AgentCatalogClient } from './tools';
