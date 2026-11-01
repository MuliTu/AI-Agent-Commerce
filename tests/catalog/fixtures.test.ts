import { describe, expect, it } from 'vitest';
import { catalogPageSchema } from '../../src/lib/catalog';
import fixture from '../fixtures/catalog/products-page.json';
import provenance from '../fixtures/catalog/provenance.json';

describe('catalog fixture', () => {
  it('is an offline page accepted by the same schema used by live responses', () => {
    const page = catalogPageSchema.parse(fixture);
    expect(page.products).toHaveLength(3);
    expect(page.products.map(({ id }) => id)).toEqual([1, 78, 108]);
    expect(provenance.fixtureVersion).toBe(1);
    expect(provenance.purpose).toContain('not inventory');
  });

  it('rejects fixture product facts that the live boundary rejects', () => {
    const invalid = structuredClone(fixture);
    invalid.products[0].price = -1;
    expect(() => catalogPageSchema.parse(invalid)).toThrow();
  });
});
