import { describe, expect, it } from 'vitest';
import { rankCatalogProducts } from '../../src/lib/ranking';

const products = [
  {
    id: 1,
    title: 'Trail Runner Pro',
    description: 'Lightweight shoes for rocky trails',
    category: 'footwear',
    price: 120,
    rating: 4.8,
    stock: 8,
    tags: ['trail', 'running'],
    brand: 'Northstar',
  },
  {
    id: 2,
    title: 'City Runner',
    description: 'Comfortable everyday road shoes',
    category: 'footwear',
    price: 80,
    rating: 4.2,
    stock: 0,
    tags: ['road', 'running'],
    brand: 'Metro',
  },
  {
    id: 3,
    title: 'Trail Day Pack',
    description: 'Compact hiking backpack',
    category: 'bags',
    price: 60,
    rating: 4.8,
    availabilityStatus: 'In Stock',
    tags: ['trail', 'hiking'],
    brand: 'Northstar',
  },
  {
    id: 4,
    title: 'Basic Sandal',
    description: 'Simple warm weather footwear',
    category: 'footwear',
    price: 30,
    rating: 4.8,
    stock: 5,
    tags: ['summer'],
    brand: 'Coast',
  },
];

describe('rankCatalogProducts', () => {
  it('enforces price, category, availability, rating, brand and tag constraints together', () => {
    const result = rankCatalogProducts(products, {
      query: 'trail running shoes',
      constraints: {
        maxPrice: 125,
        category: 'FOOTWEAR',
        inStock: true,
        minRating: 4.5,
        brands: ['northstar'],
        requiredTags: ['TRAIL', 'running'],
      },
    });
    expect(result.map(({ product }) => product.id)).toEqual([1]);
  });

  it('applies hard constraints before ranking and returns an empty result for conflicts', () => {
    expect(rankCatalogProducts(products, {
      query: 'trail',
      constraints: { category: 'footwear', requiredTags: ['hiking'] },
    })).toEqual([]);
    expect(rankCatalogProducts(products, {
      query: 'runner',
      constraints: { inStock: false },
    }).map(({ product }) => product.id)).toEqual([2]);
  });

  it('ranks lexical field matches and keeps fallback ties stable by catalog ID', () => {
    expect(rankCatalogProducts(products, { query: 'trail' }).map(({ product }) => product.id))
      .toEqual([1, 3, 4, 2]);
    expect(rankCatalogProducts(products, { query: '' }).map(({ product }) => product.id))
      .toEqual([1, 3, 4, 2]);
  });

  it('returns only schema-validated products', () => {
    const invalid = [...products, { ...products[0], id: -1 }];
    expect(() => rankCatalogProducts(invalid, { query: 'trail' })).toThrow();
  });

  it('grounds every match reason in a supported field on its product', () => {
    const [ranked] = rankCatalogProducts(products, {
      query: 'northstar trail footwear',
      constraints: { maxPrice: 150, inStock: true },
      limit: 1,
    });
    expect(ranked).toBeDefined();
    for (const reason of ranked.matchReasons) {
      if (reason.field === 'tags') expect(ranked.product.tags.join(', ')).toContain(reason.value);
      else if (reason.field === 'availability') expect(reason.value).toBe('in stock');
      else expect(String(ranked.product[reason.field])).toBe(reason.value);
    }
  });

  it('validates request boundaries and respects an explicit result limit', () => {
    expect(rankCatalogProducts(products, { query: 'trail', limit: 1 })).toHaveLength(1);
    expect(() => rankCatalogProducts(products, {
      query: 'trail',
      constraints: { maxPrice: -1 },
    })).toThrow();
  });
});
