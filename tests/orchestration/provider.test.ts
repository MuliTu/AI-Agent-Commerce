import type { LanguageModel } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AgentBoundaryError } from '../../src/lib/agent';
import type { CatalogPage } from '../../src/lib/catalog';
import type { Environment } from '../../src/lib/config/environment';
import type { Product } from '../../src/lib/domain/contracts';
import type { IntentPlanGenerator } from '../../src/lib/orchestration/provider';
import {
  createIntentOrchestrator,
  createProviderIntentExtractor,
  providerExtractedTurnPlanSchema,
} from '../../src/lib/orchestration';

const environment: Environment = {
  LLM_PROVIDER: 'openai',
  LLM_API_KEY: 'test-server-key',
  LLM_MODEL: 'gpt-5.4-mini',
  LLM_BASE_URL: 'https://api.openai.com/v1',
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
  listProductsByCategory: vi.fn(async (): Promise<CatalogPage> => ({
    products: [product], total: 1, skip: 0, limit: 20,
  })),
  getProduct: vi.fn(),
  listCategories: vi.fn(async () => [{
    slug: 'smartphones', name: 'Smartphones', url: 'https://dummyjson.com/products/category/smartphones',
  }]),
};

const modelFactory = () => ({}) as LanguageModel;

describe('provider-backed intent extraction', () => {
  it('turns a shopper prompt into a schema-validated intent plan', async () => {
    const generate = vi.fn<IntentPlanGenerator>(async () => ({
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
      instructions: expect.stringContaining('Never invent an intentId'),
      prompt: expect.stringContaining('Find a photography phone under $700.'),
      maxRetries: 0,
      providerOptions: { openai: { strictJsonSchema: true } },
    }));
  });

  it('uses an OpenAI-compatible required-and-nullable wire schema', () => {
    const jsonSchema = z.toJSONSchema(providerExtractedTurnPlanSchema, {
      target: 'draft-7',
      io: 'input',
      reused: 'inline',
    }) as {
      required?: string[];
      properties?: {
        intents?: {
          items?: {
            required?: string[];
            properties?: { constraints?: { required?: string[] } };
          };
        };
      };
    };
    expect(jsonSchema.required).toEqual(['intents', 'operations', 'priceSemantics', 'response']);
    expect(jsonSchema.properties?.intents?.items?.required).toEqual([
      'intentId', 'goal', 'query', 'constraints', 'status',
    ]);
    expect(jsonSchema.properties?.intents?.items?.properties?.constraints?.required).toEqual([
      'maxPrice', 'minRating', 'category', 'inStock', 'brands', 'requiredTags', 'sort',
    ]);

    expect(providerExtractedTurnPlanSchema.parse({
      intents: [{
        intentId: null,
        goal: 'Laptop',
        query: 'laptop',
        constraints: {
          maxPrice: 500,
          minRating: 4,
          category: null,
          inStock: null,
          brands: null,
          requiredTags: null,
          sort: null,
        },
        status: 'ready',
      }],
      operations: [{
        op: 'search', intentId: null, intentIndex: 0, referenceId: null,
        presentation: null, reason: null, candidateIntentIds: [],
      }],
      priceSemantics: [{ kind: 'none', referenceId: null }],
      response: 'I will search for a laptop.',
    })).toEqual({
      intents: [{
        goal: 'Laptop',
        query: 'laptop',
        constraints: { maxPrice: 500, minRating: 4 },
        status: 'ready',
      }],
      operations: [{ op: 'search', intentIndex: 0 }],
      priceSemantics: [{ kind: 'none' }],
      response: 'I will search for a laptop.',
    });
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

  it('regenerates an intermittently schema-invalid provider plan with a strict bound', async () => {
    const generate = vi.fn()
      .mockRejectedValueOnce(new AgentBoundaryError(
        'invalid_tool_output', 'The model provider returned output that did not match the required schema.', false,
      ))
      .mockRejectedValueOnce(new AgentBoundaryError(
        'invalid_tool_output', 'The model provider returned output that did not match the required schema.', false,
      ))
      .mockResolvedValueOnce({
        intents: [{ goal: 'Phone', query: 'phone', constraints: { category: 'smartphones' } }],
        response: 'I will search for a phone.',
      });
    const extractIntents = createProviderIntentExtractor({ environment, modelFactory, generate });

    await expect(extractIntents({ prompt: 'Find a phone.', previousIntents: [] }))
      .resolves.toMatchObject({ intents: [{ goal: 'Phone' }] });
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it('stops after three schema-invalid provider plans', async () => {
    const generate = vi.fn(async () => {
      throw new AgentBoundaryError(
        'invalid_tool_output', 'The model provider returned output that did not match the required schema.', false,
      );
    });
    const extractIntents = createProviderIntentExtractor({ environment, modelFactory, generate });

    await expect(extractIntents({ prompt: 'Find a phone.', previousIntents: [] }))
      .rejects.toMatchObject({ code: 'invalid_tool_output' });
    expect(generate).toHaveBeenCalledTimes(3);
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
      environment: { LLM_PROVIDER: 'disabled' },
      modelFactory,
    })).toThrow(expect.objectContaining({ code: 'provider_authentication' }));
  });

  it('uses the explicit local LiteLLM model and loopback endpoint', () => {
    const localFactory = vi.fn(() => ({} as LanguageModel));
    createProviderIntentExtractor({
      environment: {
        ...environment,
        LLM_PROVIDER: 'litellm',
        LLM_API_KEY: 'local-test-key',
        LLM_BASE_URL: 'http://127.0.0.1:4001/v1',
        LLM_MODEL: 'qwen3.5-9b',
      },
      modelFactory: localFactory,
    });
    expect(localFactory).toHaveBeenCalledWith(
      'qwen3.5-9b', 'local-test-key', 'http://127.0.0.1:4001/v1', 'chat',
    );
  });

  it('uses compatible non-strict structured output options for local LiteLLM', async () => {
    const generate = vi.fn(async () => ({
      intents: [{ goal: 'Laptop', query: 'laptop' }],
      response: 'I will search for a laptop.',
    }));
    const extractIntents = createProviderIntentExtractor({
      environment: {
        ...environment,
        LLM_PROVIDER: 'litellm',
        LLM_API_KEY: 'local-test-key',
        LLM_BASE_URL: 'http://127.0.0.1:4001/v1',
        LLM_MODEL: 'qwen3.5-9b',
      },
      generate,
      modelFactory,
    });

    await extractIntents({ prompt: 'Find a laptop.', previousIntents: [] });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      maxOutputTokens: 1000,
      maxRetries: 0,
      providerOptions: { openai: { strictJsonSchema: false, reasoningEffort: 'none' } },
    }));
  });

  it('strips invented intent IDs and keeps exact prior IDs', async () => {
    const extractIntents = createProviderIntentExtractor({
      environment,
      modelFactory,
      generate: async () => ({
        intents: [
          { intentId: 'invented', goal: 'Laptop', query: 'laptop' },
          { intentId: 'prior:intent:1', query: 'work laptop' },
        ],
        response: 'I will search for a laptop.',
      }),
    });

    await expect(extractIntents({
      prompt: 'Make it suitable for work.',
      previousIntents: [{
        id: 'prior:intent:1',
        goal: 'Laptop',
        query: 'laptop',
        constraints: {},
        status: 'needs_clarification',
      }],
    })).resolves.toMatchObject({
      intents: [
        { intentId: undefined, goal: 'Laptop', query: 'laptop' },
        { intentId: 'prior:intent:1', query: 'work laptop' },
      ],
    });
  });

  it('sends the application-resolved displayed product reference as bounded planner context', async () => {
    let generatedPrompt = '';
    const generate: IntentPlanGenerator = async (options) => {
      generatedPrompt = options.prompt;
      return {
      intents: [{ intentId: 'phones', query: 'cheaper phone', constraints: { category: 'smartphones', sort: 'price_asc' } }],
      response: 'I will refine the referenced phone.',
      };
    };
    const extractIntents = createProviderIntentExtractor({ environment, modelFactory, generate });

    await extractIntents({
      prompt: 'Make the second one cheaper.',
      displayedProductReference: {
        intentId: 'phones',
        position: 1,
        product: { id: 12, title: 'Second Phone', price: 250, category: 'smartphones' },
      },
      previousIntents: [{
        id: 'phones', goal: 'Phones', query: 'phones', constraints: { category: 'smartphones' }, status: 'completed',
      }],
    });

    const providerPrompt = JSON.parse(generatedPrompt) as Record<string, unknown>;
    expect(providerPrompt.displayedProductReference).toEqual({
      intentId: 'phones', position: 1,
      product: { id: 12, title: 'Second Phone', price: 250, category: 'smartphones' },
    });
  });

  it('keeps provider tag guesses as ranking language instead of exact catalog filters', async () => {
    const extractIntents = createProviderIntentExtractor({
      environment,
      modelFactory,
      generate: async () => ({
        intents: [
          { goal: 'Photography phone', query: 'smartphone with strong camera quality', constraints: { category: 'smartphones', requiredTags: ['camera'] } },
          { goal: 'Fragrance gift', query: 'fragrance gift', constraints: { category: 'fragrances', maxPrice: 80, requiredTags: ['gift'] } },
        ],
        response: '.json',
      }),
    });

    await expect(extractIntents({
      prompt: 'I need a phone for photography and a fragrance gift under $80',
      previousIntents: [],
    })).resolves.toMatchObject({
      intents: [
        { constraints: { category: 'smartphones' } },
        { constraints: { category: 'fragrances', maxPrice: 80 } },
      ],
    });
  });
});
