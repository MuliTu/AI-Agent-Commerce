import { describe, expect, it } from 'vitest';
import type { Product, ShoppingIntent } from '../../src/lib/domain/contracts';
import { evaluateClarification } from '../../src/lib/orchestration';
import type { RankedProduct } from '../../src/lib/ranking';

function intent(constraints: ShoppingIntent['constraints'] = {}, status: ShoppingIntent['status'] = 'ready'): ShoppingIntent {
  return { id: 'intent-1', goal: 'Find something useful', query: 'product', constraints, status };
}

function ranked(id: number, category: string, brand = `Brand ${id}`): RankedProduct {
  const product: Product = {
    id,
    title: `${category} ${id}`,
    description: 'Catalog product',
    category,
    price: id * 25,
    rating: 4.2,
    stock: 3,
    tags: [category],
    brand,
    images: [],
  };
  return { product, score: 0.5, matchReasons: [{ field: 'category', value: category }] };
}

describe('adaptive clarification policy', () => {
  it.each([
    ['one strong candidate', [ranked(1, 'laptops')]],
    ['several coherent candidates', [ranked(1, 'laptops', 'A'), ranked(2, 'laptops', 'B'), ranked(3, 'laptops', 'C')]],
  ])('proceeds without a question for %s', (_label, products) => {
    expect(evaluateClarification(intent(), products)).toBeUndefined();
  });

  it.each([
    ['empty', [], 'empty'],
    ['broad', [ranked(1, 'laptops'), ranked(2, 'beauty'), ranked(3, 'shoes'), ranked(4, 'laptops'), ranked(5, 'beauty')], 'broad'],
    ['split', [ranked(1, 'laptops', 'A'), ranked(2, 'laptops', 'B'), ranked(3, 'shoes', 'C'), ranked(4, 'shoes', 'D')], 'split'],
  ] as const)('asks one category question for %s results', (_label, products, reason) => {
    const clarification = evaluateClarification(intent(), products);
    expect(clarification).toMatchObject({ field: 'category', reason });
    expect(clarification?.question).toMatch(/category|kind of product/i);
    expect(clarification?.options.length).toBeGreaterThanOrEqual(2);
  });

  it('does not ask for constraints the shopper already supplied', () => {
    const clarification = evaluateClarification(intent({ category: 'laptops', maxPrice: 1200 }), []);
    expect(clarification).toMatchObject({ field: 'minRating', reason: 'empty' });
    expect(clarification?.question).not.toMatch(/category|spend/i);
  });

  it('offers query recovery rather than repeating every supplied constraint', () => {
    const clarification = evaluateClarification(intent({
      category: 'laptops',
      maxPrice: 500,
      minRating: 4.8,
    }), []);
    expect(clarification).toMatchObject({ field: 'query', reason: 'empty' });
    expect(clarification?.question).toMatch(/broaden the product type/i);
    expect(clarification?.question).not.toMatch(/laptops|500|4\.8/);
  });

  it('turns an extractor clarification request into one structured question', () => {
    const clarification = evaluateClarification(intent({ category: 'beauty' }, 'needs_clarification'), []);
    expect(clarification).toMatchObject({ field: 'maxPrice', reason: 'requested' });
  });
});
