import type { LanguageModel } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import type { Environment } from '../../src/lib/config/environment';
import {
  createProviderSemanticEvidenceEvaluator,
  type SemanticEvidenceGenerator,
} from '../../src/lib/orchestration';

const modelFactory = vi.fn(() => ({}) as LanguageModel);

describe('provider semantic evidence evaluator', () => {
  it('uses the OpenAI-compatible chat transport for LiteLLM and sends only trusted fields', async () => {
    const environment: Environment = {
      LLM_PROVIDER: 'litellm',
      LLM_API_KEY: 'local-test-key',
      LLM_MODEL: 'qwen3.5-9b',
      LLM_BASE_URL: 'http://127.0.0.1:4001/v1',
    };
    const generate = vi.fn<SemanticEvidenceGenerator>(async () => ({ assessments: [] }));
    const evaluator = createProviderSemanticEvidenceEvaluator({ environment, generate, modelFactory });

    await evaluator({
      requirements: [{ label: 'satellite calling', alternatives: ['satellite calling'] }],
      products: [{
        id: 7, title: 'Catalog Phone', description: 'Trusted description', tags: ['mobile'],
        category: 'smartphones', price: 400, images: [], brand: 'Private Brand', stock: 5,
      }],
    });

    expect(modelFactory).toHaveBeenCalledWith('qwen3.5-9b', 'local-test-key', 'http://127.0.0.1:4001/v1', 'chat');
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      instructions: expect.stringContaining('Similarity, common knowledge'),
      maxRetries: 0,
      maxOutputTokens: 1600,
      providerOptions: { openai: { strictJsonSchema: false, reasoningEffort: 'none' } },
    }));
    const call = generate.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    const prompt = JSON.parse(call?.prompt ?? '{}');
    expect(prompt).toEqual({
      requirements: ['satellite calling'],
      products: [{ id: 7, title: 'Catalog Phone', description: 'Trusted description', tags: ['mobile'] }],
    });
    expect(call?.prompt).not.toContain('Private Brand');
  });

  it('uses the responses transport and strict schema for hosted OpenAI', async () => {
    const environment: Environment = {
      LLM_PROVIDER: 'openai',
      LLM_API_KEY: 'hosted-test-key',
      LLM_MODEL: 'gpt-5.4-mini',
      LLM_BASE_URL: 'https://api.openai.com/v1',
    };
    const generate = vi.fn<SemanticEvidenceGenerator>(async () => ({ assessments: [] }));
    const evaluator = createProviderSemanticEvidenceEvaluator({ environment, generate, modelFactory });

    await evaluator({ requirements: [], products: [] });

    expect(modelFactory).toHaveBeenCalledWith(
      'gpt-5.4-mini', 'hosted-test-key', 'https://api.openai.com/v1', 'responses',
    );
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      maxRetries: 0,
      providerOptions: { openai: { strictJsonSchema: true } },
    }));
  });
});
