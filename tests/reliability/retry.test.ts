import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentBoundaryError } from '../../src/lib/agent/errors';
import { CatalogError } from '../../src/lib/catalog/errors';
import {
  InMemoryIdempotencyRegistry,
  MAX_ATTEMPTS,
  classifyFailure,
  executeWithRetry,
  retryDelayMs,
} from '../../src/lib/reliability';

describe('failure classification', () => {
  it.each([
    [new CatalogError('timeout', 'timeout', { endpoint: '/products' }), true, 'transient'],
    [new CatalogError('network', 'network', { endpoint: '/products' }), true, 'transient'],
    [new CatalogError('http', 'rate limited', { endpoint: '/products', status: 429 }), true, 'transient'],
    [new CatalogError('http', 'request timeout', { endpoint: '/products', status: 408 }), true, 'transient'],
    [new CatalogError('http', 'unavailable', { endpoint: '/products', status: 503 }), true, 'transient'],
    [new CatalogError('http', 'unauthorized', { endpoint: '/products', status: 401 }), false, 'authentication'],
    [new CatalogError('http', 'not found', { endpoint: '/products', status: 404 }), false, 'permanent'],
    [new CatalogError('invalid_request', 'invalid', { endpoint: '/products' }), false, 'validation'],
    [new AgentBoundaryError('provider_rate_limit', 'limited', true), true, 'transient'],
    [new AgentBoundaryError('provider_authentication', 'denied', false), false, 'authentication'],
    [new AgentBoundaryError('invalid_tool_output', 'invalid', false), false, 'validation'],
  ])('classifies known boundaries', (error, retryable, category) => {
    expect(classifyFailure(error)).toEqual({ retryable, category });
  });

  it('fails closed for unknown errors', () => {
    expect(classifyFailure(new Error('unknown'))).toEqual({ category: 'permanent', retryable: false });
  });
});

describe('bounded retry execution', () => {
  afterEach(() => vi.useRealTimers());

  it('uses exactly one initial attempt and four retries', async () => {
    const operation = vi.fn().mockRejectedValue(
      new AgentBoundaryError('provider_unavailable', 'unavailable', true),
    );
    await expect(executeWithRetry(operation, { sleep: async () => undefined, random: () => 0 }))
      .rejects.toThrow('unavailable');
    expect(operation).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(operation.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns when a transient operation succeeds', async () => {
    const attempts: unknown[] = [];
    const operation = vi.fn()
      .mockRejectedValueOnce(new CatalogError('network', 'offline', { endpoint: '/products' }))
      .mockResolvedValueOnce('ok');
    await expect(executeWithRetry(operation, {
      sleep: async () => undefined,
      random: () => 0.5,
      onAttempt: (attempt) => attempts.push(attempt),
    }))
      .resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(attempts).toEqual([
      {
        attempt: 1,
        outcome: 'failed',
        classification: { category: 'transient', retryable: true },
        delayMs: 100,
      },
      { attempt: 2, outcome: 'succeeded' },
    ]);
  });

  it('records the first successful attempt', async () => {
    const observer = vi.fn();
    await expect(executeWithRetry(async () => 'ok', { onAttempt: observer })).resolves.toBe('ok');
    expect(observer).toHaveBeenCalledExactlyOnceWith({ attempt: 1, outcome: 'succeeded' });
  });

  it('contains observer failures without changing operation success or retry flow', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new CatalogError('network', 'offline', { endpoint: '/products' }))
      .mockResolvedValueOnce('recovered');
    const observer = vi.fn(() => { throw new Error('telemetry failed'); });
    await expect(executeWithRetry(operation, {
      sleep: async () => undefined,
      random: () => 0,
      onAttempt: observer,
    })).resolves.toBe('recovered');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(observer).toHaveBeenCalledTimes(2);
  });

  it.each([
    new AgentBoundaryError('provider_authentication', 'denied', false),
    new CatalogError('invalid_request', 'invalid', { endpoint: '/products' }),
    new CatalogError('http', 'bad request', { endpoint: '/products', status: 400 }),
  ])('never retries permanent, authentication, or validation failures', async (error) => {
    const operation = vi.fn().mockRejectedValue(error);
    await expect(executeWithRetry(operation, { sleep: async () => undefined })).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('uses capped exponential full jitter with an injectable source', () => {
    expect([1, 2, 3, 4].map((attempt) => retryDelayMs(attempt, {
      baseDelayMs: 100,
      maxDelayMs: 250,
      random: () => 0.5,
    }))).toEqual([50, 100, 125, 125]);
  });

  it('supports deterministic fake-timer execution with the default sleep', async () => {
    vi.useFakeTimers();
    const operation = vi.fn()
      .mockRejectedValueOnce(new CatalogError('timeout', 'timeout', { endpoint: '/products' }))
      .mockResolvedValueOnce('recovered');
    const result = executeWithRetry(operation, { baseDelayMs: 100, random: () => 1 });
    await vi.advanceTimersByTimeAsync(99);
    expect(operation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('recovered');
    expect(operation).toHaveBeenCalledTimes(2);
  });
});

describe('in-memory idempotency', () => {
  it('shares one in-flight and completed result for duplicate keys', async () => {
    const registry = new InMemoryIdempotencyRegistry();
    let release!: (value: string) => void;
    const operation = vi.fn(() => new Promise<string>((resolve) => { release = resolve; }));
    const first = registry.run('turn-1', operation);
    const duplicate = registry.run('turn-1', operation);
    await Promise.resolve();
    expect(operation).toHaveBeenCalledTimes(1);
    release('saved-once');
    await expect(Promise.all([first, duplicate])).resolves.toEqual(['saved-once', 'saved-once']);
    await expect(registry.run('turn-1', operation)).resolves.toBe('saved-once');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('removes failed operations so an explicit replay may retry', async () => {
    const registry = new InMemoryIdempotencyRegistry();
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce('recovered');
    await expect(registry.run('turn-2', operation)).rejects.toThrow('failed');
    await expect(registry.run('turn-2', operation)).resolves.toBe('recovered');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('rejects empty idempotency keys without invoking work', async () => {
    const registry = new InMemoryIdempotencyRegistry();
    const operation = vi.fn().mockResolvedValue('unexpected');
    await expect(registry.run('   ', operation)).rejects.toThrow('idempotency key is required');
    expect(operation).not.toHaveBeenCalled();
  });
});
