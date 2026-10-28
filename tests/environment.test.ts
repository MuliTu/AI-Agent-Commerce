import { describe, expect, it } from 'vitest';
import { getProviderLabel, parseEnvironment } from '../src/lib/config/environment';

describe('server configuration', () => {
  it('allows an offline foundation without credentials', () => {
    expect(parseEnvironment({}).AI_PROVIDER).toBe('disabled');
  });
  it('requires a key when OpenAI is selected', () => {
    expect(() => parseEnvironment({ AI_PROVIDER: 'openai' })).toThrow('OPENAI_API_KEY: Required');
  });
  it('rejects whitespace-only credentials', () => {
    expect(() => parseEnvironment({ AI_PROVIDER: 'openai', OPENAI_API_KEY: ' ' })).toThrow('OPENAI_API_KEY');
  });
  it('rejects silent substitution of the configured model', () => {
    expect(() => parseEnvironment({
      AI_PROVIDER: 'openai', OPENAI_MODEL: 'other-model', OPENAI_API_KEY: 'test-only',
    })).toThrow('OPENAI_MODEL');
  });
  it('accepts the pinned loopback LiteLLM configuration', () => {
    const environment = parseEnvironment({
      AI_PROVIDER: 'litellm', LITELLM_API_KEY: 'test-only',
    });
    expect(environment).toMatchObject({
      LITELLM_BASE_URL: 'http://127.0.0.1:4001/v1', LITELLM_MODEL: 'qwen3.5-9b',
    });
    expect(getProviderLabel(environment)).toBe('Local LiteLLM / Qwen');
  });
  it('fails closed for a missing key or unapproved LiteLLM destination', () => {
    expect(() => parseEnvironment({ AI_PROVIDER: 'litellm' })).toThrow('LITELLM_API_KEY');
    expect(() => parseEnvironment({
      AI_PROVIDER: 'litellm', LITELLM_API_KEY: 'test-only', LITELLM_BASE_URL: 'http://example.com/v1',
    })).toThrow('LITELLM_BASE_URL');
  });
  it('never includes a supplied secret in validation errors', () => {
    try { parseEnvironment({ AI_PROVIDER: 'invalid', OPENAI_API_KEY: 'private-test-value' }); }
    catch (error) { expect(String(error)).not.toContain('private-test-value'); return; }
    throw new Error('Expected validation failure');
  });
});
