import { describe, expect, it, vi } from 'vitest';
import type { Product } from '../../src/lib/domain/contracts';
import { createIntentOrchestrator } from '../../src/lib/orchestration';
import type { ExtractedTurnPlan } from '../../src/lib/orchestration/contracts';

const phone: Product = { id: 1, title: 'Phone', description: 'camera phone', category: 'smartphones', price: 500, tags: [], images: [] };
const perfume: Product = { id: 2, title: 'Perfume', description: 'floral perfume', category: 'fragrances', price: 80, tags: [], images: [] };
const luxuryPerfume: Product = { id: 5, title: 'Luxury Perfume', description: 'premium perfume', category: 'fragrances', price: 600, tags: [], images: [] };
const cheaperPhone: Product = { id: 3, title: 'Value Phone', description: 'lower priced phone', category: 'smartphones', price: 300, tags: [], images: [] };
const expensivePhone: Product = { id: 4, title: 'Premium Phone', description: 'premium phone', category: 'smartphones', price: 700, tags: [], images: [] };

function catalog() {
  return {
    searchProducts: vi.fn(async () => ({ products: [], total: 0, skip: 0, limit: 20 })),
    listProductsByCategory: vi.fn(async (category: string) => ({
      products: category === 'fragrances' ? [perfume, luxuryPerfume] : [cheaperPhone, phone, expensivePhone], total: category === 'fragrances' ? 2 : 3, skip: 0, limit: 20,
    })),
    getProduct: vi.fn(async (id: number) => {
      const product = [phone, perfume, cheaperPhone, expensivePhone, luxuryPerfume].find((candidate) => candidate.id === id);
      if (!product) throw new Error(`Unknown fixture product ${id}`);
      return product;
    }),
    listCategories: vi.fn(async () => [
      { slug: 'smartphones', name: 'Smartphones', url: 'https://dummyjson.com/products/category/smartphones' },
      { slug: 'fragrances', name: 'Fragrances', url: 'https://dummyjson.com/products/category/fragrances' },
    ]),
  };
}

const activePhone = {
  intent: { id: 'phones', goal: 'Find phones', query: 'phones', constraints: { category: 'smartphones' }, status: 'completed' as const },
  products: [{ product: phone, score: 1, matchReasons: [] }],
};

describe('semantic action plan', () => {
  it('validates an ordered pause then search plan before fetching the new topic', async () => {
    const boundary = catalog();
    const result = await createIntentOrchestrator({
      catalog: boundary,
      extractIntents: async () => ({
        response: 'Switching topics.',
        intents: [
          { intentId: 'phones', constraints: { category: 'smartphones' } },
          { goal: 'Find perfume', query: 'perfume', constraints: { category: 'perfume', maxPrice: 100 } },
        ],
        operations: [{ op: 'pause_intent', intentId: 'phones' }, { op: 'search', intentIndex: 1 }],
        priceSemantics: [{ kind: 'none' }, { kind: 'none' }],
      }),
    }).run({
      turnId: 'switch', conversationId: 'conversation',
      prompt: 'Set the phone topic aside and switch to a perfume under $100.',
      previous: { turnId: 'prior', status: 'completed', response: 'phones', outcomes: [activePhone] },
    });

    expect(result.stateActions).toEqual({ pauseIntentIds: ['phones'], resumeIntentIds: [] });
    expect(result.outcomes[0]).toMatchObject({ intent: { constraints: { category: 'fragrances', maxPrice: 100 } } });
    expect(result.outcomes[0].products[0].product.id).toBe(2);
    expect(boundary.listProductsByCategory).toHaveBeenCalledWith('fragrances', { limit: 100, skip: 0 });
  });

  it('selects a trusted displayed reference without a product search', async () => {
    const boundary = catalog();
    const result = await createIntentOrchestrator({
      catalog: boundary,
      extractIntents: async () => ({
        response: 'Describing the selection.',
        intents: [{ intentId: 'phones', constraints: { category: 'smartphones' } }],
        operations: [{ op: 'select_product', referenceId: 'displayed:phones:0', presentation: 'describe' }],
        priceSemantics: [{ kind: 'none' }],
      }),
    }).run({
      turnId: 'select', conversationId: 'conversation', prompt: 'Tell me about that displayed option.',
      previous: { turnId: 'prior', status: 'completed', response: 'phones', outcomes: [activePhone] },
      displayedProductReference: {
        referenceId: 'displayed:phones:0', intentId: 'phones', position: 0,
        product: { id: 1, title: 'Phone', price: 500, category: 'smartphones' },
      },
    });

    expect(result.outcomes[0].products.map(({ product }) => product.id)).toEqual([1]);
    expect(result.response).toContain('Phone');
    expect(boundary.listProductsByCategory).not.toHaveBeenCalled();
  });

  it('clarifies comparative affordability without a trusted baseline even when the provider proposes sorting', async () => {
    const boundary = catalog();
    const result = await createIntentOrchestrator({
      catalog: boundary,
      extractIntents: async () => ({
        response: 'I need a baseline.',
        intents: [{ intentId: 'phones', constraints: { category: 'smartphones' } }],
        operations: [{ op: 'refine_intent', intentIndex: 0, intentId: 'phones' }],
        priceSemantics: [{ kind: 'sort_low_to_high' }],
      }),
    }).run({
      turnId: 'affordable', conversationId: 'conversation', prompt: 'Could you make those more affordable?',
      previous: { turnId: 'prior', status: 'completed', response: 'phones', outcomes: [activePhone] },
    });

    expect(result.outcomes[0]).toMatchObject({ intent: { status: 'needs_clarification' }, clarification: { field: 'maxPrice' } });
    expect(boundary.listProductsByCategory).not.toHaveBeenCalled();
  });

  it('executes structured referenced affordability for a paraphrase without phrase matching', async () => {
    const boundary = catalog();
    const result = await createIntentOrchestrator({
      catalog: boundary,
      extractIntents: async () => ({
        response: 'Here are lower-priced alternatives.',
        intents: [{ intentId: 'phones', constraints: { category: 'smartphones' } }],
        operations: [{ op: 'refine_intent', intentIndex: 0, intentId: 'phones' }],
        priceSemantics: [{ kind: 'cheaper_than_reference', referenceId: 'displayed:phones:0' }],
      }),
    }).run({
      turnId: 'lower-priced', conversationId: 'conversation', prompt: 'Find lower-priced alternatives.',
      previous: { turnId: 'prior', status: 'completed', response: 'phones', outcomes: [activePhone] },
      displayedProductReference: {
        referenceId: 'displayed:phones:0', intentId: 'phones', position: 0,
        product: { id: 1, title: 'Phone', price: 500, category: 'smartphones' },
      },
    });

    expect(result.outcomes[0].products.map(({ product }) => product.id)).toEqual([3]);
    expect(result.outcomes[0].products.every(({ product }) => product.price < phone.price)).toBe(true);
  });

  it('binds a trusted comparison baseline to a different-category search draft', async () => {
    const boundary = catalog();
    const result = await createIntentOrchestrator({
      catalog: boundary,
      extractIntents: async () => ({
        response: 'Comparing perfume prices.',
        intents: [{ goal: 'Find perfume alternatives', query: 'perfume', constraints: { category: 'fragrances' } }],
        operations: [{ op: 'search', intentIndex: 0 }],
        priceSemantics: [{ kind: 'cheaper_than_reference', referenceId: 'displayed:phones:0' }],
      }),
    }).run({
      turnId: 'cross-category-price', conversationId: 'conversation', prompt: 'Show fragrance alternatives at a lower price than this.',
      previous: { turnId: 'prior', status: 'completed', response: 'phones', outcomes: [activePhone] },
      displayedProductReference: {
        referenceId: 'displayed:phones:0', intentId: 'phones', position: 0,
        product: { id: 1, title: 'Phone', price: 500, category: 'smartphones' },
      },
    });

    const fragranceOutcome = result.outcomes.find(({ intent }) => intent.constraints.category === 'fragrances');
    expect(fragranceOutcome?.products.map(({ product }) => product.id)).toEqual([2]);
    expect(fragranceOutcome?.products.every(({ product }) => product.price < phone.price)).toBe(true);
  });

  it('does not expand an explicit refine operation into prompt-mentioned catalog actions', async () => {
    const boundary = catalog();
    const result = await createIntentOrchestrator({
      catalog: boundary,
      extractIntents: async () => ({
        response: 'Refining the phone request.',
        intents: [{ intentId: 'phones', constraints: { category: 'smartphones', maxPrice: 400 } }],
        operations: [{ op: 'refine_intent', intentIndex: 0, intentId: 'phones' }],
        priceSemantics: [{ kind: 'none' }],
      }),
    }).run({
      turnId: 'no-implicit-expansion', conversationId: 'conversation',
      prompt: 'Refine the phone request under $400; perfume is only an aside.',
      previous: { turnId: 'prior', status: 'completed', response: 'phones', outcomes: [activePhone] },
      displayedProductReference: {
        referenceId: 'displayed:phones:0', intentId: 'phones', position: 0,
        product: { id: 1, title: 'Phone', price: 500, category: 'smartphones' },
      },
    });

    expect(result.outcomes.every(({ intent }) => intent.constraints.category !== 'fragrances')).toBe(true);
    expect(boundary.listProductsByCategory).toHaveBeenCalledWith('smartphones', { limit: 100, skip: 0 });
    expect(boundary.listProductsByCategory).not.toHaveBeenCalledWith('fragrances', expect.anything());
  });

  it('clarifies a null structured comparison reference even when a displayed product exists', async () => {
    const boundary = catalog();
    const result = await createIntentOrchestrator({
      catalog: boundary,
      extractIntents: async () => ({
        response: 'I need a baseline.',
        intents: [{ intentId: 'phones', constraints: { category: 'smartphones' } }],
        operations: [{ op: 'refine_intent', intentIndex: 0, intentId: 'phones' }],
        priceSemantics: [{ kind: 'cheaper_than_reference' }],
      }),
    }).run({
      turnId: 'null-reference', conversationId: 'conversation', prompt: 'Find lower-priced alternatives.',
      previous: { turnId: 'prior', status: 'completed', response: 'phones', outcomes: [activePhone] },
      displayedProductReference: {
        referenceId: 'displayed:phones:0', intentId: 'phones', position: 0,
        product: { id: 1, title: 'Phone', price: 500, category: 'smartphones' },
      },
    });

    expect(result.outcomes[0]).toMatchObject({ intent: { status: 'needs_clarification' }, products: [] });
    expect(result.outcomes[0].clarification).toBeDefined();
    expect(boundary.listProductsByCategory).not.toHaveBeenCalled();
    expect(boundary.searchProducts).not.toHaveBeenCalled();
  });

  it('ignores price semantics attached only to non-executed drafts', async () => {
    const boundary = catalog();
    const result = await createIntentOrchestrator({
      catalog: boundary,
      extractIntents: async () => ({
        response: 'Searching phones.',
        intents: [
          { goal: 'Find phones', query: 'phones', constraints: { category: 'smartphones' } },
          { goal: 'Unused comparison', query: 'perfume', constraints: { category: 'fragrances' } },
        ],
        operations: [{ op: 'search', intentIndex: 0 }],
        priceSemantics: [{ kind: 'none' }, { kind: 'cheaper_than_reference', referenceId: 'unused-invented-reference' }],
      }),
    }).run({
      turnId: 'unused-semantic', conversationId: 'conversation', prompt: 'Show phones.',
    });

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].intent.constraints.category).toBe('smartphones');
    expect(result.outcomes[0].clarification).toBeUndefined();
    expect(boundary.listProductsByCategory).toHaveBeenCalledWith('smartphones', { limit: 100, skip: 0 });
  });

  it('executes an explicit clarification before any catalog action and preserves candidates', async () => {
    const boundary = catalog();
    const perfumeOutcome = {
      intent: { id: 'perfume', goal: 'Find perfume', query: 'perfume', constraints: { category: 'fragrances' }, status: 'completed' as const },
      products: [{ product: perfume, score: 1, matchReasons: [] }],
    };
    const result = await createIntentOrchestrator({
      catalog: boundary,
      extractIntents: async () => ({
        response: 'Which request?',
        intents: [{ constraints: {} }],
        operations: [{ op: 'clarify', reason: 'ambiguous_budget_scope', candidateIntentIds: ['phones', 'perfume'] }],
        priceSemantics: [{ kind: 'none' }],
      }),
    }).run({
      turnId: 'clarify', conversationId: 'conversation', prompt: 'Apply the lower limit to that request.',
      previous: { turnId: 'prior', status: 'completed', response: 'results', outcomes: [activePhone, perfumeOutcome] },
    });

    expect(result.status).toBe('partial');
    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes.every(({ intent }) => intent.status === 'needs_clarification')).toBe(true);
    expect(result.outcomes.filter(({ clarification }) => clarification).length).toBe(1);
    expect(boundary.listProductsByCategory).not.toHaveBeenCalled();
    expect(boundary.searchProducts).not.toHaveBeenCalled();
  });

  it('resumes a trusted durable paused intent without a catalog action', async () => {
    const boundary = catalog();
    const result = await createIntentOrchestrator({
      catalog: boundary,
      extractIntents: async () => ({
        response: 'Resuming.', intents: [{ constraints: {} }],
        operations: [{ op: 'resume_intent', intentId: 'phones' }],
        priceSemantics: [{ kind: 'none' }],
      }),
    }).run({
      turnId: 'resume', conversationId: 'conversation', prompt: 'חזור לחיפוש שהשהינו.',
      pausedOutcomes: [activePhone],
    });

    expect(result.stateActions).toEqual({ pauseIntentIds: [], resumeIntentIds: ['phones'] });
    expect(result.outcomes).toEqual([activePhone]);
    expect(boundary.listProductsByCategory).not.toHaveBeenCalled();
  });

  it('reports a pause-only state action without claiming it resumed anything', async () => {
    const boundary = catalog();
    const result = await createIntentOrchestrator({
      catalog: boundary,
      extractIntents: async () => ({
        response: 'Pause.', intents: [{ intentId: 'phones', constraints: { category: 'smartphones' } }],
        operations: [{ op: 'pause_intent', intentId: 'phones' }],
        priceSemantics: [{ kind: 'none' }],
      }),
    }).run({
      turnId: 'pause-only', conversationId: 'conversation', prompt: 'Pause the phone search.',
      previous: { turnId: 'prior', status: 'completed', response: 'phones', outcomes: [activePhone] },
    });

    expect(result.response).toBe('I paused the product search.');
    expect(result.stateActions).toEqual({ pauseIntentIds: ['phones'], resumeIntentIds: [] });
    expect(boundary.listProductsByCategory).not.toHaveBeenCalled();
  });

  it('rejects untrusted clarification candidates and conflicting duplicate execution', async () => {
    const boundary = catalog();
    const orchestrator = createIntentOrchestrator({
      catalog: boundary,
      extractIntents: async () => ({
        response: 'clarify', intents: [{ constraints: {} }],
        operations: [{ op: 'clarify', reason: 'missing_intent_target', candidateIntentIds: ['phones', 'invented'] }],
        priceSemantics: [{ kind: 'none' }],
      }),
    });
    await expect(orchestrator.run({
      turnId: 'untrusted-clarify', conversationId: 'conversation', prompt: 'Which one?',
      previous: { turnId: 'prior', status: 'completed', response: 'phones', outcomes: [activePhone] },
    })).rejects.toMatchObject({ code: 'invalid_plan' });
    expect(boundary.listProductsByCategory).not.toHaveBeenCalled();
  });

  it('rejects multiple or non-terminal clarification actions', async () => {
    const boundary = catalog();
    const create = (operations: Array<
      | { op: 'clarify'; reason: 'missing_price_reference'; candidateIntentIds: string[] }
      | { op: 'pause_intent'; intentId: string }
    >) => createIntentOrchestrator({
      catalog: boundary,
      extractIntents: async () => ({
        response: 'clarify', intents: [{ constraints: {} }], operations,
        priceSemantics: [{ kind: 'none' }],
      }),
    }).run({
      turnId: 'conflicting-clarify', conversationId: 'conversation', prompt: 'Clarify.',
      previous: { turnId: 'prior', status: 'completed', response: 'phones', outcomes: [activePhone] },
    });

    await expect(create([
      { op: 'clarify', reason: 'missing_price_reference', candidateIntentIds: [] },
      { op: 'clarify', reason: 'missing_price_reference', candidateIntentIds: ['phones'] },
    ])).rejects.toMatchObject({ code: 'invalid_plan' });
    await expect(create([
      { op: 'pause_intent', intentId: 'phones' },
      { op: 'clarify', reason: 'missing_price_reference', candidateIntentIds: ['phones'] },
    ])).rejects.toMatchObject({ code: 'invalid_plan' });
  });

  it('rejects selection combinations and pause-refine conflicts before catalog access', async () => {
    const boundary = catalog();
    const run = (operations: NonNullable<ExtractedTurnPlan['operations']>) => createIntentOrchestrator({
      catalog: boundary,
      extractIntents: async () => ({
        response: 'actions', intents: [{ intentId: 'phones', constraints: { category: 'smartphones' } }],
        operations, priceSemantics: [{ kind: 'none' }],
      }),
    }).run({
      turnId: 'conflict', conversationId: 'conversation', prompt: 'Do both.',
      previous: { turnId: 'prior', status: 'completed', response: 'phones', outcomes: [activePhone] },
      displayedProductReference: {
        referenceId: 'displayed:phones:0', intentId: 'phones', position: 0,
        product: { id: 1, title: 'Phone', price: 500, category: 'smartphones' },
      },
    });

    await expect(run([
      { op: 'select_product', referenceId: 'displayed:phones:0', presentation: 'show' },
      { op: 'refine_intent', intentIndex: 0, intentId: 'phones' },
    ])).rejects.toMatchObject({ code: 'invalid_plan' });
    await expect(run([
      { op: 'pause_intent', intentId: 'phones' },
      { op: 'refine_intent', intentIndex: 0, intentId: 'phones' },
    ])).rejects.toMatchObject({ code: 'invalid_plan' });
    expect(boundary.listProductsByCategory).not.toHaveBeenCalled();
  });

  it('rejects an invented product reference before product search', async () => {
    const boundary = catalog();
    await expect(createIntentOrchestrator({
      catalog: boundary,
      extractIntents: async () => ({
        response: 'selection', intents: [{ intentId: 'phones', constraints: {} }],
        operations: [{ op: 'select_product', referenceId: 'invented', presentation: 'show' }],
        priceSemantics: [{ kind: 'none' }],
      }),
    }).run({
      turnId: 'invalid', conversationId: 'conversation', prompt: 'Show that one.',
      previous: { turnId: 'prior', status: 'completed', response: 'phones', outcomes: [activePhone] },
    })).rejects.toMatchObject({ code: 'invalid_plan' });
    expect(boundary.listProductsByCategory).not.toHaveBeenCalled();
  });
});
