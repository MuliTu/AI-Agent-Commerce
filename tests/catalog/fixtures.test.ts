import { describe, expect, it, vi } from 'vitest';
import { catalogPageSchema, ExpiringSnapshotCache } from '../../src/lib/catalog';
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

describe('ExpiringSnapshotCache', () => {
  it('covers miss, hit and expiry with an injected clock', async () => {
    let now = 1_000;
    const loader = vi.fn(async () => ({ version: loader.mock.calls.length }));
    const cache = new ExpiringSnapshotCache({ ttlMs: 100, clock: () => now });
    await expect(cache.get(loader)).resolves.toEqual({ version: 1 });
    await expect(cache.get(loader)).resolves.toEqual({ version: 1 });
    expect(loader).toHaveBeenCalledTimes(1);
    now = 1_100;
    await expect(cache.get(loader)).resolves.toEqual({ version: 2 });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('refreshes before expiry and preserves the prior snapshot on failure', async () => {
    let version = 1;
    const cache = new ExpiringSnapshotCache({ ttlMs: 1_000, clock: () => 0 });
    await cache.get(async () => ({ version }));
    version = 2;
    await expect(cache.refresh(async () => ({ version }))).resolves.toEqual({ version: 2 });
    await expect(cache.refresh(async () => { throw new Error('refresh failed'); })).rejects.toThrow('refresh failed');
    await expect(cache.get(async () => ({ version: 3 }))).resolves.toEqual({ version: 2 });
  });

  it('coalesces concurrent misses and can be explicitly cleared', async () => {
    let resolveLoad!: (value: string) => void;
    const loader = vi.fn(() => new Promise<string>((resolve) => { resolveLoad = resolve; }));
    const cache = new ExpiringSnapshotCache<string>({ ttlMs: 100 });
    const first = cache.get(loader);
    const second = cache.get(loader);
    resolveLoad('snapshot');
    await expect(Promise.all([first, second])).resolves.toEqual(['snapshot', 'snapshot']);
    expect(loader).toHaveBeenCalledTimes(1);
    cache.clear();
    await expect(cache.get(async () => 'new snapshot')).resolves.toBe('new snapshot');
  });
});
