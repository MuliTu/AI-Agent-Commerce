export { DummyJsonCatalogClient, type CatalogClientOptions, type CatalogFetch } from './client';
export {
  catalogPageSchema,
  type CatalogCategory,
  type CatalogPage,
  type CatalogProduct,
  type ListProductsQuery,
  type PaginationQuery,
  type SearchProductsQuery,
} from './contracts';
export { CatalogError, type CatalogErrorKind } from './errors';
export {
  ExpiringSnapshotCache,
  type SnapshotCacheOptions,
  type SnapshotClock,
} from './snapshot-cache';
