import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CommerceExperience, ResultBlocks } from '../../src/app/components/CommerceExperience';
import type { OrchestrationResult } from '../../src/lib/orchestration';

describe('CommerceExperience runtime surfaces', () => {
  it('does not render demo controls or development diagnostics in production mode', () => {
    const markup = renderToStaticMarkup(
      <CommerceExperience
        providerEnabled={false}
      />,
    );

    expect(markup).not.toContain('>Demo<');
    expect(markup).not.toContain('Request activity');
    expect(markup).not.toContain('aria-label="Execution mode"');
    expect(markup).toContain('I’m not ready to search yet');
    expect(markup).toContain('Example searches');
    expect(markup).toContain('Find a smartphone');
    expect(markup).not.toContain('How results and recovery work');
  });

});

describe('CommerceExperience result copy', () => {
  const callbacks = {
    onClarification: () => undefined,
    onRetry: () => undefined,
  };

  it('does not render a second refusal below the turn summary', () => {
    const result: OrchestrationResult = {
      turnId: 'weather',
      status: 'failed',
      response: 'I focus on products in this catalog.',
      outcomes: [{
        intent: { id: 'weather:1', goal: 'Answer weather', query: 'weather', constraints: {}, status: 'failed' },
        products: [],
        error: { code: 'outside_product_catalog', message: 'Duplicate refusal', retryable: false },
      }],
    };

    const markup = renderToStaticMarkup(<ResultBlocks result={result} actionable pending={false} retryingIntentId="" selectedClarification="" locale="en" {...callbacks} />);

    expect(markup).not.toContain('Duplicate refusal');
    expect(markup).not.toContain('unsupported-goal');
  });

  it('describes a zero-match filtered search as a completed empty result', () => {
    const result: OrchestrationResult = {
      turnId: 'laptop-empty',
      status: 'completed',
      response: 'No matches.',
      outcomes: [{
        intent: { id: 'laptop:1', goal: 'Find a laptop', query: 'laptop', constraints: { category: 'laptops', maxPrice: 800 }, status: 'completed' },
        products: [],
      }],
    };

    const markup = renderToStaticMarkup(<ResultBlocks result={result} actionable pending={false} retryingIntentId="" selectedClarification="" locale="en" {...callbacks} />);

    expect(markup).toContain('No catalog products match laptops under $800');
    expect(markup).toContain('The search completed with every constraint you provided.');
    expect(markup).not.toContain('couldn’t search');
  });
});
