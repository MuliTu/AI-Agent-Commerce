'use client';

import { useState } from 'react';
import type { Product } from '@/lib/domain/contracts';
import type { SemanticProductRelevance } from '@/lib/orchestration';
type Props = { product: Product; matchReasons: string[]; semanticRelevance?: SemanticProductRelevance; locale?: 'en' | 'he' };
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export function ProductCard({ product, matchReasons, semanticRelevance, locale = 'en' }: Props) {
  const he = locale === 'he';
  const availability = product.availabilityStatus ?? (product.stock === 0 ? (he ? 'אזל מהמלאי' : 'Out of Stock') : (he ? 'הזמינות אינה ידועה' : 'Availability unknown'));
  const semanticLabel = semanticRelevance?.tier === 'supported'
    ? (he ? 'התאמה מאומתת' : 'Verified match')
    : semanticRelevance?.tier === 'partial'
      ? (he ? 'קשור, אך לא מאומת במלואו' : 'Related, not fully verified')
      : semanticRelevance ? (he ? 'רלוונטיות לא מאומתת' : 'Unverified relevance') : '';
  return <article className="product-card" dir="ltr"><div className="product-card__image">{product.thumbnail ? <CatalogImage src={product.thumbnail} title={product.title} locale={locale} /> : <ImageFallback title={product.title} locale={locale} />}</div><div className="product-card__body"><p className="product-card__category">{product.brand ?? product.category}</p>{semanticRelevance ? <div className={`product-card__semantic product-card__semantic--${semanticRelevance.tier}`}><strong>{semanticLabel}</strong><span>{he ? 'ציון רלוונטיות' : 'AI relevance'}: {Math.round(semanticRelevance.score * 100)}/100</span>{semanticRelevance.evidence.length ? <q>{semanticRelevance.evidence[0].quote}</q> : <small>{he ? 'אין הוכחה ישירה בטקסט הקטלוג' : 'No direct catalog-text proof'}</small>}</div> : null}<h3>{product.title}</h3><p className="product-card__description">{product.description}</p><dl className="product-card__facts"><div><dt>{he ? 'מחיר' : 'Price'}</dt><dd>{currency.format(product.price)}</dd></div>{product.rating !== undefined ? <div><dt>{he ? 'דירוג' : 'Rating'}</dt><dd>{product.rating.toFixed(1)} / 5</dd></div> : null}<div><dt>{he ? 'זמינות' : 'Availability'}</dt><dd>{availability}</dd></div></dl>{matchReasons.length ? <div className="product-card__match"><p>{he ? 'מתאים לבקשה שלך' : 'Matches your request'}</p><ul>{matchReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div> : null}</div></article>;
}

function ImageFallback({ title, locale = 'en' }: { title: string; locale?: 'en' | 'he' }) {
  return <span className="product-card__image-fallback" role="img" aria-label={locale === 'he' ? `התמונה של ${title} אינה זמינה` : `Image unavailable for ${title}`}>{locale === 'he' ? 'התמונה אינה זמינה' : 'Image unavailable'}</span>;
}

function CatalogImage({ src, title, locale = 'en' }: { src: string; title: string; locale?: 'en' | 'he' }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <ImageFallback title={title} locale={locale} />;
  // Catalog image hosts are runtime data, so the app cannot provide Next Image's static host allowlist.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={title} loading="lazy" onError={() => setFailed(true)} />;
}
