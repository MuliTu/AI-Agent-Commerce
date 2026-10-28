import type { Product } from '@/lib/domain/contracts';
import { ProductCard } from './ProductCard';
type Props = { products: Product[]; getMatchReasons: (product: Product) => string[] };
export function ProductGrid({ products, getMatchReasons }: Props) {
  return <div className="product-grid" role="list" aria-label="Product recommendations">{products.map((product) => <div key={product.id} role="listitem"><ProductCard product={product} matchReasons={getMatchReasons(product)} /></div>)}</div>;
}

export function ProductGridSkeleton() {
  return <div className="product-grid-skeleton" role="status" aria-live="polite" aria-label="Catalog results pending">
    <span className="visually-hidden">Catalog results are pending. No products are available yet.</span>
    <div className="product-grid" aria-hidden="true">{[0, 1, 2].map((index) => <div className="product-card product-card--skeleton" key={index}><div className="product-card__image" /><div className="product-card__body"><span /><span /><span /></div></div>)}</div>
  </div>;
}
