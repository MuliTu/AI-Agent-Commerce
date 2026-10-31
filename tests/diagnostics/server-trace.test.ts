import { describe, expect, it, vi } from 'vitest';
import type { OrchestrationResult } from '../../src/lib/orchestration';
import { createServerDiagnosticReporter, serverDiagnosticLevel } from '../../src/lib/diagnostics/server-trace';

const result: OrchestrationResult = {
  turnId: 'private-turn',
  status: 'completed',
  response: 'Private model prose',
  outcomes: [{
    intent: {
      id: 'private-intent', goal: 'Private goal', query: 'private query',
      constraints: { category: 'fragrances', maxPrice: 100, sort: 'price_asc' }, status: 'completed',
    },
    products: [{
      product: {
        id: 7, title: 'Trusted Perfume', description: 'Private catalog description',
        category: 'fragrances', price: 40, tags: [], images: [],
      },
      score: 0.8,
      matchReasons: [],
    }],
  }],
};

describe('correlated server diagnostics', () => {
  it('is disabled by default and always disabled in production', () => {
    expect(serverDiagnosticLevel({ NODE_ENV: 'development' })).toBe('off');
    expect(serverDiagnosticLevel({ NODE_ENV: 'production', BAZAK_SERVER_DIAGNOSTICS: 'verbose' })).toBe('off');
  });

  it('logs correlated structural summaries without shopper or title text', () => {
    const write = vi.fn();
    const reporter = createServerDiagnosticReporter({
      conversationId: 'private-conversation', turnId: 'private-turn',
      environment: { NODE_ENV: 'development', BAZAK_SERVER_DIAGNOSTICS: 'summary' }, write,
    });
    reporter.request('Find perfume for api_key=private-value', { hasClarification: false });
    reporter.result(result);

    expect(write).toHaveBeenCalledTimes(2);
    const output = write.mock.calls.flat().join('\n');
    expect(output).toContain('bazak_server_diagnostic');
    expect(output).toContain(reporter.traceId);
    expect(output).toContain('request_received');
    expect(output).toContain('result_completed');
    expect(output).toContain('"productIds":[7]');
    expect(output).not.toContain('private-value');
    expect(output).not.toContain('Find perfume');
    expect(output).not.toContain('Trusted Perfume');
    expect(output).not.toContain('Private model prose');
    expect(output).not.toContain('Private catalog description');
    expect(output).not.toContain('private-intent');
  });

  it('bounds and redacts explicitly enabled development verbose content', () => {
    const write = vi.fn();
    const reporter = createServerDiagnosticReporter({
      conversationId: 'conversation', turnId: 'turn',
      environment: { NODE_ENV: 'development', BAZAK_SERVER_DIAGNOSTICS: 'verbose' }, write,
    });
    reporter.request(`Find perfume token=secret-value ${'x'.repeat(800)}`, { hasClarification: false });
    reporter.result(result);

    const output = write.mock.calls.flat().join('\n');
    expect(output).toContain('token=[REDACTED]');
    expect(output).not.toContain('secret-value');
    expect(output).toContain('Trusted Perfume');
    expect(output).not.toContain('Private catalog description');
    const requestLine = write.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(requestLine.replace('bazak_server_diagnostic ', '')) as { prompt: { text: string } };
    expect(parsed.prompt.text.length).toBeLessThanOrEqual(500);
  });
});
