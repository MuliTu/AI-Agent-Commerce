import { describe, expect, it, vi } from 'vitest';
import { APICallError, type LanguageModel } from 'ai';
import { createCommerceAgent, MAX_TOOL_STEPS } from '../../src/lib/agent';
import type { AgentCatalogClient, AgentTextGenerator } from '../../src/lib/agent';
import type { Environment } from '../../src/lib/config/environment';

const catalog = {
  searchProducts: vi.fn(),
  getProduct: vi.fn(),
  listCategories: vi.fn(),
} satisfies AgentCatalogClient;

const environment: Environment = {
  AI_PROVIDER: 'openai',
  OPENAI_MODEL: 'gpt-5.4-mini',
  OPENAI_API_KEY: 'test-only-key',
};

describe('commerce agent runtime', () => {
  it('pins GPT-5.4-mini and supplies all typed catalog tools', async () => {
    const generate = vi.fn<AgentTextGenerator>(async () => ({ text: 'Catalog-grounded answer' }));
    const modelFactory = vi.fn(() => ({} as LanguageModel));
    const agent = createCommerceAgent({ environment, catalog, generate, modelFactory });

    await expect(agent.generate('Find a phone')).resolves.toBe('Catalog-grounded answer');
    expect(agent.modelId).toBe('gpt-5.4-mini');
    expect(modelFactory).toHaveBeenCalledWith('gpt-5.4-mini', 'test-only-key');
    const request = generate.mock.calls[0]?.[0];
    expect(Object.keys(request?.tools ?? {})).toEqual(['searchCatalog', 'getProduct', 'listCategories']);
  });

  it('enforces a bounded five-step tool loop', async () => {
    const generate = vi.fn<AgentTextGenerator>(async () => ({ text: 'done' }));
    const agent = createCommerceAgent({
      environment,
      catalog,
      generate,
      modelFactory: () => ({} as LanguageModel),
    });
    await agent.generate('Find a phone');
    const stopWhen = generate.mock.calls[0]?.[0].stopWhen;
    expect(MAX_TOOL_STEPS).toBe(5);
    expect(await stopWhen?.({ steps: Array.from({ length: 4 }) as never[] })).toBe(false);
    expect(await stopWhen?.({ steps: Array.from({ length: 5 }) as never[] })).toBe(true);
  });

  it('requires explicit provider access and a nonempty prompt', async () => {
    expect(() => createCommerceAgent({
      environment: { AI_PROVIDER: 'disabled', OPENAI_MODEL: 'gpt-5.4-mini' },
      catalog,
    })).toThrow('OpenAI must be explicitly enabled');

    const agent = createCommerceAgent({
      environment,
      catalog,
      generate: async () => ({ text: 'unused' }),
      modelFactory: () => ({} as LanguageModel),
    });
    await expect(agent.generate(' ')).rejects.toMatchObject({
      code: 'invalid_tool_output', retryable: false,
    });
    await expect(agent.generate(42 as unknown as string)).rejects.toMatchObject({
      code: 'invalid_tool_output', retryable: false,
    });
  });

  it.each([
    { text: '' },
    { text: 42 },
    {},
  ])('rejects malformed model output %#', async (modelOutput) => {
    const agent = createCommerceAgent({
      environment,
      catalog,
      generate: async () => modelOutput as unknown as { text: string },
      modelFactory: () => ({} as LanguageModel),
    });
    await expect(agent.generate('Find a phone')).rejects.toMatchObject({
      code: 'invalid_tool_output', retryable: false,
    });
  });

  it('translates provider failures into a typed safe error', async () => {
    const agent = createCommerceAgent({
      environment,
      catalog,
      generate: async () => { throw new Error('private provider response'); },
      modelFactory: () => ({} as LanguageModel),
    });
    try {
      await agent.generate('Find a phone');
    } catch (error) {
      expect(error).toMatchObject({ code: 'provider_unavailable', retryable: false });
      expect(String(error)).not.toContain('private provider response');
      return;
    }
    throw new Error('Expected provider failure');
  });

  it.each([
    [401, 'provider_authentication', false],
    [429, 'provider_rate_limit', true],
    [503, 'provider_unavailable', true],
  ] as const)('classifies provider HTTP %s', async (statusCode, code, retryable) => {
    const providerError = new APICallError({
      message: 'private provider response',
      url: 'https://provider.invalid',
      requestBodyValues: {},
      statusCode,
      responseBody: 'private response body',
    });
    const agent = createCommerceAgent({
      environment,
      catalog,
      generate: async () => { throw providerError; },
      modelFactory: () => ({} as LanguageModel),
    });
    try {
      await agent.generate('Find a phone');
    } catch (error) {
      expect(error).toMatchObject({ code, retryable });
      expect(String(error)).not.toContain('private provider response');
      return;
    }
    throw new Error('Expected provider failure');
  });
});
