import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withCatalogCapture } from './catalog-capture';
import { evaluateObjectiveAssertions } from './assertions';
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

  it('records model and provider judge independence from explicit configuration', () => {
    const configured = liveEvaluationInternals.judgeConfigurationFrom({
      LLM_PROVIDER: 'openai', LLM_MODEL: 'gpt-5.4-mini', LLM_API_KEY: 'secret', LLM_BASE_URL: 'https://api.openai.com/v1',
    }, {
      BAZAK_EVAL_JUDGE_PROVIDER: 'litellm',
      BAZAK_EVAL_JUDGE_MODEL: 'review-model',
      BAZAK_EVAL_JUDGE_API_KEY: 'other-secret',
      BAZAK_EVAL_JUDGE_BASE_URL: 'http://127.0.0.1:4001/v1',
    });
    expect(configured).toMatchObject({ provider: 'litellm', model: 'review-model', applicationProvider: 'openai', applicationModel: 'gpt-5.4-mini' });
    expect(() => liveEvaluationInternals.judgeConfigurationFrom({
      LLM_PROVIDER: 'openai', LLM_MODEL: 'gpt-5.4-mini', LLM_API_KEY: 'secret', LLM_BASE_URL: 'https://api.openai.com/v1',
    }, { BAZAK_EVAL_JUDGE_PROVIDER: 'unknown' })).toThrow('must be openai or litellm');
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

  it('fails comparative affordability when the same set is merely price-sorted without a baseline or clarification', () => {
    const products = [
      { id: 1, title: 'Phone A', price: 100, category: 'smartphones' },
      { id: 2, title: 'Phone B', price: 200, category: 'smartphones' },
    ];
    const assertions = evaluateObjectiveAssertions({
      turn: { id: 'comparative', prompt: 'make those more affordable', expected: { comparativeAffordability: { baselinePrice: null } } },
      result: {
        turnId: 'turn-2', status: 'completed', response: 'Sorted by price.',
        outcomes: [{
          intent: { id: 'phone', goal: 'phones', query: 'phones', constraints: { sort: 'price_asc' }, status: 'completed' },
          products: products.map((product) => ({ product: product as never, score: 1, matchReasons: [] })),
        }],
      },
      stateAfter: { conversationId: 'c', revision: 2, lastTurnId: 'turn-2', updatedAt: 'now', lastOperation: 'refine' },
      catalogCalls: [{
        sequence: 0, requestOccurrence: 1, url: 'https://dummyjson.com/products/category/smartphones', method: 'GET', pathname: '/products/category/smartphones', query: {}, startedAt: 'now', completedAt: 'now', status: 200, ok: true, rawOutput: { products }, returnedProducts: products, error: null,
      }],
      catalogCaptureComplete: true,
      snapshots: [{ id: 's', turnId: 'turn-2', intentId: 'phone', products: products as never, createdAt: 'now' }],
      persistenceRecovered: true,
    });
    expect(assertions).toContainEqual(expect.objectContaining({ id: 'comparative-affordability-resolution', status: 'FAIL' }));
  });

  it('does not apply comparative-baseline rules to a non-comparative cheap request', () => {
    const products = [{ id: 1, title: 'Phone A', price: 100, category: 'smartphones' }];
    const assertions = evaluateObjectiveAssertions({
      turn: { id: 'cheap', prompt: 'show cheap phones', expected: {} },
      result: {
        turnId: 'turn-1', status: 'completed', response: 'Catalog phones.',
        outcomes: [{ intent: { id: 'phone', goal: 'cheap phones', query: 'cheap phones', constraints: { sort: 'price_asc' }, status: 'completed' }, products: products.map((product) => ({ product: product as never, score: 1, matchReasons: [] })) }],
      },
      stateAfter: { conversationId: 'c', revision: 1, lastTurnId: 'turn-1', updatedAt: 'now', lastOperation: 'add' },
      catalogCalls: [{ sequence: 0, requestOccurrence: 1, url: 'https://dummyjson.com/products', method: 'GET', pathname: '/products', query: {}, startedAt: 'now', completedAt: 'now', status: 200, ok: true, rawOutput: { products }, returnedProducts: products, error: null }],
      catalogCaptureComplete: true,
      snapshots: [{ id: 's', turnId: 'turn-1', intentId: 'phone', products: products as never, createdAt: 'now' }],
      persistenceRecovered: true,
    });
    expect(assertions.some(({ id }) => id === 'comparative-affordability-resolution')).toBe(false);
    expect(assertions.every(({ status }) => status === 'PASS')).toBe(true);
  });

  it('marks historical selection grounding inconclusive when prior catalog capture was incomplete', () => {
    const product = { id: 121, title: 'Phone', description: '', category: 'smartphones', price: 199, tags: [], images: [] };
    const assertions = evaluateObjectiveAssertions({
      turn: { id: 'selection', prompt: 'that phone', expected: { selectedProductFromPreviousDisplay: true } },
      result: { turnId: 'two', status: 'completed', response: 'Phone', outcomes: [{ intent: { id: 'phones', goal: 'phone', query: 'phone', constraints: { category: 'smartphones' }, status: 'completed' }, products: [{ product, score: 1, matchReasons: [] }] }] },
      stateAfter: { conversationId: 'c', revision: 2, lastTurnId: 'two', updatedAt: 'now', lastOperation: 'select_product', selectedProducts: [{ intentId: 'phones', position: 1, product, selectedAtTurnId: 'two' }] },
      catalogCalls: [],
      priorCatalogCalls: [],
      catalogCaptureComplete: false,
      snapshots: [],
      persistenceRecovered: true,
    });
    expect(assertions).toContainEqual(expect.objectContaining({ id: 'catalog-product-grounding', status: 'INCONCLUSIVE' }));
    expect(assertions).toContainEqual(expect.objectContaining({ id: 'selected-product-from-display', status: 'INCONCLUSIVE' }));
  });

  it('captures exact catalog URL arguments, request occurrences, status, raw output, IDs, and prices', async () => {
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

  it('fails duplicate returned IDs and semantic evidence that is not an exact catalog quote', () => {
    const product = { id: 7, title: 'Catalog Phone', description: 'Documented camera.', price: 42, category: 'smartphones', tags: [] };
    const assertions = evaluateObjectiveAssertions({
      turn: { id: 'semantic', prompt: 'camera phone', expected: { semanticEvidence: { required: true, exactQuotes: true, fallback: 'forbidden' } } },
      result: {
        turnId: 'turn', status: 'completed', response: 'Results.',
        outcomes: [{
          intent: { id: 'phone', goal: 'camera phone', query: 'camera phone', constraints: { category: 'smartphones' }, status: 'completed' },
          products: [1, 2].map(() => ({ product: product as never, score: 1, matchReasons: [], semanticRelevance: { tier: 'supported' as const, score: 1, confidence: 1, evidence: [{ field: 'description' as const, quote: 'invented quote' }] } })),
          semanticStatus: 'applied',
        }],
      },
      stateAfter: { conversationId: 'c', revision: 1, lastTurnId: 'turn', updatedAt: 'now', lastOperation: 'add' },
      catalogCalls: [{ sequence: 0, requestOccurrence: 1, url: 'https://dummyjson.com/products', method: 'GET', pathname: '/products', query: {}, startedAt: 'now', completedAt: 'now', status: 200, ok: true, rawOutput: { products: [product] }, returnedProducts: [product], error: null }],
      catalogCaptureComplete: true,
      snapshots: [{ id: 's', turnId: 'turn', intentId: 'phone', products: [product] as never, createdAt: 'now' }],
      persistenceRecovered: true,
    });
    expect(assertions).toContainEqual(expect.objectContaining({ id: 'unique-returned-product-ids', status: 'FAIL' }));
    expect(assertions).toContainEqual(expect.objectContaining({ id: 'semantic-evidence-exact-quotes', status: 'FAIL' }));
  });

  it('asserts price-first and tier-score semantic ordering without weakening hard filters', () => {
    const products = [
      { id: 1, title: 'A', description: 'camera', price: 100, rating: 4, stock: 2, category: 'smartphones', tags: [] },
      { id: 2, title: 'B', description: 'camera', price: 200, rating: 5, stock: 2, category: 'smartphones', tags: [] },
    ];
    const assertions = evaluateObjectiveAssertions({
      turn: { id: 'price', prompt: 'cheap phones', expected: { semanticEvidence: { required: true, ordering: 'price_first', exactQuotes: true } } },
      result: { turnId: 'turn', status: 'completed', response: 'Results.', outcomes: [{
        intent: { id: 'phone', goal: 'phones', query: 'phones', constraints: { category: 'smartphones', maxPrice: 150, sort: 'price_asc' }, status: 'completed' },
        products: products.map((product, index) => ({ product: product as never, score: 1, matchReasons: [], semanticRelevance: { tier: (index ? 'supported' : 'partial') as 'supported' | 'partial', score: index ? 1 : 0.5, confidence: 1, evidence: [{ field: 'description' as const, quote: 'camera' }] } })),
      }] },
      stateAfter: { conversationId: 'c', revision: 1, lastTurnId: 'turn', updatedAt: 'now', lastOperation: 'add' },
      catalogCalls: [{ sequence: 0, requestOccurrence: 1, url: 'https://dummyjson.com/products', method: 'GET', pathname: '/products', query: {}, startedAt: 'now', completedAt: 'now', status: 200, ok: true, rawOutput: { products }, returnedProducts: products, error: null }],
      catalogCaptureComplete: true,
      snapshots: [{ id: 's', turnId: 'turn', intentId: 'phone', products: products as never, createdAt: 'now' }],
      persistenceRecovered: true,
    });
    expect(assertions).toContainEqual(expect.objectContaining({ id: 'semantic-ordering', status: 'PASS' }));
    expect(assertions).toContainEqual(expect.objectContaining({ id: 'hard-filter-precedence', status: 'FAIL' }));

    const equalPriceProducts = products.map((product) => ({ ...product, price: 100 }));
    const wrongTieOrder = evaluateObjectiveAssertions({
      turn: { id: 'tie', prompt: 'cheap phones', expected: { semanticEvidence: { required: true, ordering: 'price_first', exactQuotes: true } } },
      result: { turnId: 'tie-turn', status: 'completed', response: 'Results.', outcomes: [{
        intent: { id: 'phone', goal: 'phones', query: 'phones', constraints: { category: 'smartphones', sort: 'price_asc' }, status: 'completed' },
        products: equalPriceProducts.map((product, index) => ({ product: product as never, score: 1 - index,
          matchReasons: [], semanticRelevance: { tier: 'supported' as const, score: index ? 1 : 0.5, confidence: 1,
            evidence: [{ field: 'description' as const, quote: 'camera' }] } })),
      }] },
      stateAfter: { conversationId: 'c', revision: 1, lastTurnId: 'tie-turn', updatedAt: 'now', lastOperation: 'add' },
      catalogCalls: [{ sequence: 0, requestOccurrence: 1, url: 'https://dummyjson.com/products', method: 'GET', pathname: '/products', query: {}, startedAt: 'now', completedAt: 'now', status: 200, ok: true, rawOutput: { products: equalPriceProducts }, returnedProducts: equalPriceProducts, error: null }],
      catalogCaptureComplete: true,
      snapshots: [{ id: 's', turnId: 'tie-turn', intentId: 'phone', products: equalPriceProducts as never, createdAt: 'now' }],
      persistenceRecovered: true,
    });
    expect(wrongTieOrder).toContainEqual(expect.objectContaining({ id: 'semantic-ordering', status: 'FAIL' }));
  });
});
