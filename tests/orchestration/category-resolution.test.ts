import { describe, expect, it } from 'vitest';
import { resolveCatalogCategory } from '../../src/lib/orchestration/category-resolution';

describe('multilingual catalog category resolution', () => {
  const categories = ['smartphones', 'laptops', 'luggage', 'kitchen-accessories', 'beauty'];

  it.each([
    ['אני מחפש סמארטפון', 'smartphones'],
    ['אני צריך מזוודה לנסיעה', 'luggage'],
    ['יש לכם צלחות?', 'kitchen-accessories'],
  ])('maps %s to the relevant trusted category', (prompt, expected) => {
    expect(resolveCatalogCategory(undefined, prompt, categories)).toBe(expected);
  });

  it('does not guess an unrelated category for an unknown Hebrew product', () => {
    expect(resolveCatalogCategory(undefined, 'אני מחפש מוצר שלא קיים', categories)).toBeUndefined();
  });
});
