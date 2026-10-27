import { parseEnvironment } from '@/lib/config/environment';
import { productSchema } from '@/lib/domain/contracts';
import { ClarificationPrompt, ConversationMessage, IntentSection, ProductGrid, RecommendationState, ToolStatus } from './components';

const products = productSchema.array().parse([
  { id: 78, title: 'Apple MacBook Pro 14 Inch Space Grey', description: 'A compact professional laptop.', category: 'laptops', price: 1999.99, rating: 4.8, stock: 3, tags: ['laptops', 'apple'], brand: 'Apple', thumbnail: 'https://cdn.dummyjson.com/product-images/laptops/apple-macbook-pro-14-inch-space-grey/thumbnail.webp', availabilityStatus: 'Low Stock' },
  { id: 108, title: 'Nike Air Jordan 1 Red And Black', description: 'Classic high-top basketball shoes.', category: 'mens-shoes', price: 149.99, rating: 4.7, stock: 0, tags: ['mens-shoes', 'basketball'], brand: 'Nike', thumbnail: 'https://cdn.dummyjson.com/product-images/mens-shoes/nike-air-jordan-1-red-and-black/thumbnail.webp', availabilityStatus: 'Out of Stock' },
]);

const reasons = new Map([[78, ['Matches the laptop category', 'Rated 4.8 out of 5']], [108, ['Matches men’s shoes', 'Basketball style']]]);

export default function HomePage() {
  parseEnvironment(process.env);
  return (
    <main id="main-content">
      <a className="skip-link" href="#recommendations">Skip to recommendations</a>
      <header className="hero"><p className="eyebrow">BAZAK / COMMERCE LAB</p><h1>Find products through conversation.</h1><p className="intro">Catalog-grounded recommendations, separated by what you are shopping for.</p></header>
      <section className="conversation" aria-labelledby="conversation-title">
        <h2 id="conversation-title">Shopping conversation</h2>
        <ConversationMessage role="user">I need a reliable laptop for work and a pair of basketball shoes.</ConversationMessage>
        <ConversationMessage role="assistant">I found catalog matches for both needs. I kept each request separate so the trade-offs stay clear.</ConversationMessage>
      </section>
      <div className="workspace" id="recommendations">
        <div className="intent-list">
          <IntentSection title="Laptop for work" summary="Professional laptop · strong customer rating" status="completed"><ProductGrid products={[products[0]]} getMatchReasons={(product) => reasons.get(product.id) ?? []} /></IntentSection>
          <IntentSection title="Basketball shoes" summary="One catalog result · availability needs attention" status="completed"><ProductGrid products={[products[1]]} getMatchReasons={(product) => reasons.get(product.id) ?? []} /></IntentSection>
          <ClarificationPrompt question="What matters most for the laptop?" options={['Lower price', 'Higher rating', 'In stock now']} />
        </div>
        <aside className="activity" aria-labelledby="activity-title">
          <h2 id="activity-title">Search activity</h2>
          <ToolStatus state="success" label="Catalog search complete" detail="2 intents searched" />
          <ToolStatus state="loading" label="Preparing alternatives" detail="Checking the same catalog" />
          <RecommendationState state="empty" title="No hidden results" description="Empty searches are shown clearly instead of being filled with invented products." />
          <RecommendationState state="failure" title="A search can fail safely" description="If one intent fails, the other results remain available." />
        </aside>
      </div>
      <footer>Bazak AI Agent Commerce · Catalog-grounded prototype</footer>
    </main>
  );
}
