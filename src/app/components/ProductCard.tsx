import type { Product } from '@/lib/domain/contracts';
type Props = { product: Product; matchReasons: string[] };
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export function ProductCard({ product, matchReasons }: Props) {
  const availability = product.availabilityStatus ?? (product.stock === 0 ? 'Out of Stock' : 'Availability unknown');
  return <article className="product-card"><div className="product-card__image">{product.thumbnail ? <CatalogImage src={product.thumbnail} /> : <span aria-hidden="true">No image</span>}</div><div className="product-card__body"><p className="product-card__category">{product.brand ?? product.category}</p><h3>{product.title}</h3><p className="product-card__description">{product.description}</p><dl className="product-card__facts"><div><dt>Price</dt><dd>{currency.format(product.price)}</dd></div>{product.rating !== undefined ? <div><dt>Rating</dt><dd>{product.rating.toFixed(1)} / 5</dd></div> : null}<div><dt>Availability</dt><dd>{availability}</dd></div></dl>{matchReasons.length ? <div className="product-card__match"><p>Why it matches</p><ul>{matchReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div> : null}</div></article>;
}

function CatalogImage({ src }: { src: string }) {
  // Catalog image hosts are runtime data, so the app cannot provide Next Image's static host allowlist.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" />;
}
