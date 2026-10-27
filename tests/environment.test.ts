import { describe, expect, it } from 'vitest';
import { parseEnvironment } from '../src/lib/config/environment';

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
  it('never includes a supplied secret in validation errors', () => {
    try { parseEnvironment({ AI_PROVIDER: 'invalid', OPENAI_API_KEY: 'private-test-value' }); }
    catch (error) { expect(String(error)).not.toContain('private-test-value'); return; }
    throw new Error('Expected validation failure');
  });
});
