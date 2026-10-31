import { describe, expect, it, vi } from 'vitest';
import type { Product } from '../../src/lib/domain/contracts';
import {
  applySemanticEvidenceRanking,
  createIntentOrchestrator,
  negativePreferenceTerms,
  requiresOnlyVerifiedEvidence,
  runSemanticEvidenceEvaluation,
  semanticEvidenceCandidateLimit,
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

describe('semantic evidence relevance evaluation', () => {
  it('keeps explicit cheaper ordering ahead of semantic relevance', () => {
    const ranked = applySemanticEvidenceRanking({
      ranked: [
        { product: { ...phone, id: 2, price: 700 }, score: 0.9 },
        { product: { ...phone, id: 3, price: 200 }, score: 0.4 },
      ],
      assessments: [{
        productId: 2, requirement: 'phone', verdict: 'supported', confidence: 1,
        relevanceScore: 1, evidence: [{ field: 'title', quote: 'Camera Phone' }],
      }, {
        productId: 3, requirement: 'phone', verdict: 'unknown', confidence: 0.2,
        relevanceScore: 0.1, evidence: [],
      }],
      onlyVerified: false,
      priceFirst: true,
    });

    expect(ranked.map(({ product }) => product.id)).toEqual([3, 2]);
  });

  it('accepts complete verdicts backed by literal trusted catalog spans', () => {
    expect(validateSemanticEvidenceBatch({
      assessments: [{
        productId: 1,
        requirement: 'camera capabilities',
        verdict: 'supported',
        confidence: 0.9,
        relevanceScore: 0.95,
        evidence: [{ field: 'description', quote: '50 MP camera' }],
      }],
    }, { products: [phone], requirements })).toMatchObject({
      assessments: [{ verdict: 'supported', evidence: [expect.objectContaining({ quote: expect.stringContaining('Camera') })] }],
    });
  });

  it.each([
    ['invented quote', { field: 'description', quote: 'optical zoom' }],
    ['wrong field', { field: 'title', quote: '50 MP camera' }],
  ])('replaces %s with deterministic direct catalog evidence', (_name, evidence) => {
    expect(validateSemanticEvidenceBatch({
      assessments: [{
        productId: 1,
        requirement: 'camera capabilities',
        verdict: 'supported',
        confidence: 0.95,
        relevanceScore: 0.9,
        evidence: [evidence],
      }],
    }, { products: [phone], requirements })).toMatchObject({
      assessments: [{ verdict: 'supported', evidence: [expect.objectContaining({ quote: expect.stringContaining('Camera') })] }],
    });
  });

  it('repairs direct supported evidence, downgrades inconsistent contradictions, and rejects incomplete batches', () => {
    expect(validateSemanticEvidenceBatch({
      assessments: [{
        productId: 1,
        requirement: 'camera capabilities',
        verdict: 'supported',
        confidence: 0.7,
        relevanceScore: 0.8,
        evidence: [],
      }],
    }, { products: [phone], requirements })).toMatchObject({
      assessments: [{ verdict: 'supported', evidence: [expect.any(Object)] }],
    });
    expect(validateSemanticEvidenceBatch({
      assessments: [{
        productId: 1,
        requirement: 'camera capabilities',
        verdict: 'contradicted',
        confidence: 0.7,
        relevanceScore: 0.1,
        evidence: [],
      }],
    }, { products: [phone], requirements })).toMatchObject({
      assessments: [{ verdict: 'unknown', evidence: [] }],
    });
    expect(() => validateSemanticEvidenceBatch({ assessments: [] }, {
      products: [phone], requirements,
    })).toThrow(/incomplete/);
    expect(validateSemanticEvidenceBatch({
      assessments: [{
        productId: 1,
        requirement: 'camera capabilities',
        verdict: 'unknown',
        confidence: 0.4,
        relevanceScore: 0.5,
        evidence: [{ field: 'description', quote: 'camera' }],
      }],
    }, { products: [phone], requirements })).toMatchObject({
      assessments: [{ verdict: 'supported', evidence: [expect.any(Object)] }],
    });
  });

  it('rejects relevance and confidence scores outside their bounded range', () => {
    expect(() => validateSemanticEvidenceBatch({
      assessments: [{
        productId: 1,
        requirement: 'camera capabilities',
        verdict: 'unknown',
        confidence: 0.5,
        relevanceScore: 1.01,
        evidence: [],
      }],
    }, { products: [phone], requirements })).toThrow();
  });

  it('fails safely when generation or validation fails', async () => {
    await expect(runSemanticEvidenceEvaluation({
      evaluator: async () => { throw new Error('provider unavailable'); },
      products: [phone],
      requirements,
    })).resolves.toEqual({ status: 'failed', code: 'evaluation_failed' });
    await expect(runSemanticEvidenceEvaluation({
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
        relevanceScore: 0.4,
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

  it('uses the semantic evaluator for ordinary relevance browsing', async () => {
    const semanticEvidenceEvaluator = vi.fn(async ({ products, requirements: scopedRequirements }: SemanticEvidenceInput) => ({
      assessments: products.flatMap((product) => scopedRequirements.map((requirement) => ({
        productId: product.id, requirement: requirement.label, verdict: 'unknown', confidence: 0.4,
        relevanceScore: 0.5, evidence: [],
      }))),
    }));
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

    expect(semanticEvidenceEvaluator).toHaveBeenCalledWith(expect.objectContaining({
      requirements: [{ label: 'phone', alternatives: [] }],
    }));
    expect(result.outcomes[0].products).toHaveLength(1);
  });

  it('falls back after a bounded semantic evaluator timeout', async () => {
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
      semanticEvidenceTimeoutMs: 10,
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
        relevanceScore: requirement.label === 'camera capabilities' ? 0.4 : 0.9,
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

  it('orders by evidence tier before score and excludes contradicted products', () => {
    const products = [
      { product: phone, score: 0.3, matchReasons: [] },
      { product: { ...phone, id: 2, title: 'Related Phone' }, score: 0.9, matchReasons: [] },
      { product: { ...phone, id: 3, title: 'Unknown Phone' }, score: 1, matchReasons: [] },
      { product: { ...phone, id: 4, title: 'Contradicted Phone' }, score: 1, matchReasons: [] },
    ];
    const assessments = [
      { productId: 1, requirement: 'satellite calling', verdict: 'supported' as const, confidence: 0.8, relevanceScore: 0.6, evidence: [{ field: 'description' as const, quote: '50 MP camera' }] },
      { productId: 2, requirement: 'satellite calling', verdict: 'partial' as const, confidence: 0.9, relevanceScore: 1, evidence: [{ field: 'description' as const, quote: '50 MP camera' }] },
      { productId: 3, requirement: 'satellite calling', verdict: 'unknown' as const, confidence: 0.4, relevanceScore: 1, evidence: [] },
      { productId: 4, requirement: 'satellite calling', verdict: 'contradicted' as const, confidence: 0.9, relevanceScore: 0, evidence: [{ field: 'description' as const, quote: '50 MP camera' }] },
    ];

    const ranked = applySemanticEvidenceRanking({ ranked: products, assessments, onlyVerified: false });

    expect(ranked.map(({ product }) => product.id)).toEqual([1, 2, 3]);
    expect(ranked.map(({ semanticRelevance }) => semanticRelevance.tier)).toEqual(['supported', 'partial', 'unknown']);
    expect(applySemanticEvidenceRanking({ ranked: products, assessments, onlyVerified: true })
      .map(({ product }) => product.id)).toEqual([1]);
  });

  it('uses semantic score within a tier, then preserves the deterministic baseline order', () => {
    const products = [
      { product: phone, score: 0.9, matchReasons: [] },
      { product: { ...phone, id: 2 }, score: 0.1, matchReasons: [] },
      { product: { ...phone, id: 3 }, score: 1, matchReasons: [] },
    ];
    const assessments = [
      { productId: 1, requirement: 'camera', verdict: 'partial' as const, confidence: 0.8, relevanceScore: 0.6, evidence: [{ field: 'description' as const, quote: 'camera' }] },
      { productId: 2, requirement: 'camera', verdict: 'partial' as const, confidence: 0.8, relevanceScore: 0.9, evidence: [{ field: 'description' as const, quote: 'camera' }] },
      { productId: 3, requirement: 'camera', verdict: 'supported' as const, confidence: 0.8, relevanceScore: 0.1, evidence: [{ field: 'description' as const, quote: 'camera' }] },
    ];

    expect(applySemanticEvidenceRanking({ ranked: products, assessments, onlyVerified: false })
      .map(({ product }) => product.id)).toEqual([3, 2, 1]);

    const tiedAssessments = assessments.map((assessment) => ({
      ...assessment, verdict: 'partial' as const, relevanceScore: 0.7,
    }));
    expect(applySemanticEvidenceRanking({ ranked: products, assessments: tiedAssessments, onlyVerified: false })
      .map(({ product }) => product.id)).toEqual([1, 2, 3]);
  });

  it('promotes literal slim evidence but does not confuse satellite SOS with satellite calling', () => {
    const huawei: Product = {
      ...phone, id: 21, title: 'Huawei Matebook X Pro', category: 'laptops', price: 1399.99,
      description: 'A slim and stylish laptop for professionals', tags: ['laptops'],
    };
    const sos: Product = {
      ...phone, id: 22, title: 'Emergency Phone', description: 'Supports emergency satellite SOS messaging',
    };
    const slimResult = validateSemanticEvidenceBatch({
      assessments: [{ productId: 21, requirement: 'slim laptops', verdict: 'partial', confidence: 0.8, relevanceScore: 0.9, evidence: [{ field: 'description', quote: 'slim and stylish' }] }],
    }, { products: [huawei], requirements: [{ label: 'slim laptops', alternatives: [] }] });
    const satelliteResult = validateSemanticEvidenceBatch({
      assessments: [{ productId: 22, requirement: 'satellite calling', verdict: 'partial', confidence: 0.9, relevanceScore: 0.8, evidence: [{ field: 'description', quote: 'satellite SOS messaging' }] }],
    }, { products: [sos], requirements: [{ label: 'satellite calling', alternatives: [] }] });

    expect(slimResult.assessments[0].verdict).toBe('supported');
    expect(slimResult.assessments[0].evidence[0]).toMatchObject({ field: 'description', quote: expect.stringContaining('slim') });
    expect(satelliteResult.assessments[0].verdict).toBe('partial');
  });

  it('keeps the real-shaped Huawei slim laptop in strict verified-only mode', async () => {
    const huawei: Product = {
      ...phone, id: 78, title: 'Huawei Matebook X Pro', category: 'laptops', price: 1399.99,
      description: 'The Huawei Matebook X Pro is a slim and stylish laptop for professionals.', tags: ['laptops'],
    };
    const expensiveSlimLaptop: Product = {
      ...huawei, id: 79, title: 'Premium Slim Workstation', price: 1800,
    };
    const affordableThickLaptop: Product = {
      ...huawei, id: 80, title: 'Budget Workstation', price: 900,
      description: 'A powerful desktop-replacement laptop for professionals.',
    };
    const result = await createIntentOrchestrator({
      catalog: {
        searchProducts: vi.fn(),
        listProductsByCategory: vi.fn(async () => ({
          products: [huawei, expensiveSlimLaptop, affordableThickLaptop], total: 3, skip: 0, limit: 100,
        })),
        getProduct: vi.fn(),
        listCategories: vi.fn(async () => [{ slug: 'laptops', name: 'Laptops', url: 'catalog' }]),
      },
      extractIntents: async () => ({
        response: 'searching',
        intents: [{ goal: 'Documented slim laptop', query: 'slim laptops', constraints: { category: 'laptops', maxPrice: 1500 } }],
      }),
      semanticEvidenceEvaluator: async ({ products, requirements: scopedRequirements }) => ({
        assessments: products.flatMap((product) => scopedRequirements.map((requirement) => ({
          productId: product.id, requirement: requirement.label, verdict: 'partial', confidence: 0.8,
          relevanceScore: 0.9, evidence: [{ field: 'description', quote: 'slim and stylish' }],
        }))),
      }),
    }).run({
      turnId: 'strict-slim', conversationId: 'qa',
      prompt: 'Only documented slim laptops under $1,500, please — no guessing from the photo.',
    });

    expect(result.outcomes[0].products).toHaveLength(1);
    expect(result.outcomes[0].products[0]).toMatchObject({
      product: { id: 78 }, semanticRelevance: { tier: 'supported' },
    });
  });

  it('promotes literal high-quality selfie evidence without promoting generic selfie cameras', async () => {
    const vivoV9: Product = {
      ...phone, id: 62, title: 'Vivo V9', price: 299.99,
      description: 'A smartphone with an emphasis on capturing high-quality selfies.',
      tags: ['smartphones', 'selfie'],
    };
    const genericSelfiePhone: Product = {
      ...phone, id: 63, title: 'Front Camera Phone', price: 249.99,
      description: 'A smartphone with a front-facing selfie camera.', tags: ['smartphones', 'selfie'],
    };
    const expensiveVivo: Product = { ...vivoV9, id: 64, title: 'Premium Selfie Phone', price: 499.99 };
    const evaluator = vi.fn(async ({ products, requirements: scopedRequirements }: SemanticEvidenceInput) => ({
      assessments: products.flatMap((product) => scopedRequirements.map((requirement) => ({
        productId: product.id, requirement: requirement.label, verdict: 'unknown' as const,
        confidence: 0.5, relevanceScore: product.id === 62 ? 0.98 : 0.7, evidence: [],
      }))),
    }));
    const result = await createIntentOrchestrator({
      catalog: {
        searchProducts: vi.fn(),
        listProductsByCategory: vi.fn(async () => ({
          products: [genericSelfiePhone, expensiveVivo, vivoV9], total: 3, skip: 0, limit: 100,
        })),
        getProduct: vi.fn(),
        listCategories: vi.fn(async () => [{ slug: 'smartphones', name: 'Smartphones', url: 'catalog' }]),
      },
      extractIntents: async () => ({
        response: 'מחפש',
        intents: [{
          goal: 'טלפון לסלפי חד ומחמיא', query: 'selfie smartphone',
          constraints: { category: 'smartphones', maxPrice: 400 },
        }],
      }),
      semanticEvidenceEvaluator: evaluator,
    }).run({
      turnId: 'selfie-quality', conversationId: 'qa',
      prompt: 'אני רוצה טלפון לסלפי חד ומחמיא, עד 400 דולר — לא סתם טלפון עם מצלמה.',
    });

    expect(evaluator).toHaveBeenCalledWith(expect.objectContaining({
      products: expect.arrayContaining([
        expect.objectContaining({ id: 62 }),
        expect.objectContaining({ id: 63 }),
      ]),
      requirements: [expect.objectContaining({ label: 'high-quality selfies' })],
    }));
    expect(evaluator.mock.calls[0]?.[0].products.map(({ id }) => id)).not.toContain(64);
    expect(result.outcomes[0].products.map(({ product }) => product.id)).toEqual([62, 63]);
    expect(result.outcomes[0].products.map(({ semanticRelevance }) => semanticRelevance?.tier))
      .toEqual(['supported', 'unknown']);
  });

  it('combines exact title and description evidence for the red-black basketball shoe', () => {
    const jordan: Product = {
      ...phone, id: 108, title: 'Nike Air Jordan 1 Red And Black', category: 'mens-shoes',
      description: 'Classic high-top basketball shoes.', tags: ['mens-shoes', 'basketball'], stock: 7,
    };
    const result = validateSemanticEvidenceBatch({
      assessments: [{
        productId: 108,
        requirement: 'red and black basketball shoes in stock',
        verdict: 'partial',
        confidence: 0.9,
        relevanceScore: 0.98,
        evidence: [{ field: 'title', quote: 'Red And Black' }, { field: 'description', quote: 'basketball shoes' }],
      }],
    }, { products: [jordan], requirements: [{ label: 'red and black basketball shoes in stock', alternatives: [] }] });

    expect(result.assessments[0].verdict).toBe('supported');
    expect(result.assessments[0].evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'title', quote: expect.stringContaining('Red And Black') }),
      expect.objectContaining({ field: 'description', quote: expect.stringContaining('basketball') }),
    ]));

    const predator: Product = {
      ...jordan, id: 109, title: 'Predator Black', description: 'Black basketball shoes.',
    };
    const falsePositive = validateSemanticEvidenceBatch({
      assessments: [{
        productId: 109, requirement: 'red and black basketball shoes in stock', verdict: 'partial',
        confidence: 0.8, relevanceScore: 0.7, evidence: [{ field: 'description', quote: 'basketball shoes' }],
      }],
    }, { products: [predator], requirements: [{ label: 'red and black basketball shoes in stock', alternatives: [] }] });
    expect(falsePositive.assessments[0].verdict).toBe('partial');
  });

  it('removes out-of-stock shoes before semantic evidence evaluation', async () => {
    const jordan: Product = {
      ...phone, id: 108, title: 'Nike Air Jordan 1 Red And Black', category: 'mens-shoes',
      description: 'Classic high-top basketball shoes.', tags: ['mens-shoes', 'basketball'], stock: 7,
    };
    const soldOut = { ...jordan, id: 109, stock: 0 };
    const evaluator = vi.fn(async ({ products, requirements: scopedRequirements }: SemanticEvidenceInput) => ({
      assessments: products.flatMap((product) => scopedRequirements.map((requirement) => ({
        productId: product.id, requirement: requirement.label, verdict: 'partial' as const,
        confidence: 0.9, relevanceScore: 0.95, evidence: [{ field: 'title' as const, quote: 'Red And Black' }],
      }))),
    }));
    const result = await createIntentOrchestrator({
      catalog: {
        searchProducts: vi.fn(),
        listProductsByCategory: vi.fn(async () => ({ products: [jordan, soldOut], total: 2, skip: 0, limit: 100 })),
        getProduct: vi.fn(),
        listCategories: vi.fn(async () => [{ slug: 'mens-shoes', name: 'Mens Shoes', url: 'catalog' }]),
      },
      extractIntents: async () => ({
        response: 'searching',
        intents: [{
          goal: 'Red and black basketball shoes in stock', query: 'red and black basketball shoes',
          constraints: { category: 'mens-shoes', inStock: true },
        }],
      }),
      semanticEvidenceEvaluator: evaluator,
    }).run({ turnId: 'in-stock-jordan', conversationId: 'qa', prompt: 'Red and black basketball shoes in stock.' });

    expect(evaluator).toHaveBeenCalledWith(expect.objectContaining({ products: [expect.objectContaining({ id: 108 })] }));
    expect(result.outcomes[0].products.map(({ product }) => product.id)).toEqual([108]);
  });

  it('excludes a directly evidenced unwanted daytime-fresh profile without creating a general negative filter', () => {
    const chanel: Product = {
      ...phone, id: 40, title: 'Chanel Coco Noir', category: 'fragrances',
      description: 'Perfect for evening occasions', tags: ['fragrance'],
    };
    const ckOne: Product = {
      ...phone, id: 41, title: 'CK One', category: 'fragrances',
      description: 'A fresh and clean fragrance for everyday wear', tags: ['fragrance'],
    };
    const terms = negativePreferenceTerms('A perfume after sunset — not a daytime freshie.');
    const ranked = applySemanticEvidenceRanking({
      ranked: [
        { product: chanel, score: 0.8, matchReasons: [] },
        { product: ckOne, score: 0.9, matchReasons: [] },
      ],
      assessments: [
        { productId: 40, requirement: 'evening perfume', verdict: 'supported', confidence: 0.9, relevanceScore: 0.95, evidence: [{ field: 'description', quote: 'evening occasions' }] },
        { productId: 41, requirement: 'evening perfume', verdict: 'partial', confidence: 0.8, relevanceScore: 0.78, evidence: [{ field: 'description', quote: 'everyday wear' }] },
      ],
      onlyVerified: false,
      negativeTerms: terms,
    });

    expect(terms).toEqual(['everyday', 'fresh']);
    expect(ranked.map(({ product }) => product.id)).toEqual([40]);
    expect(negativePreferenceTerms('not just a phone with a camera')).toEqual([]);
    expect(negativePreferenceTerms('not a leather case')).toEqual([]);
    expect(applySemanticEvidenceRanking({
      ranked: [{ product: { ...ckOne, id: 42, description: 'A fresh fragrance for evening wear' }, score: 0.7, matchReasons: [] }],
      assessments: [{ productId: 42, requirement: 'evening perfume', verdict: 'partial', confidence: 0.7, relevanceScore: 0.7, evidence: [{ field: 'description', quote: 'evening wear' }] }],
      onlyVerified: false,
      negativeTerms: terms,
    })).toHaveLength(1);
  });

  it('recognizes explicit verified-only wording without making ordinary relevance strict', () => {
    expect(requiresOnlyVerifiedEvidence('Only show verified satellite calling phones.')).toBe(true);
    expect(requiresOnlyVerifiedEvidence('If the catalog does not mention satellite calling, return no products.')).toBe(true);
    expect(requiresOnlyVerifiedEvidence('Show satellite calling phones and related alternatives.')).toBe(false);
  });

  it('keeps the structured batch within capacity for multiple requirements', () => {
    expect(semanticEvidenceCandidateLimit(1)).toBe(30);
    expect(semanticEvidenceCandidateLimit(4)).toBe(10);
    expect(semanticEvidenceCandidateLimit(40)).toBe(1);
    expect(semanticEvidenceCandidateLimit(41)).toBe(0);
    expect(() => semanticEvidenceCandidateLimit(0)).toThrow();
  });

  it('fails closed for strict verified-only wording when evaluation times out without an extracted feature', async () => {
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
        intents: [{ goal: 'Documented lightweight smartphones', query: 'lightweight smartphones', constraints: { category: 'smartphones' } }],
      }),
      semanticEvidenceEvaluator,
      semanticEvidenceTimeoutMs: 5,
    }).run({
      turnId: 'strict-timeout', conversationId: 'conversation-1',
      prompt: 'Only documented lightweight smartphones, please.',
    });

    expect(result.outcomes[0]).toMatchObject({
      products: [], error: { code: 'catalog_evidence_unavailable' },
    });

    const invalidResult = await createIntentOrchestrator({
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
        intents: [{ goal: 'Documented lightweight smartphones', query: 'lightweight smartphones', constraints: { category: 'smartphones' } }],
      }),
      semanticEvidenceEvaluator: async () => ({ assessments: [] }),
    }).run({
      turnId: 'strict-invalid', conversationId: 'conversation-2',
      prompt: 'Only documented lightweight smartphones, please.',
    });
    expect(invalidResult.outcomes[0]).toMatchObject({
      products: [], semanticStatus: 'fallback', error: { code: 'catalog_evidence_unavailable' },
    });
    expect(invalidResult.response).toContain('Semantic verification was unavailable');
  });

  it('shows partial alternatives normally but removes them for an explicit verified-only request', async () => {
    const voicePhone: Product = { ...phone, id: 11, description: 'Supports satellite voice calling' };
    const sosPhone: Product = { ...phone, id: 12, description: 'Supports emergency satellite SOS messaging' };
    const semanticEvidenceEvaluator = vi.fn(async ({ products, requirements: scopedRequirements }: SemanticEvidenceInput) => ({
      assessments: products.flatMap((product) => scopedRequirements.map((requirement) => ({
        productId: product.id,
        requirement: requirement.label,
        verdict: product.id === 11 ? 'supported' : 'partial',
        confidence: 0.9,
        relevanceScore: product.id === 11 ? 0.92 : 0.75,
        evidence: [{
          field: 'description',
          quote: product.id === 11 ? 'satellite voice calling' : 'satellite SOS messaging',
        }],
      }))),
    }));
    const catalog = {
      searchProducts: vi.fn(),
      listProductsByCategory: vi.fn(async () => ({ products: [sosPhone, voicePhone], total: 2, skip: 0, limit: 100 })),
      getProduct: vi.fn(),
      listCategories: vi.fn(async () => [{
        slug: 'smartphones', name: 'Smartphones', url: 'https://dummyjson.com/products/category/smartphones',
      }]),
    };
    const create = () => createIntentOrchestrator({
      catalog,
      extractIntents: async () => ({
        response: 'searching',
        intents: [{ goal: 'Satellite calling phone', query: 'satellite calling phone', constraints: { category: 'smartphones' } }],
      }),
      semanticEvidenceEvaluator,
    });

    const normal = await create().run({
      turnId: 'normal-related', conversationId: 'conversation-1',
      prompt: 'Find a phone with satellite calling and show related alternatives.',
    });
    const strict = await create().run({
      turnId: 'strict-related', conversationId: 'conversation-2',
      prompt: 'Only show verified phones with satellite calling.',
    });

    expect(normal.outcomes[0].products.map(({ product }) => product.id)).toEqual([11, 12]);
    expect(normal.outcomes[0].products.map(({ semanticRelevance }) => semanticRelevance?.tier))
      .toEqual(['supported', 'partial']);
    expect(strict.outcomes[0].products.map(({ product }) => product.id)).toEqual([11]);
  });

  it('evaluates every displayed candidate instead of appending false unknown-zero overflow', async () => {
    const phones = Array.from({ length: 16 }, (_, index): Product => ({
      ...phone, id: index + 100, title: `Camera Phone ${index + 1}`,
      description: index === 15 ? 'A versatile camera system' : `Camera technology option ${index + 1}`,
    }));
    const semanticEvidenceEvaluator = vi.fn(async ({ products, requirements: scopedRequirements }: SemanticEvidenceInput) => ({
      assessments: products.flatMap((product) => scopedRequirements.map((requirement) => ({
        productId: product.id, requirement: requirement.label, verdict: 'supported', confidence: 0.8,
        relevanceScore: product.id === 115 ? 0.95 : 0.7,
        evidence: [{ field: 'description', quote: product.description }],
      }))),
    }));
    const result = await createIntentOrchestrator({
      catalog: {
        searchProducts: vi.fn(),
        listProductsByCategory: vi.fn(async () => ({ products: phones, total: 16, skip: 0, limit: 100 })),
        getProduct: vi.fn(),
        listCategories: vi.fn(async () => [{ slug: 'smartphones', name: 'Smartphones', url: 'catalog' }]),
      },
      extractIntents: async () => ({
        response: 'searching',
        intents: [{ goal: 'Camera phone', query: 'camera phone', constraints: { category: 'smartphones' } }],
      }),
      semanticEvidenceEvaluator,
    }).run({ turnId: 'all-candidates', conversationId: 'qa', prompt: 'A pocket camera that is also a phone.' });

    expect(semanticEvidenceEvaluator.mock.calls[0]?.[0].products).toHaveLength(16);
    expect(result.outcomes[0].products).toHaveLength(16);
    expect(result.outcomes[0].products[0].product.id).toBe(115);
    expect(result.outcomes[0].products.every(({ semanticRelevance }) => semanticRelevance?.score !== 0)).toBe(true);
  });

  it('discloses invalid-assessment fallback and does not claim semantic ordering', async () => {
    const result = await createIntentOrchestrator({
      catalog: {
        searchProducts: vi.fn(),
        listProductsByCategory: vi.fn(async () => ({ products: [phone], total: 1, skip: 0, limit: 100 })),
        getProduct: vi.fn(),
        listCategories: vi.fn(async () => [{ slug: 'smartphones', name: 'Smartphones', url: 'catalog' }]),
      },
      extractIntents: async () => ({
        response: 'searching', intents: [{ goal: 'Browser tabs phone', query: 'browser tabs phone', constraints: { category: 'smartphones' } }],
      }),
      semanticEvidenceEvaluator: async () => ({ assessments: [] }),
    }).run({ turnId: 'fallback-visible', conversationId: 'qa', prompt: 'A phone for living in browser tabs.' });

    expect(result.outcomes[0]).toMatchObject({ semanticStatus: 'fallback', products: [{ product: { id: 1 } }] });
    expect(result.response).toContain('Semantic reranking was unavailable');
    expect(result.response).not.toContain('evidence tier');
  });

  it('uses mixed-tier response copy when one intent contains unknown alternatives', async () => {
    const cameraPhone: Product = { ...phone, id: 31, description: 'Advanced camera technology' };
    const everydayFragrance: Product = {
      ...phone, id: 32, title: 'CK One', category: 'fragrances', price: 49.99,
      description: 'A fresh and clean fragrance for everyday wear', tags: ['fragrance'],
    };
    const semanticEvidenceEvaluator = vi.fn(async ({ products, requirements: scopedRequirements }: SemanticEvidenceInput) => ({
      assessments: products.flatMap((product) => scopedRequirements.map((requirement) => ({
        productId: product.id,
        requirement: requirement.label,
        verdict: product.category === 'smartphones' ? 'supported' : 'unknown',
        confidence: 0.8,
        relevanceScore: product.category === 'smartphones' ? 0.95 : 0.12,
        evidence: product.category === 'smartphones' ? [{ field: 'description', quote: 'camera technology' }] : [],
      }))),
    }));
    const result = await createIntentOrchestrator({
      catalog: {
        searchProducts: vi.fn(),
        listProductsByCategory: vi.fn(async (category: string) => ({
          products: category === 'smartphones' ? [cameraPhone] : [everydayFragrance], total: 1, skip: 0, limit: 100,
        })),
        getProduct: vi.fn(),
        listCategories: vi.fn(async () => [
          { slug: 'smartphones', name: 'Smartphones', url: 'catalog' },
          { slug: 'fragrances', name: 'Fragrances', url: 'catalog' },
        ]),
      },
      extractIntents: async () => ({
        response: 'searching',
        intents: [
          { goal: 'Camera phone', query: 'camera phone', constraints: { category: 'smartphones' } },
          { goal: 'Evening fragrance', query: 'evening fragrance', constraints: { category: 'fragrances', maxPrice: 80 } },
        ],
      }),
      semanticEvidenceEvaluator,
    }).run({
      turnId: 'mixed-tier-copy', conversationId: 'qa',
      prompt: 'Find me a camera phone and an evening fragrance under $80 — the budget is for the fragrance.',
    });

    expect(result.outcomes[1].products[0].semanticRelevance?.tier).toBe('unknown');
    expect(result.response).toContain('Verified matches appear first; related or unverified alternatives follow');
    expect(result.response).not.toContain('only products whose trusted catalog text');
  });
});
