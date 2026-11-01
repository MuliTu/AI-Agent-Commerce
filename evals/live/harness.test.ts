import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withCatalogCapture } from './catalog-capture';
import { createIsolatedDatabasePath, liveEvaluationInternals } from './runner';

const nativeFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = nativeFetch;
  vi.restoreAllMocks();
});

describe('live evaluation harness mechanics', () => {
  it('creates and verifies an unused SQLite path below the operating-system temp directory', () => {
    const environment = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
    const path = createIsolatedDatabasePath(environment);
    expect(environment.BAZAK_DATABASE_PATH).toBe(path);
    expect(relative(tmpdir(), path).startsWith('..')).toBe(false);
    expect(existsSync(path)).toBe(false);
  });

  it('never lets a judge override a deterministic failure', () => {
    expect(liveEvaluationInternals.combineStatus('FAIL', 'PASS')).toBe('FAIL');
    expect(liveEvaluationInternals.combineStatus('PASS', 'FAIL')).toBe('FAIL');
    expect(liveEvaluationInternals.combineStatus('PASS', 'INCONCLUSIVE')).toBe('INCONCLUSIVE');
    expect(liveEvaluationInternals.combineStatus('PASS', 'PASS')).toBe('PASS');
  });

  it('recognizes scoped catalog failures and captured transport failures as infrastructure evidence', () => {
    expect(liveEvaluationInternals.resultContainsUnavailableInfrastructure({
      turnId: 'turn',
      status: 'failed',
      response: 'Catalog unavailable.',
      outcomes: [{
        intent: { id: 'intent', goal: 'phone', query: 'phone', constraints: {}, status: 'failed' },
        products: [],
        error: { code: 'catalog_unavailable', message: 'Unavailable', retryable: true },
      }],
    })).toBe(true);
    expect(liveEvaluationInternals.catalogCaptureShowsUnavailableInfrastructure([{
      sequence: 0,
      requestOccurrence: 1,
      url: 'https://dummyjson.com/products',
      method: 'GET',
      pathname: '/products',
      query: {},
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
      status: 503,
      ok: false,
      rawOutput: null,
      returnedProducts: [],
      error: null,
    }])).toBe(true);
  });

  it('compares persisted JSON semantically across key order and omitted optional values', () => {
    expect(liveEvaluationInternals.samePersistedJson(
      { result: { status: 'completed', optional: undefined }, products: [{ price: 42, id: 7 }] },
      { products: [{ id: 7, price: 42 }], result: { status: 'completed' } },
    )).toBe(true);
  });

  it('captures exact catalog URL arguments, attempts, status, raw output, IDs, and prices', async () => {
    globalThis.fetch = vi.fn(async () => Response.json({
      products: [{ id: 7, title: 'Catalog Phone', price: 42, category: 'smartphones' }],
      total: 1,
      skip: 5,
      limit: 10,
    }));
    const captured = await withCatalogCapture(async () => {
      await fetch('https://dummyjson.com/products/search?q=phone&limit=10&skip=5');
      await fetch('https://dummyjson.com/products/search?q=phone&limit=10&skip=5');
      return 'done';
    });

    expect(captured.result).toBe('done');
    expect(captured.captureComplete).toBe(true);
    expect(captured.calls).toHaveLength(2);
    expect(captured.calls[0]).toMatchObject({
      requestOccurrence: 1,
      method: 'GET',
      pathname: '/products/search',
      query: { q: 'phone', limit: '10', skip: '5' },
      status: 200,
      returnedProducts: [{ id: 7, title: 'Catalog Phone', price: 42, category: 'smartphones' }],
      rawOutput: { total: 1, skip: 5, limit: 10 },
    });
    expect(captured.calls[1]?.requestOccurrence).toBe(2);
  });
});
