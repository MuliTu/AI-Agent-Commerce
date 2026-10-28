import { describe, expect, it } from 'vitest';
import { toProviderAgentError } from '../../src/lib/agent/errors';

describe('provider transport error mapping', () => {
  it('maps a nested connection refusal to a sanitized retryable provider error', () => {
    const cause = Object.assign(new Error('connect 127.0.0.1:4001'), { code: 'ECONNREFUSED' });
    const mapped = toProviderAgentError(new Error('request wrapper', { cause }));

    expect(mapped).toMatchObject({
      code: 'provider_unavailable',
      message: 'The model provider is temporarily unreachable. Try again.',
      retryable: true,
    });
    expect(mapped.message).not.toContain('127.0.0.1');
  });

  it('maps the fetch TypeError contract to a retryable provider error', () => {
    const mapped = toProviderAgentError(new TypeError('fetch failed'));
    expect(mapped).toMatchObject({ code: 'provider_unavailable', retryable: true });
  });

  it('keeps arbitrary programming failures nonretryable and sanitized', () => {
    const mapped = toProviderAgentError(new Error('Cannot read privateProvider.token'));
    expect(mapped).toMatchObject({
      code: 'provider_unavailable',
      message: 'The model provider request failed.',
      retryable: false,
    });
    expect(mapped.message).not.toContain('privateProvider');
  });

  it('maps branded structured-output failures without leaking generated text', () => {
    const generated = Object.assign(new Error('private generated response: secret catalog claim'), {
      name: 'AI_NoObjectGeneratedError',
      [Symbol.for('vercel.ai.error.AI_NoObjectGeneratedError')]: true,
      text: 'private generated response: secret catalog claim',
    });
    const mapped = toProviderAgentError(generated);

    expect(mapped).toMatchObject({
      code: 'invalid_tool_output',
      message: 'The model provider returned output that did not match the required schema.',
      retryable: false,
    });
    expect(mapped.message).not.toContain('secret catalog claim');
    expect(mapped.cause).toBeUndefined();
  });
});
