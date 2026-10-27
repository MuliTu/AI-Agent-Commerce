import type { LanguageModel } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { AgentBoundaryError } from '../../src/lib/agent';
import type { CatalogPage } from '../../src/lib/catalog';
import type { Environment } from '../../src/lib/config/environment';
import type { Product } from '../../src/lib/domain/contracts';
import { createIntentOrchestrator, createProviderIntentExtractor } from '../../src/lib/orchestration';

const environment: Environment = {
  AI_PROVIDER: 'openai',
  OPENAI_API_KEY: 'test-server-key',
  OPENAI_MODEL: 'gpt-5.4-mini',
};

const product: Product = {
  id: 7,
  title: 'Catalog Phone',
  description: 'Trusted phone',
  category: 'smartphones',
  price: 500,
  rating: 4.5,
  stock: 2,
  tags: ['camera'],
  images: [],
};

const catalog = {
  searchProducts: vi.fn(async (): Promise<CatalogPage> => ({
    products: [product], total: 1, skip: 0, limit: 20,
  })),
  getProduct: vi.fn(),
  listCategories: vi.fn(),
};

const modelFactory = () => ({}) as LanguageModel;

describe('provider-backed intent extraction', () => {
  it('turns a shopper prompt into a schema-validated intent plan', async () => {
    const generate = vi.fn(async () => ({
      intents: [{ goal: 'Photography phone', query: 'phone camera', constraints: { maxPrice: 700 } }],
      response: 'I will search the catalog for a photography phone.',
    }));
    const extractIntents = createProviderIntentExtractor({ environment, generate, modelFactory });
    const orchestrator = createIntentOrchestrator({ catalog, extractIntents });

    const result = await orchestrator.run({
      turnId: 'provider-turn',
      conversationId: 'conversation-1',
      prompt: 'Find a photography phone under $700.',
    });

    expect(result.status).toBe('completed');
    expect(result.outcomes[0].intent).toMatchObject({
      goal: 'Photography phone',
      constraints: { maxPrice: 700 },
    });
    expect(result.outcomes[0].products[0].product.id).toBe(7);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      instructions: expect.stringContaining('Never include product records'),
      prompt: expect.stringContaining('Find a photography phone under $700.'),
    }));
  });

  it('maps malformed structured provider output to an invalid plan', async () => {
    const extractIntents = createProviderIntentExtractor({
      environment,
      modelFactory,
      generate: async () => ({ intents: [], response: '' }),
    });
    const orchestrator = createIntentOrchestrator({ catalog, extractIntents });

    await expect(orchestrator.run({
      turnId: 'malformed-turn', conversationId: 'conversation-1', prompt: 'Find a phone.',
    })).rejects.toMatchObject({ code: 'invalid_plan' });
  });

  it('preserves typed provider failures instead of relabeling them invalid_plan', async () => {
    const failure = new AgentBoundaryError(
      'provider_rate_limit', 'The model provider rate limit was reached.', true,
    );
    const extractIntents = createProviderIntentExtractor({
      environment,
      modelFactory,
      generate: async () => { throw failure; },
    });
    const orchestrator = createIntentOrchestrator({ catalog, extractIntents });

    await expect(orchestrator.run({
      turnId: 'failure-turn', conversationId: 'conversation-1', prompt: 'Find a phone.',
    })).rejects.toBe(failure);
  });

  it('fails closed when provider credentials or the exact model pin are unavailable', () => {
    expect(() => createProviderIntentExtractor({
      environment: { ...environment, OPENAI_API_KEY: undefined },
      modelFactory,
    })).toThrow(expect.objectContaining({ code: 'provider_authentication' }));
    expect(() => createProviderIntentExtractor({
      environment: { ...environment, OPENAI_MODEL: 'other-model' as 'gpt-5.4-mini' },
      modelFactory,
    })).toThrow(expect.objectContaining({ code: 'provider_authentication' }));
  });
});
