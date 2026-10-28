import { describe, expect, it } from 'vitest';
import { getProviderLabel, parseEnvironment } from '../src/lib/config/environment';

describe('server configuration', () => {
  it('allows an offline foundation without credentials', () => {
    expect(parseEnvironment({}).LLM_PROVIDER).toBe('disabled');
  });
  it('requires a key when OpenAI is selected', () => {
    expect(() => parseEnvironment({ LLM_PROVIDER: 'openai' })).toThrow('LLM_API_KEY');
  });
  it('rejects whitespace-only credentials', () => {
    expect(() => parseEnvironment({ LLM_PROVIDER: 'openai', LLM_API_KEY: ' ' })).toThrow('LLM_API_KEY');
  });
  it('rejects silent substitution of the configured model', () => {
    expect(() => parseEnvironment({
      LLM_PROVIDER: 'openai', LLM_MODEL: 'other-model', LLM_API_KEY: 'test-only',
    })).toThrow('LLM_MODEL');
  });
  it('accepts the pinned loopback LiteLLM configuration', () => {
    const environment = parseEnvironment({
      LLM_PROVIDER: 'litellm', LLM_API_KEY: 'test-only',
    });
    expect(environment).toMatchObject({
      LLM_BASE_URL: 'http://127.0.0.1:4001/v1', LLM_MODEL: 'qwen3.5-9b',
    });
    expect(getProviderLabel(environment)).toBe('Local LiteLLM / Qwen');
  });
  it('fails closed for a missing key or unapproved LiteLLM destination', () => {
    expect(() => parseEnvironment({ LLM_PROVIDER: 'litellm' })).toThrow('LLM_API_KEY');
    expect(() => parseEnvironment({
      LLM_PROVIDER: 'litellm', LLM_API_KEY: 'test-only', LLM_BASE_URL: 'http://example.com/v1',
    })).toThrow('LLM_BASE_URL');
  });
  it('never includes a supplied secret in validation errors', () => {
    try { parseEnvironment({ LLM_PROVIDER: 'invalid', LLM_API_KEY: 'private-test-value' }); }
    catch (error) { expect(String(error)).not.toContain('private-test-value'); return; }
    throw new Error('Expected validation failure');
  });
});
