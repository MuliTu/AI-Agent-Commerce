import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { productSchema } from '../../src/lib/domain/contracts';
import { ClarificationPrompt, ConversationMessage, IntentSection, ProductCard, ProductGrid, ProductGridSkeleton, RecommendationState, ToolStatus } from '../../src/app/components';
import { CommerceExperience } from '../../src/app/components/CommerceExperience';

const product = productSchema.parse({ id:7, title:'Trail Runner', description:'A catalog shoe', category:'footwear', price:120, rating:4.8, stock:4, tags:['trail'], brand:'Northstar', thumbnail:'https://example.com/trail.webp', availabilityStatus:'In Stock' });

describe('app-owned product UI', () => {
  it('renders trusted product facts and grounded match reasons as text', () => {
    const html = renderToStaticMarkup(<ProductGrid products={[product]} getMatchReasons={() => ['Matches trail tag']} />);
    expect(html).toContain('Trail Runner'); expect(html).toContain('$120.00'); expect(html).toContain('4.8 / 5'); expect(html).toContain('In Stock'); expect(html).toContain('Matches trail tag'); expect(html).toContain('role="list"');
  });
  it('provides an accessible stable fallback when a catalog image is absent', () => {
    const html = renderToStaticMarkup(<ProductCard product={{ ...product, thumbnail: undefined }} matchReasons={[]} />);
    expect(html).toContain('role="img"');
    expect(html).toContain('Image unavailable for Trail Runner');
  });
  it('renders an accessible non-product skeleton while catalog results are pending', () => {
    const html = renderToStaticMarkup(<ProductGridSkeleton />);
    expect(html).toContain('aria-label="Catalog results pending"');
    expect(html).toContain('No products are available yet.');
    expect(html).not.toContain('Product recommendations');
  });
  it('renders the centered Bazak welcome and composer without local-workspace chrome', () => {
    const html = renderToStaticMarkup(<CommerceExperience providerEnabled={false} />);
    expect(html.match(/Find products through conversation/g)).toHaveLength(1);
    expect(html).toContain('BAZAK COMMERCE');
    expect(html).toContain('Try smartphones, laptops, fragrances, beauty, luggage, or kitchen accessories.');
    expect(html).toContain('composer-wrap--welcome');
    expect(html).not.toContain('Local workspace');
    expect(html).not.toContain('class="profile"');
    expect(html).not.toContain('Request activity');
    expect(html).not.toContain('&gt;Requests&lt;');
    expect(html).toContain('href="#recommendations"');
    expect(html).toContain('id="recommendations"');
  });
  it('escapes model-like text instead of executing authored markup', () => {
    const html = renderToStaticMarkup(<ConversationMessage role="assistant">{'<script>unsafe()</script>'}</ConversationMessage>);
    expect(html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;'); expect(html).not.toContain('<script>');
  });
  it.each(['loading','success','empty','failure'] as const)('renders the %s state', (state) => {
    const html = renderToStaticMarkup(<RecommendationState state={state} title={`${state} title`} description="State detail" />);
    expect(html).toContain(`${state} title`); expect(html).toContain(`recommendation-state--${state}`);
  });
  it('provides live loading and alert failure semantics', () => {
    const loading = renderToStaticMarkup(<ToolStatus state="loading" label="Searching" detail="Catalog" />);
    const failure = renderToStaticMarkup(<RecommendationState state="failure" title="Failed" description="Retry" />);
    expect(loading).toContain('role="status"'); expect(loading).toContain('aria-live="polite"'); expect(failure).toContain('role="alert"');
  });
  it('uses native keyboard radio controls for clarification choices', () => {
    const html = renderToStaticMarkup(<ClarificationPrompt question="Choose" options={['Price','Rating']} />);
    expect(html.match(/type="radio"/g)).toHaveLength(2); expect(html).toContain('<fieldset'); expect(html).toContain('Clarification choices');
  });
  it('labels each intent and exposes completion state', () => {
    const html = renderToStaticMarkup(<IntentSection title="Work laptop" summary="One result" status="completed" grouped={false}><p>Content</p></IntentSection>);
    expect(html).toContain('aria-labelledby="intent-work-laptop"'); expect(html).toContain('Options for this goal');
  });
});
