import { expect, it } from 'vitest';
import { productSchema } from '../src/lib/domain/contracts';

it('rejects invalid product identity and price at the data boundary', () => {
  expect(productSchema.safeParse({ id: -1, title: 'Product', category: 'beauty', price: -5 }).success).toBe(false);
});
it('normalizes optional fields without inventing availability', () => {
  const product = productSchema.parse({ id: 1, title: 'Product', category: 'beauty', price: 12 });
  expect(product.tags).toEqual([]);
  expect(product.stock).toBeUndefined();
});
