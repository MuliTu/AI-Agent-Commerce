import { AgentBoundaryError, type AgentCatalogClient } from '../../src/lib/agent';
import { productSchema, type Product } from '../../src/lib/domain/contracts';
import {
  createIntentOrchestrator,
  extractedTurnPlanSchema,
  type IntentExtractionContext,
  type OrchestrationResult,
} from '../../src/lib/orchestration';

const products = productSchema.array().parse([
  { id: 78, title: 'Apple MacBook Pro 14 Inch Space Grey', description: 'A compact professional laptop.', category: 'laptops', price: 1999.99, rating: 4.8, stock: 3, tags: ['laptops', 'apple', 'work'], brand: 'Apple', thumbnail: 'https://cdn.dummyjson.com/product-images/laptops/apple-macbook-pro-14-inch-space-grey/thumbnail.webp', availabilityStatus: 'Low Stock' },
  { id: 79, title: 'Dell Latitude 5440', description: 'A practical business laptop for everyday work.', category: 'laptops', price: 1299, rating: 4.5, stock: 12, tags: ['laptops', 'dell', 'work'], brand: 'Dell', availabilityStatus: 'In Stock' },
  { id: 108, title: 'Nike Air Jordan 1 Red And Black', description: 'Classic high-top basketball shoes.', category: 'mens-shoes', price: 149.99, rating: 4.7, stock: 5, tags: ['mens-shoes', 'basketball'], brand: 'Nike', thumbnail: 'https://cdn.dummyjson.com/product-images/mens-shoes/nike-air-jordan-1-red-and-black/thumbnail.webp', availabilityStatus: 'In Stock' },
  { id: 1, title: 'Essence Mascara Lash Princess', description: 'A trusted catalog beauty product.', category: 'beauty', price: 9.99, rating: 4.4, stock: 99, tags: ['beauty', 'mascara'], brand: 'Essence', availabilityStatus: 'In Stock' },
  { id: 121, title: 'iPhone 15 Pro', description: 'A catalog-backed smartphone.', category: 'smartphones', price: 999, rating: 4.6, stock: 8, tags: ['smartphones', 'phone'], brand: 'Apple', availabilityStatus: 'In Stock' },
  { id: 6, title: 'Calvin Klein CK One', description: 'A fresh everyday fragrance.', category: 'fragrances', price: 49.99, rating: 4.4, stock: 8, tags: ['fragrances', 'everyday'], brand: 'Calvin Klein', availabilityStatus: 'In Stock' },
]);

function plan(context: IntentExtractionContext) {
  const prompt = context.prompt.toLocaleLowerCase('en-US');
  const prior = context.previousIntents[0];
  if (prompt.includes('flight') || prompt.includes('airfare')) {
    return extractedTurnPlanSchema.parse({
      response: 'I cannot search or book travel in a product catalog.',
      intents: [{ goal: 'Search for flights', query: 'flights', constraints: { category: 'flights' }, status: 'ready' }],
    });
  }
  if (!prompt.includes('three intents') && (prompt.includes('perfume') || prompt.includes('fragrance'))) {
    return extractedTurnPlanSchema.parse({
      response: 'I started a new fragrance search.',
      intents: [{ goal: 'Find an everyday fragrance', query: 'everyday fragrance', constraints: { category: 'fragrances' }, status: 'ready' }],
    });
  }
  if (prior && /(under|below|less than|cheaper|lower price|budget)/.test(prompt)) {
    const amount = Number(prompt.match(/\$?([0-9]{2,5})/)?.[1] ?? 1500);
    return extractedTurnPlanSchema.parse({
      response: `I kept your earlier requirements and applied a $${amount} price limit.`,
      intents: [{ intentId: prior.id, constraints: { maxPrice: amount } }],
    });
  }
  if (prior) {
    const category = ['laptops', 'shoes', 'beauty'].find((value) => prompt.includes(value));
    if (category) {
      return extractedTurnPlanSchema.parse({
        response: `I kept your earlier requirements and focused the search on ${category}.`,
        intents: [{ intentId: prior.id, query: category, constraints: { category } }],
      });
    }
  }
  if (prompt.includes('three intents partial failure')) {
    return extractedTurnPlanSchema.parse({
      response: 'I kept all three shopping goals independent and isolated the unavailable search.',
      intents: [
        { goal: 'Find a work laptop under $1500', query: 'laptop', constraints: { maxPrice: 1500, minRating: 4.5 }, status: 'ready' },
        { goal: 'Find basketball shoes under $200', query: 'basketball shoes', constraints: { maxPrice: 200, minRating: 4.5 }, status: 'ready' },
        { goal: 'Unavailable catalog search under $75', query: 'unavailable-test', constraints: { maxPrice: 75 }, status: 'ready' },
      ],
    });
  }
  if (prompt.includes('three intents')) {
    return extractedTurnPlanSchema.parse({
      response: 'I separated your three shopping goals and applied each set of constraints independently.',
      intents: [
        { goal: 'Find a work laptop under $1500', query: 'laptop', constraints: { maxPrice: 1500, minRating: 4.5 }, status: 'ready' },
        { goal: 'Find basketball shoes under $200', query: 'basketball shoes', constraints: { maxPrice: 200, minRating: 4.5 }, status: 'ready' },
        { goal: 'Find an everyday fragrance under $75', query: 'everyday fragrance', constraints: { category: 'fragrances', maxPrice: 75, minRating: 4 }, status: 'ready' },
      ],
    });
  }
  if (prompt.includes('partial failure')) {
    return extractedTurnPlanSchema.parse({
      response: 'I kept the successful catalog result visible and isolated the failed search.',
      intents: [
        { goal: 'Find a work laptop', query: 'laptop', constraints: {}, status: 'ready' },
        { goal: 'Unavailable catalog search', query: 'unavailable-test', constraints: {}, status: 'ready' },
      ],
    });
  }
  if (prompt.includes('permanent retry failure')) {
    return extractedTurnPlanSchema.parse({
      response: 'I kept the successful result visible while isolating a retryable catalog failure.',
      intents: [
        { goal: 'Find a work laptop', query: 'laptop', constraints: {}, status: 'ready' },
        { goal: 'Retry a limited catalog', query: 'retry-permanent-test', constraints: {}, status: 'ready' },
      ],
    });
  }
  if (prompt.includes('empty results')) {
    return extractedTurnPlanSchema.parse({
      response: 'The trusted catalog has no matching products, so I left the result empty.',
      intents: [{ goal: 'Find a nonexistent catalog item', query: 'no-such-catalog-item', constraints: {}, status: 'ready' }],
    });
  }
  if (prompt.includes('two ambiguous')) {
    return extractedTurnPlanSchema.parse({
      response: 'I will clarify one shopping goal at a time.',
      intents: [
        { goal: 'Find a gift', query: 'gift', constraints: {}, status: 'needs_clarification' },
        { goal: 'Find a surprise item', query: 'surprise', constraints: {}, status: 'needs_clarification' },
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
    if (query === 'unavailable-test' || query === 'retry-permanent-test') {
      throw new AgentBoundaryError('catalog_unavailable', 'This catalog search is temporarily unavailable.', true);
    }
    const matches = matchingProducts(query).slice(0, limit);
    return { products: matches, total: matches.length, skip: 0, limit };
  },
  async listProductsByCategory(category, { limit = 100, skip = 0 } = {}) {
    const allMatches = products.filter((product) => product.category === category);
    const matches = allMatches.slice(skip, skip + limit);
    return { products: matches, total: allMatches.length, skip, limit };
  },
  async getProduct(id) {
    const product = products.find((item) => item.id === id);
    if (!product) throw new AgentBoundaryError('unknown_product', 'The product is not in the catalog.', false);
    return product;
  },
  async listCategories() {
    return [...new Set(products.map(({ category }) => category))].map((slug) => ({ slug, name: slug, url: `test://${slug}` }));
  },
};

export async function runTestOrchestration(input: {
  turnId: string;
  conversationId: string;
  prompt: string;
  previous?: OrchestrationResult;
  retryIntentId?: string;
  clarification?: import('../../src/lib/orchestration/contracts').ClarificationAnswer;
}): Promise<OrchestrationResult> {
  if (input.retryIntentId) await new Promise((resolve) => setTimeout(resolve, 150));
  const retryCatalog: AgentCatalogClient = input.retryIntentId ? {
    ...catalog,
    async searchProducts(request) {
      if (request.query === 'unavailable-test') {
        return { products: products.filter((product) => product.category === 'beauty'), total: 1, skip: 0, limit: request.limit ?? 20 };
      }
      if (request.query === 'retry-permanent-test') {
        throw new AgentBoundaryError('unknown_product', 'This catalog request cannot be retried safely.', false);
      }
      return catalog.searchProducts(request);
    },
  } : catalog;
  return createIntentOrchestrator({
    catalog: retryCatalog,
    extractIntents: async (context) => plan(context),
    retryOptions: { sleep: async () => undefined, random: () => 0 },
  }).run(input);
}
