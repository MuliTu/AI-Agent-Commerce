import { describe, expect, it, vi } from 'vitest';
import type { Product } from '../../src/lib/domain/contracts';
import {
  createIntentOrchestrator,
  runSemanticEvidenceShadow,
  type SemanticEvidenceInput,
  validateSemanticEvidenceBatch,
} from '../../src/lib/orchestration';

const phone: Product = {
  id: 1,
  title: 'Camera Phone',
  description: 'A photography phone with a 50 MP camera',
  category: 'smartphones',
  price: 500,
  rating: 4.7,
  stock: 3,
  tags: ['camera', 'mobile'],
  images: [],
};

const expensivePhone: Product = { ...phone, id: 2, title: 'Expensive Camera Phone', price: 900 };
const requirements = [{ label: 'camera capabilities', alternatives: ['camera'] }];

describe('semantic evidence shadow evaluation', () => {
  it('accepts complete verdicts backed by literal trusted catalog spans', () => {
    expect(validateSemanticEvidenceBatch({
      assessments: [{
        productId: 1,
        requirement: 'camera capabilities',
        verdict: 'supported',
        confidence: 0.9,
        evidence: [{ field: 'description', quote: '50 MP camera' }],
      }],
    }, { products: [phone], requirements })).toMatchObject({
      assessments: [{ verdict: 'supported', evidence: [{ quote: '50 MP camera' }] }],
    });
  });

  it.each([
    ['invented quote', { field: 'description', quote: 'optical zoom' }],
    ['wrong field', { field: 'title', quote: '50 MP camera' }],
  ])('rejects %s even when the verdict says supported', (_name, evidence) => {
    expect(() => validateSemanticEvidenceBatch({
      assessments: [{
        productId: 1,
        requirement: 'camera capabilities',
        verdict: 'supported',
        confidence: 0.95,
        evidence: [evidence],
      }],
    }, { products: [phone], requirements })).toThrow(/trusted catalog fields/);
  });

  it('rejects supported verdicts without evidence and incomplete batches', () => {
    expect(() => validateSemanticEvidenceBatch({
      assessments: [{
        productId: 1,
        requirement: 'camera capabilities',
        verdict: 'supported',
        confidence: 0.7,
        evidence: [],
      }],
    }, { products: [phone], requirements })).toThrow(/requires an exact catalog quote/);
    expect(() => validateSemanticEvidenceBatch({
      assessments: [{
        productId: 1,
        requirement: 'camera capabilities',
        verdict: 'contradicted',
        confidence: 0.7,
        evidence: [],
      }],
    }, { products: [phone], requirements })).toThrow(/requires an exact catalog quote/);
    expect(() => validateSemanticEvidenceBatch({ assessments: [] }, {
      products: [phone], requirements,
    })).toThrow(/incomplete/);
  });

  it('fails safely when generation or validation fails', async () => {
    await expect(runSemanticEvidenceShadow({
      evaluator: async () => { throw new Error('provider unavailable'); },
      products: [phone],
      requirements,
    })).resolves.toEqual({ status: 'failed', code: 'evaluation_failed' });
    await expect(runSemanticEvidenceShadow({
      evaluator: async () => ({ assessments: [] }),
      products: [phone],
      requirements,
    })).resolves.toEqual({ status: 'failed', code: 'invalid_assessment' });
  });

  it('observes only hard-filtered candidates and never changes baseline results', async () => {
    const semanticEvidenceEvaluator = vi.fn(async ({ products }: { products: Product[] }) => ({
      assessments: products.map((product) => ({
        productId: product.id,
        requirement: 'camera capabilities',
        verdict: 'unknown',
        confidence: 0.6,
        evidence: [],
      })),
    }));
    const observeSemanticEvidence = vi.fn();
    const catalog = {
      searchProducts: vi.fn(),
      listProductsByCategory: vi.fn(async () => ({
        products: [phone, expensivePhone], total: 2, skip: 0, limit: 100,
      })),
      getProduct: vi.fn(),
      listCategories: vi.fn(async () => [{
        slug: 'smartphones', name: 'Smartphones', url: 'https://dummyjson.com/products/category/smartphones',
      }]),
    };
    const result = await createIntentOrchestrator({
      catalog,
      extractIntents: async () => ({
        response: 'searching',
        intents: [{
          goal: 'Camera phone under $700', query: 'camera phone',
          constraints: { category: 'smartphones', maxPrice: 700 },
        }],
      }),
      semanticEvidenceEvaluator,
      observeSemanticEvidence,
    }).run({
      turnId: 'semantic-shadow',
      conversationId: 'conversation-1',
      prompt: 'Find a smartphone under $700 with a good camera.',
    });

    expect(semanticEvidenceEvaluator).toHaveBeenCalledWith(expect.objectContaining({
      products: [expect.objectContaining({ id: 1 })],
    }));
    expect(semanticEvidenceEvaluator.mock.calls[0]?.[0].products).toHaveLength(1);
    await vi.waitFor(() => expect(observeSemanticEvidence).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' })));
    expect(result.outcomes[0].products.map(({ product }) => product.id)).toEqual([1]);
  });

  it('does not invoke the semantic evaluator for ordinary browsing', async () => {
    const semanticEvidenceEvaluator = vi.fn();
    const result = await createIntentOrchestrator({
      catalog: {
        searchProducts: vi.fn(),
        listProductsByCategory: vi.fn(async () => ({ products: [phone], total: 1, skip: 0, limit: 100 })),
        getProduct: vi.fn(),
        listCategories: vi.fn(async () => [{
          slug: 'smartphones', name: 'Smartphones', url: 'https://dummyjson.com/products/category/smartphones',
        }]),
      },
      extractIntents: async () => ({
        response: 'searching',
        intents: [{ goal: 'Find a phone', query: 'phone', constraints: { category: 'smartphones' } }],
      }),
      semanticEvidenceEvaluator,
    }).run({ turnId: 'ordinary', conversationId: 'conversation-1', prompt: 'Find a smartphone.' });

    expect(semanticEvidenceEvaluator).not.toHaveBeenCalled();
    expect(result.outcomes[0].products).toHaveLength(1);
  });

  it('does not wait for a hung shadow evaluator before returning baseline results', async () => {
    const semanticEvidenceEvaluator = vi.fn(() => new Promise(() => undefined));
    const result = await createIntentOrchestrator({
      catalog: {
        searchProducts: vi.fn(),
        listProductsByCategory: vi.fn(async () => ({ products: [phone], total: 1, skip: 0, limit: 100 })),
        getProduct: vi.fn(),
        listCategories: vi.fn(async () => [{
          slug: 'smartphones', name: 'Smartphones', url: 'https://dummyjson.com/products/category/smartphones',
        }]),
      },
      extractIntents: async () => ({
        response: 'searching',
        intents: [{ goal: 'Camera phone', query: 'camera phone', constraints: { category: 'smartphones' } }],
      }),
      semanticEvidenceEvaluator,
    }).run({ turnId: 'hung-shadow', conversationId: 'conversation-1', prompt: 'Find a phone that mentions camera.' });

    expect(semanticEvidenceEvaluator).toHaveBeenCalledOnce();
    expect(result.outcomes[0].products.map(({ product }) => product.id)).toEqual([1]);
  });

  it('keeps semantic synonym uncertainty and multi-intent evidence isolated', async () => {
    const ambiguousPhone: Product = {
      ...phone,
      description: 'A photography-focused handset',
      tags: ['mobile'],
    };
    const fragrance: Product = {
      ...phone,
      id: 3,
      title: 'Evening Fragrance',
      description: 'A warm scent for evening wear',
      category: 'fragrances',
      tags: ['perfume'],
    };
    const semanticEvidenceEvaluator = vi.fn(async ({ products, requirements: scopedRequirements }: SemanticEvidenceInput) => ({
      assessments: products.flatMap((product) => scopedRequirements.map((requirement) => ({
        productId: product.id,
        requirement: requirement.label,
        verdict: requirement.label === 'camera capabilities' ? 'unknown' : 'supported',
        confidence: 0.5,
        evidence: requirement.label === 'camera capabilities'
          ? []
          : [{ field: 'description', quote: 'evening wear' }],
      }))),
    }));
    const catalog = {
      searchProducts: vi.fn(),
      listProductsByCategory: vi.fn(async (category: string) => ({
        products: category === 'smartphones' ? [ambiguousPhone] : [fragrance], total: 1, skip: 0, limit: 100,
      })),
      getProduct: vi.fn(),
      listCategories: vi.fn(async () => [
        { slug: 'smartphones', name: 'Smartphones', url: 'https://dummyjson.com/products/category/smartphones' },
        { slug: 'fragrances', name: 'Fragrances', url: 'https://dummyjson.com/products/category/fragrances' },
      ]),
    };
    await createIntentOrchestrator({
      catalog,
      extractIntents: async () => ({
        response: 'searching',
        intents: [
          { goal: 'Camera phone', query: 'camera phone', constraints: { category: 'smartphones' } },
          { goal: 'Evening fragrance', query: 'evening fragrance', constraints: { category: 'fragrances' } },
        ],
      }),
      semanticEvidenceEvaluator,
    }).run({
      turnId: 'isolated-shadow', conversationId: 'conversation-1',
      prompt: 'Find a phone that mentions camera and a fragrance that mentions evening wear.',
    });

    await vi.waitFor(() => expect(semanticEvidenceEvaluator).toHaveBeenCalledTimes(2));
    expect(semanticEvidenceEvaluator.mock.calls[0]?.[0]).toMatchObject({
      products: [{ id: 1 }], requirements: [{ label: 'camera capabilities' }],
    });
    expect(semanticEvidenceEvaluator.mock.calls[1]?.[0]).toMatchObject({
      products: [{ id: 3 }], requirements: [{ label: 'evening use' }],
    });
  });
});
