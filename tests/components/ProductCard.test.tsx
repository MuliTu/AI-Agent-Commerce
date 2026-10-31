import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProductCard } from '../../src/app/components/ProductCard';

const product = {
  id: 1,
  title: 'Satellite Phone',
  description: 'Emergency satellite SOS messaging',
  category: 'smartphones',
  price: 499,
  tags: ['mobile'],
  images: [],
};

describe('ProductCard semantic relevance', () => {
  it.each([
    ['supported', 'Verified match'],
    ['partial', 'Related, not fully verified'],
    ['unknown', 'Unverified relevance'],
  ] as const)('labels %s evidence truthfully', (tier, label) => {
    const markup = renderToStaticMarkup(<ProductCard
      product={product}
      matchReasons={[]}
      semanticRelevance={{
        tier,
        score: 0.76,
        confidence: 0.8,
        evidence: tier === 'unknown' ? [] : [{ field: 'description', quote: 'satellite SOS messaging' }],
      }}
    />);

    expect(markup).toContain(label);
    expect(markup).toContain('AI relevance');
    expect(markup).toContain('76/100');
    if (tier === 'unknown') expect(markup).toContain('No direct catalog-text proof');
    else expect(markup).toContain('satellite SOS messaging');
  });

  it('renders every trusted span used for a cross-field verified match', () => {
    const markup = renderToStaticMarkup(<ProductCard
      product={product}
      matchReasons={[]}
      semanticRelevance={{
        tier: 'supported', score: 0.98, confidence: 0.9,
        evidence: [
          { field: 'title', quote: 'Satellite Phone' },
          { field: 'description', quote: 'satellite SOS messaging' },
        ],
      }}
    />);
    expect(markup).toContain('Satellite Phone');
    expect(markup).toContain('satellite SOS messaging');
  });
});
