import { AgentBoundaryError, type AgentCatalogClient } from '../agent';
import { productSchema, type Product } from '../domain/contracts';
import {
  createIntentOrchestrator,
  extractedTurnPlanSchema,
  type IntentExtractionContext,
  type OrchestrationResult,
} from '../orchestration';

const products = productSchema.array().parse([
  { id: 78, title: 'Apple MacBook Pro 14 Inch Space Grey', description: 'A compact professional laptop.', category: 'laptops', price: 1999.99, rating: 4.8, stock: 3, tags: ['laptops', 'apple', 'work'], brand: 'Apple', thumbnail: 'https://cdn.dummyjson.com/product-images/laptops/apple-macbook-pro-14-inch-space-grey/thumbnail.webp', availabilityStatus: 'Low Stock' },
  { id: 79, title: 'Dell Latitude 5440', description: 'A practical business laptop for everyday work.', category: 'laptops', price: 1299, rating: 4.5, stock: 12, tags: ['laptops', 'dell', 'work'], brand: 'Dell', availabilityStatus: 'In Stock' },
  { id: 108, title: 'Nike Air Jordan 1 Red And Black', description: 'Classic high-top basketball shoes.', category: 'mens-shoes', price: 149.99, rating: 4.7, stock: 5, tags: ['mens-shoes', 'basketball'], brand: 'Nike', thumbnail: 'https://cdn.dummyjson.com/product-images/mens-shoes/nike-air-jordan-1-red-and-black/thumbnail.webp', availabilityStatus: 'In Stock' },
  { id: 1, title: 'Essence Mascara Lash Princess', description: 'A trusted catalog beauty product.', category: 'beauty', price: 9.99, rating: 4.4, stock: 99, tags: ['beauty', 'mascara'], brand: 'Essence', availabilityStatus: 'In Stock' },
  { id: 121, title: 'iPhone 15 Pro', description: 'A catalog-backed smartphone.', category: 'smartphones', price: 999, rating: 4.6, stock: 8, tags: ['smartphones', 'phone'], brand: 'Apple', availabilityStatus: 'In Stock' },
]);

function plan(context: IntentExtractionContext) {
  const prompt = context.prompt.toLocaleLowerCase('en-US');
  const prior = context.previousIntents[0];
  if (prior && /(under|below|less than|cheaper|lower price|budget)/.test(prompt)) {
    const amount = Number(prompt.match(/\$?([0-9]{2,5})/)?.[1] ?? 1500);
    return extractedTurnPlanSchema.parse({
      response: `I kept your earlier requirements and applied a $${amount} price limit.`,
      intents: [{ intentId: prior.id, constraints: { maxPrice: amount } }],
    });
  }
  if (prompt.includes('partial failure')) {
    return extractedTurnPlanSchema.parse({
      response: 'I kept the successful catalog result visible and isolated the failed search.',
      intents: [
        { goal: 'Find a work laptop', query: 'laptop', constraints: {}, status: 'ready' },
        { goal: 'Unavailable catalog search', query: 'unavailable-demo', constraints: {}, status: 'ready' },
      ],
    });
  }
  if (prompt.includes('gift') || prompt.includes('not sure')) {
    return extractedTurnPlanSchema.parse({
      response: 'One detail will help me avoid guessing.',
      intents: [{ goal: 'Find a suitable gift', query: 'gift', constraints: {}, status: 'needs_clarification' }],
    });
  }
  if ((prompt.includes('laptop') && (prompt.includes('shoe') || prompt.includes('basketball'))) || prompt.includes('multi-intent')) {
    return extractedTurnPlanSchema.parse({
      response: 'I separated your two shopping goals so each result stays clear.',
      intents: [
        { goal: 'Find a work laptop', query: 'laptop', constraints: {}, status: 'ready' },
        { goal: 'Find basketball shoes', query: 'basketball shoes', constraints: {}, status: 'ready' },
      ],
    });
  }
  if (prompt.includes('phone') || prompt.includes('script') || prompt.includes('invent')) {
    return extractedTurnPlanSchema.parse({
      response: 'I ignored untrusted product claims and searched the catalog.',
      intents: [{ goal: 'Find a catalog phone', query: 'phone', constraints: {}, status: 'ready' }],
    });
  }
  return extractedTurnPlanSchema.parse({
    response: 'I searched the trusted catalog for one shopping goal.',
    intents: [{ goal: 'Find a catalog product', query: prompt, constraints: {}, status: 'ready' }],
  });
}

function matchingProducts(query: string): Product[] {
  const words = query.toLocaleLowerCase('en-US').split(/\s+/).filter(Boolean);
  return products.filter((product) => {
    const searchable = [product.title, product.description, product.category, product.brand ?? '', ...product.tags]
      .join(' ').toLocaleLowerCase('en-US');
    return words.some((word) => searchable.includes(word));
  });
}

const catalog: AgentCatalogClient = {
  async searchProducts({ query, limit = 20 }) {
    if (query === 'unavailable-demo') {
      throw new AgentBoundaryError('catalog_unavailable', 'This catalog search is temporarily unavailable.', true);
    }
    const matches = matchingProducts(query).slice(0, limit);
    return { products: matches, total: matches.length, skip: 0, limit };
  },
  async getProduct(id) {
    const product = products.find((item) => item.id === id);
    if (!product) throw new AgentBoundaryError('unknown_product', 'The product is not in the catalog.', false);
    return product;
  },
  async listCategories() {
    return [...new Set(products.map(({ category }) => category))].map((slug) => ({ slug, name: slug, url: `demo://${slug}` }));
  },
};

export async function runDemoOrchestration(input: {
  turnId: string;
  conversationId: string;
  prompt: string;
  previous?: OrchestrationResult;
}): Promise<OrchestrationResult> {
  return createIntentOrchestrator({ catalog, extractIntents: async (context) => plan(context) }).run(input);
}
