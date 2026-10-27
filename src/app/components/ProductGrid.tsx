import type { Product } from '@/lib/domain/contracts';
import { ProductCard } from './ProductCard';
type Props = { products: Product[]; getMatchReasons: (product: Product) => string[] };
export function ProductGrid({ products, getMatchReasons }: Props) {
  return <div className="product-grid" role="list" aria-label="Product recommendations">{products.map((product) => <div key={product.id} role="listitem"><ProductCard product={product} matchReasons={getMatchReasons(product)} /></div>)}</div>;
}
