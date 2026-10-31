import { describe, expect, it } from 'vitest';
import { summarizeIntentPlan } from '../../src/lib/diagnostics/intent-plan-summary';

describe('safe intent plan summaries', () => {
  it('records bounded structure without response, goal, query, or intent ID text', () => {
    const summary = summarizeIntentPlan({
      response: 'מצאתי אפשרויות מתאימות.',
      intents: [
        {
          intentId: 'private-intent-123',
          goal: 'Find a camera phone for a private recipient',
          query: 'camera phone private wording',
          constraints: {
            category: 'Smart Phones',
            maxPrice: 500,
            inStock: true,
          },
          status: 'ready',
        },
        {
          constraints: {},
          status: 'needs_clarification',
        },
      ],
    });

    expect(summary).toEqual({
      intentCount: 2,
      response: { language: 'he', length: 23 },
      intents: [
        {
          index: 0,
          hasIntentId: true,
          status: 'ready',
          categoryPresent: true,
          category: 'smart-phones',
          constraintKeys: ['category', 'inStock', 'maxPrice'],
          goalLength: 43,
          queryLength: 28,
        },
        {
          index: 1,
          hasIntentId: false,
          status: 'needs_clarification',
          categoryPresent: false,
          constraintKeys: [],
          goalLength: 0,
          queryLength: 0,
        },
      ],
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('private-intent');
    expect(serialized).not.toContain('camera phone');
    expect(serialized).not.toContain('מצאתי');
  });

  it('omits secret-like or unsafe category values while retaining presence', () => {
    const summary = summarizeIntentPlan({
      response: 'ok',
      intents: [{
        goal: 'Private goal',
        query: 'Private query',
        constraints: { category: 'sk-secret-token-value' },
        status: 'ready',
      }],
    });

    expect(summary.intents[0]).toMatchObject({ categoryPresent: true });
    expect(summary.intents[0]).not.toHaveProperty('category');
    expect(JSON.stringify(summary)).not.toContain('secret');
  });

  it('rejects provider envelopes, products, and secret-bearing extra fields', () => {
    expect(() => summarizeIntentPlan({
      response: 'ok',
      apiKey: 'private',
      intents: [{ constraints: {}, status: 'ready' }],
    })).toThrow();
    expect(() => summarizeIntentPlan({
      response: 'ok',
      intents: [{
        constraints: {},
        status: 'ready',
        products: [{ id: 1, title: 'Private product' }],
      }],
    })).toThrow();
  });
});
