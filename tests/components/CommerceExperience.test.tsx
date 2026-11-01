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

  it('renders a scoped catalog-boundary explanation instead of hiding it', () => {
    const result: OrchestrationResult = {
      turnId: 'weather',
      status: 'failed',
      response: 'I focus on products in this catalog.',
      outcomes: [{
        intent: { id: 'weather:1', goal: 'Answer weather', query: 'weather', constraints: {}, status: 'failed' },
        products: [],
        error: { code: 'outside_product_catalog', message: 'Duplicate refusal', retryable: false },
      }, {
        intent: { id: 'fragrance:1', goal: 'Find fragrance', query: 'fragrance', constraints: { category: 'fragrances' }, status: 'completed' },
        products: [],
      }],
    };

    const markup = renderToStaticMarkup(<ResultBlocks result={result} actionable pending={false} retryingIntentId="" selectedClarification="" locale="en" {...callbacks} />);

    expect(markup).toContain('Answer weather');
    expect(markup).toContain('Duplicate refusal');
    expect(markup).toContain('This part is not supported');
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

  it('discloses deterministic ordering when semantic reranking falls back', () => {
    const result: OrchestrationResult = {
      turnId: 'fallback', status: 'completed', response: 'Fallback.',
      outcomes: [{
        intent: { id: 'fallback:1', goal: 'Find a phone', query: 'phone', constraints: { category: 'smartphones' }, status: 'completed' },
        products: [{
          product: { id: 1, title: 'Catalog Phone', description: 'A phone', category: 'smartphones', price: 200, tags: [], images: [] },
          score: 0.5, matchReasons: [],
        }],
        semanticStatus: 'fallback',
      }],
    };

    const markup = renderToStaticMarkup(<ResultBlocks result={result} actionable pending={false} retryingIntentId="" selectedClarification="" locale="en" {...callbacks} />);
    expect(markup).toContain('Semantic reranking was unavailable; deterministic catalog order is shown.');
    expect(markup).not.toContain('ordered by relevance and evidence tier');
  });
});
