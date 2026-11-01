import { describe, expect, it, vi } from 'vitest';
import type { CatalogPage } from '../../src/lib/catalog';
import type { Product } from '../../src/lib/domain/contracts';
import { createIntentOrchestrator } from '../../src/lib/orchestration';

const products: Product[] = [
  { id: 1, title: 'Camera Phone', description: 'Photography phone', category: 'smartphones', price: 280, rating: 4.6, stock: 5, tags: ['camera'], brand: 'Apple', images: [] },
  { id: 2, title: 'Everyday Phone', description: 'Everyday mobile', category: 'smartphones', price: 240, rating: 4.2, stock: 5, tags: [], brand: 'Samsung', images: [] },
  { id: 3, title: 'Gift Fragrance', description: 'Fragrance gift', category: 'fragrances', price: 70, rating: 4.4, stock: 5, tags: [], brand: 'Scent', images: [] },
];

function page(items: Product[]): CatalogPage {
  return { products: items, total: items.length, skip: 0, limit: 100 };
}

function catalog() {
  return {
    searchProducts: vi.fn(async () => page(products)),
    listProductsByCategory: vi.fn(async (category: string) => page(products.filter((product) => product.category === category))),
    getProduct: vi.fn(async (id: number) => products.find((product) => product.id === id)!),
    listCategories: vi.fn(async () => [
      { slug: 'smartphones', name: 'Smartphones', url: 'catalog://smartphones' },
      { slug: 'fragrances', name: 'Fragrances', url: 'catalog://fragrances' },
    ]),
  };
}

describe('live QA functional regressions', () => {
  it.each([
    ['Find a phone not Samsung', 'brand_exclusion'],
    ['Find a phone and fragrance under $500 total', 'aggregate_budget'],
    ['Find a phone over $800 and under $300', 'contradictory_price'],
    ['Find a phone costing at least $250', 'minimum_price'],
    ['תן לי טלפון ובושם, יחד עד 500 דולר', 'aggregate_budget_hebrew'],
  ])('does not silently claim unsupported constraint semantics: %s', async (prompt, issueKind) => {
    const extractIntents = vi.fn(async () => ({ response: 'ignored', intents: [] }));
    const result = await createIntentOrchestrator({ catalog: catalog(), extractIntents }).run({
      turnId: issueKind, conversationId: 'qa', prompt,
    });

    expect(result).toMatchObject({
      status: 'failed',
      outcomes: [{ products: [], error: { code: 'unsupported_constraint', retryable: false } }],
    });
    expect(result.response).not.toContain('ignored');
    expect(extractIntents).not.toHaveBeenCalled();
  });

  it.each([
    ['Find a phone not Samsung', 'Brand exclusion is not supported'],
    ['Find a phone costing at least $250', 'Minimum-price filtering is not supported'],
    ['Find a phone under $200 but over $800', 'conflicts with the maximum price'],
    ['Find a phone and fragrance under $500 total', 'combined budget across products is not supported'],
  ])('explains the actual unsupported constraint: %s', async (prompt, expectedCopy) => {
    const result = await createIntentOrchestrator({
      catalog: catalog(), extractIntents: async () => ({ response: 'unused', intents: [] }),
    }).run({ turnId: `copy-${prompt.length}`, conversationId: 'qa', prompt });
    expect(result.response.toLocaleLowerCase('en-US')).toContain(expectedCopy.toLocaleLowerCase('en-US'));
  });

  it('repairs a Hebrew two-category plan that duplicates the phone intent', async () => {
    const result = await createIntentOrchestrator({
      catalog: catalog(),
      extractIntents: async () => ({
        response: 'מצאתי',
        intents: [
          { goal: 'טלפון', query: 'טלפון', constraints: { category: 'smartphones', maxPrice: 300 } },
          { goal: 'טלפון נוסף', query: 'טלפון', constraints: { category: 'smartphones', maxPrice: 80 } },
        ],
      }),
    }).run({
      turnId: 'hebrew-coverage', conversationId: 'qa',
      prompt: 'מצא לי טלפון עד 300 דולר ובושם עד 80 דולר',
    });

    expect(result.outcomes.map(({ intent }) => intent.constraints.category)).toEqual(['smartphones', 'fragrances']);
    expect(result.outcomes.map(({ intent }) => intent.constraints.maxPrice)).toEqual([300, 80]);
    expect(result.outcomes[1].products[0]?.product.id).toBe(3);
  });

  it('asks which active product to refine even when the provider invents a target id', async () => {
    const orchestrator = createIntentOrchestrator({
      catalog: catalog(),
      extractIntents: async ({ prompt, previousIntents }) => prompt.startsWith('Find') ? ({
        response: 'found',
        intents: [
          { goal: 'phone', query: 'phone', constraints: { category: 'smartphones' } },
          { goal: 'fragrance', query: 'fragrance', constraints: { category: 'fragrances' } },
        ],
      }) : ({
        response: 'updated fragrance',
        intents: [{ intentId: previousIntents[1]?.id, constraints: { maxPrice: 50 } }],
      }),
    });
    const first = await orchestrator.run({ turnId: 'multi', conversationId: 'qa', prompt: 'Find a phone and fragrance' });
    const result = await orchestrator.run({
      turnId: 'ambiguous', conversationId: 'qa', prompt: 'Show cheaper options', previous: first,
    });

    expect(result).toMatchObject({ status: 'partial', outcomes: [{ intent: { status: 'needs_clarification' } }] });
    expect(result.response).not.toContain('updated fragrance');
  });

  it('preserves an additive perfume topic and clarifies a later category-free cheaper request', async () => {
    const decisions: unknown[] = [];
    const orchestrator = createIntentOrchestrator({
      catalog: catalog(),
      observeDecision: (event) => decisions.push(event),
      extractIntents: async ({ prompt, previousIntents }) => {
        if (prompt === 'Find me a smartphone') {
          return {
            response: 'found phone',
            intents: [{ goal: 'smartphone', query: 'smartphone', constraints: { category: 'smartphones' } }],
          };
        }
        if (prompt.startsWith('Also')) {
          return {
            response: 'added perfume',
            intents: [{ goal: 'perfumes under $100', query: 'perfume', constraints: { category: 'fragrances', maxPrice: 100 } }],
          };
        }
        return {
          response: 'made perfume cheaper',
          intents: [{ intentId: previousIntents.find(({ constraints }) => constraints.category === 'fragrances')?.id, constraints: { sort: 'price_asc' as const } }],
        };
      },
    });
    const phoneTurn = await orchestrator.run({
      turnId: 'phone-turn', conversationId: 'same-conversation', prompt: 'Find me a smartphone',
    });
    const additiveTurn = await orchestrator.run({
      turnId: 'perfume-turn', conversationId: 'same-conversation',
      prompt: 'Also show me perfumes under $100.', previous: phoneTurn,
    });
    const cheaperTurn = await orchestrator.run({
      turnId: 'cheaper-turn', conversationId: 'same-conversation',
      prompt: 'Show me cheaper options', previous: additiveTurn,
    });

    expect(additiveTurn.outcomes.map(({ intent }) => intent.constraints.category))
      .toEqual(['smartphones', 'fragrances']);
    expect(additiveTurn.outcomes[0].intent.id).toBe(phoneTurn.outcomes[0].intent.id);
    expect(additiveTurn.outcomes[1].intent.id).not.toBe(phoneTurn.outcomes[0].intent.id);
    expect(cheaperTurn).toMatchObject({
      status: 'partial',
      outcomes: [{
        intent: { status: 'needs_clarification', constraints: { sort: 'price_asc' } },
        clarification: { field: 'category' },
      }],
    });
    expect(decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: 'follow_up_target', previousIntentCount: 1,
        additiveNamedRequest: true, decision: 'not_refinement', targetCount: 0,
      }),
      expect.objectContaining({
        stage: 'catalog_search', category: 'fragrances', filters: expect.objectContaining({ maxPrice: 100 }),
      }),
      expect.objectContaining({
        stage: 'follow_up_target', previousIntentCount: 2,
        constraintOnly: true, decision: 'clarify', targetCount: 2,
      }),
    ]));

    const selector = cheaperTurn.outcomes.find(({ intent }) => intent.status === 'needs_clarification');
    const selectedCategory = await orchestrator.run({
      turnId: 'selected-cheaper-turn', conversationId: 'same-conversation',
      prompt: 'Fragrances', previous: {
        ...cheaperTurn,
        outcomes: [...additiveTurn.outcomes, ...cheaperTurn.outcomes],
      },
      clarification: { intentId: selector!.intent.id, field: 'category', value: 'Fragrances' },
    });
    const priceQuestion = selectedCategory.outcomes.find(({ intent }) => intent.status === 'needs_clarification');
    expect(priceQuestion?.clarification).toMatchObject({ field: 'maxPrice' });
  });

  it('asks for an explicit price threshold for named cheaper options without a selected product', async () => {
    const orchestrator = createIntentOrchestrator({
      catalog: catalog(),
      extractIntents: async ({ prompt, previousIntents }) => prompt === 'Find smartphone' ? ({
        response: 'found phone',
        intents: [{ goal: 'phone', query: 'phone', constraints: { category: 'smartphones' } }],
      }) : prompt.startsWith('Also') ? ({
        response: 'found fragrance',
        intents: [{ goal: 'fragrance', query: 'fragrance', constraints: { category: 'fragrances', maxPrice: 100 } }],
      }) : ({
        response: 'sorted perfume',
        intents: [{
          intentId: previousIntents.find(({ constraints }) => constraints.category === 'fragrances')?.id,
          constraints: { category: 'fragrances', sort: 'price_asc' as const },
        }],
      }),
    });
    const phone = await orchestrator.run({
      turnId: 'named-cheaper-phone', conversationId: 'named-cheaper', prompt: 'Find smartphone',
    });
    const first = await orchestrator.run({
      turnId: 'named-cheaper-first', conversationId: 'named-cheaper',
      prompt: 'Also find perfumes under $100', previous: phone,
    });
    expect(first.outcomes.map(({ intent }) => intent.constraints.category)).toEqual(['smartphones', 'fragrances']);
    const result = await orchestrator.run({
      turnId: 'named-cheaper-second', conversationId: 'named-cheaper',
      prompt: 'Show me cheaper perfumes', previous: first,
    });

    expect(result.status).toBe('partial');
    const fragranceQuestion = result.outcomes.find(({ intent }) => intent.constraints.category === 'fragrances');
    expect(fragranceQuestion?.products).toEqual([]);
    expect(fragranceQuestion?.clarification).toMatchObject({
      field: 'maxPrice',
      question: 'What maximum price should I use for the cheaper options?',
      options: ['Under $50', 'Under $75', 'Under $90'],
    });
  });

  it.each([
    { previous: true, prompt: 'Show me cheaper perfumes under $50' },
    { previous: false, prompt: 'Find cheaper perfumes under $50' },
  ])('executes an explicit comparative budget without asking for it again: $prompt', async ({ previous, prompt }) => {
    const client = catalog();
    const orchestrator = createIntentOrchestrator({
      catalog: client,
      extractIntents: async ({ prompt: current, previousIntents }) => ({
        response: 'searched',
        intents: [{
          ...(previousIntents[0] ? { intentId: previousIntents[0].id } : {}),
          goal: current,
          query: 'perfume',
          constraints: { category: 'fragrances', maxPrice: current.includes('$50') ? 50 : 100, sort: 'price_asc' as const },
        }],
      }),
    });
    const prior = previous ? await orchestrator.run({
      turnId: `explicit-budget-prior-${prompt}`, conversationId: prompt,
      prompt: 'Find perfumes under $100',
    }) : undefined;
    const result = await orchestrator.run({
      turnId: `explicit-budget-${prompt}`, conversationId: prompt, prompt, previous: prior,
    });

    expect(result.status).toBe('completed');
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({
      intent: { status: 'completed', constraints: { category: 'fragrances', maxPrice: 50, sort: 'price_asc' } },
    });
    expect(result.outcomes[0]).not.toHaveProperty('clarification');
    expect(client.listProductsByCategory).toHaveBeenLastCalledWith('fragrances', expect.objectContaining({ limit: 100 }));
  });

  it.each([
    [10, ['Under $5', 'Under $7.5', 'Under $9']],
    [5, ['Under $2.5', 'Under $3.75', 'Under $4.5']],
    [1, ['Under $0.5', 'Under $0.75', 'Under $0.9']],
  ])('offers valid cheaper thresholds below a low $%s ceiling', async (ceiling, expectedOptions) => {
    const orchestrator = createIntentOrchestrator({
      catalog: catalog(),
      extractIntents: async ({ prompt, previousIntents }) => ({
        response: 'searched',
        intents: [{
          ...(previousIntents[0] ? { intentId: previousIntents[0].id } : {}),
          goal: prompt,
          query: 'perfume',
          constraints: { category: 'fragrances', maxPrice: ceiling },
        }],
      }),
    });
    const prior = await orchestrator.run({
      turnId: `low-ceiling-${ceiling}-prior`, conversationId: `low-ceiling-${ceiling}`,
      prompt: `Find perfumes under $${ceiling}`,
    });
    const question = await orchestrator.run({
      turnId: `low-ceiling-${ceiling}-question`, conversationId: `low-ceiling-${ceiling}`,
      prompt: 'Show me cheaper perfumes', previous: prior,
    });
    const pending = question.outcomes.find(({ intent }) => intent.status === 'needs_clarification');

    expect(pending?.clarification?.options).toEqual(expectedOptions);
    expect(new Set(pending?.clarification?.options).size).toBeGreaterThanOrEqual(2);
    if (ceiling === 10) {
      const answered = await orchestrator.run({
        turnId: 'low-ceiling-10-answer', conversationId: 'low-ceiling-10',
        prompt: expectedOptions[0], previous: question,
        clarification: { intentId: pending!.intent.id, field: 'maxPrice', value: expectedOptions[0] },
      });
      expect(answered.outcomes.find(({ intent }) => intent.id === pending!.intent.id)).toMatchObject({
        intent: { status: 'completed', constraints: { category: 'fragrances', maxPrice: 5 } },
      });
    }
  });

  it('returns an honest empty result when an existing zero ceiling has no lower valid threshold', async () => {
    const orchestrator = createIntentOrchestrator({
      catalog: catalog(),
      extractIntents: async ({ prompt, previousIntents }) => ({
        response: 'searched',
        intents: [{
          ...(previousIntents[0] ? { intentId: previousIntents[0].id } : {}),
          goal: prompt, query: 'perfume', constraints: { category: 'fragrances', maxPrice: 0 },
        }],
      }),
    });
    const prior = await orchestrator.run({
      turnId: 'zero-ceiling-prior', conversationId: 'zero-ceiling', prompt: 'Find perfumes under $0',
    });
    const result = await orchestrator.run({
      turnId: 'zero-ceiling-cheaper', conversationId: 'zero-ceiling',
      prompt: 'Show me cheaper perfumes', previous: prior,
    });

    expect(result.status).toBe('completed');
    expect(result.outcomes[0]).toMatchObject({ intent: { status: 'completed' }, products: [] });
    expect(result.outcomes[0]).not.toHaveProperty('clarification');
  });

  it('targets an explicitly named definite Hebrew product without asking ambiguity', async () => {
    const orchestrator = createIntentOrchestrator({
      catalog: catalog(),
      extractIntents: async ({ prompt, previousIntents }) => prompt.includes('מצא לי') ? ({
        response: 'מצאתי',
        intents: [
          { goal: 'טלפון', query: 'טלפון', constraints: { category: 'smartphones' } },
          { goal: 'בושם', query: 'בושם', constraints: { category: 'fragrances' } },
        ],
      }) : ({
        response: 'עדכנתי את הבושם',
        intents: [{ intentId: previousIntents[1]?.id, constraints: { category: 'fragrances', maxPrice: 70 } }],
      }),
    });
    const first = await orchestrator.run({ turnId: 'he-base', conversationId: 'qa', prompt: 'מצא לי טלפון ובושם' });
    const result = await orchestrator.run({
      turnId: 'he-follow-up', conversationId: 'qa', prompt: 'רק הבושם עד 70 דולר.', previous: first,
    });

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes.find(({ intent }) => intent.constraints.category === 'fragrances')).toMatchObject({
      intent: { constraints: { maxPrice: 70 }, status: 'completed' },
    });
    expect(result.outcomes.some(({ intent }) => intent.status === 'needs_clarification')).toBe(false);
    expect(result.outcomes.some(({ intent }) => intent.constraints.category === 'smartphones')).toBe(false);
  });

  it('does not present unsupported feature claims as catalog matches', async () => {
    const result = await createIntentOrchestrator({
      catalog: catalog(),
      extractIntents: async () => ({
        response: 'found IP68 phones',
        intents: [{ goal: 'IP68 phone', query: 'phone', constraints: { category: 'smartphones' } }],
      }),
    }).run({ turnId: 'feature', conversationId: 'qa', prompt: 'Find a phone with IP68 certification' });

    expect(result).toMatchObject({
      status: 'completed',
      outcomes: [{ products: [], error: { code: 'catalog_evidence_unavailable', retryable: false } }],
    });
    expect(result.response).not.toContain('found IP68 phones');
  });

  it('routes uncontracted eSIM evidence disclaimers to evidence handling', async () => {
    const extractIntents = vi.fn(async () => ({
      response: 'found eSIM phones',
      intents: [{ goal: 'eSIM phone', query: 'eSIM phone', constraints: { category: 'smartphones' } }],
    }));
    const result = await createIntentOrchestrator({ catalog: catalog(), extractIntents }).run({
      turnId: 'esim-disclaimer', conversationId: 'qa',
      prompt: 'Find a smartphone with eSIM support. If the catalog does not mention eSIM, say so and return no products.',
    });

    expect(extractIntents).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      outcomes: [{ products: [], error: { code: 'catalog_evidence_unavailable' } }],
    });
    expect(result.response).toContain('catalog does not state the requested feature');
  });

  it('fails safely for an unseen explicit satellite-calling evidence requirement', async () => {
    const result = await createIntentOrchestrator({
      catalog: catalog(),
      extractIntents: async () => ({
        response: 'found satellite phones',
        intents: [{ goal: 'Satellite calling phone', query: 'satellite calling phone', constraints: { category: 'smartphones' } }],
      }),
    }).run({
      turnId: 'satellite-evidence', conversationId: 'qa',
      prompt: 'Find a smartphone with satellite calling. If the catalog does not mention satellite calling, return no products.',
    });

    expect(result).toMatchObject({
      outcomes: [{ products: [], error: { code: 'catalog_evidence_unavailable' } }],
    });
    expect(result.response).not.toContain('found satellite phones');
  });

  it('requires trusted evidence for camera quality and evening use', async () => {
    const cameraResult = await createIntentOrchestrator({
      catalog: catalog(),
      extractIntents: async () => ({
        response: 'camera phones',
        intents: [{ goal: 'Good camera phone', query: 'good camera phone', constraints: { category: 'smartphones', maxPrice: 300 } }],
      }),
    }).run({ turnId: 'good-camera', conversationId: 'qa', prompt: 'Find a phone under $300 with a good camera' });
    expect(cameraResult.outcomes[0].products.map(({ product }) => product.id)).toEqual([1]);
    expect(cameraResult.response).toContain('does not objectively verify camera quality');

    const eveningResult = await createIntentOrchestrator({
      catalog: catalog(),
      extractIntents: async () => ({
        response: 'evening fragrance',
        intents: [{ goal: 'Evening fragrance', query: 'evening fragrance', constraints: { category: 'fragrances', maxPrice: 100 } }],
      }),
    }).run({ turnId: 'evening', conversationId: 'qa', prompt: 'Find an evening fragrance under $100' });
    expect(eveningResult).toMatchObject({
      outcomes: [{ products: [], error: { code: 'catalog_evidence_unavailable' } }],
    });
  });

  it('enforces Hebrew evening evidence independently of provider paraphrasing', async () => {
    const result = await createIntentOrchestrator({
      catalog: catalog(),
      extractIntents: async () => ({
        response: 'מצאתי מוצרים',
        intents: [
          { goal: 'טלפון', query: 'phone', constraints: { category: 'smartphones', maxPrice: 400, inStock: true } },
          { goal: 'בושם', query: 'fragrance', constraints: { category: 'fragrances', maxPrice: 80, inStock: true } },
        ],
      }),
    }).run({
      turnId: 'he-evening', conversationId: 'qa',
      prompt: 'תמצא לי טלפון עד 400 דולר ובושם לערב עד 80 דולר, שניהם במלאי',
    });

    const fragranceOutcome = result.outcomes.find(({ intent }) => intent.constraints.category === 'fragrances');
    expect(fragranceOutcome).toMatchObject({
      products: [], error: { code: 'catalog_evidence_unavailable' },
    });
  });

  it('separates arithmetic from the supported sibling in a mixed request', async () => {
    const result = await createIntentOrchestrator({
      catalog: catalog(),
      extractIntents: async () => ({
        response: '493 and a phone',
        intents: [
          { goal: 'Find a phone', query: 'phone', constraints: { category: 'smartphones' } },
          { goal: 'Calculate 17 times 29', query: '17 times 29', constraints: {} },
        ],
      }),
    }).run({ turnId: 'mixed', conversationId: 'qa', prompt: 'Find a phone and calculate 17 times 29' });

    expect(result).toMatchObject({
      status: 'partial',
      outcomes: [
        { intent: { status: 'completed' } },
        { intent: { status: 'failed' }, error: { code: 'outside_product_catalog' } },
      ],
    });
    expect(result.outcomes[0].products.map(({ product }) => product.id)).toContain(1);
    expect(result.response).not.toContain('493');
  });

  it('keeps an unknown product category distinct from an off-topic refusal', async () => {
    const result = await createIntentOrchestrator({
      catalog: catalog(),
      extractIntents: async () => ({
        response: 'searching',
        intents: [{ goal: 'Find a telescope', query: 'telescope', constraints: { category: 'telescopes' } }],
      }),
    }).run({ turnId: 'unknown', conversationId: 'qa', prompt: 'Find a telescope' });

    expect(result.outcomes[0]).toMatchObject({
      intent: { status: 'failed' },
      error: { code: 'unknown_catalog_category', retryable: false },
    });
    expect(result.response).toBe(
      'I could not match that product request to a catalog category, so I will not substitute an unrelated product. Try another product type available in the catalog.',
    );
    expect(result.response).not.toContain('can’t answer');
  });

  it('asks which product owns an unscoped budget in a multi-product request', async () => {
    const extractIntents = vi.fn();
    const result = await createIntentOrchestrator({
      catalog: catalog(),
      extractIntents,
    }).run({
      turnId: 'ambiguous-budget',
      conversationId: 'qa',
      prompt: 'Find a phone and a fragrance under $300',
    });

    expect(extractIntents).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'failed',
      outcomes: [{ error: { code: 'unsupported_constraint', retryable: false } }],
    });
    expect(result.response).toBe('It is unclear which product the budget applies to. Which product should I update?');
  });
});
