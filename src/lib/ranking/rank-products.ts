import { z } from 'zod';
import { productSchema, type Constraints, type Product } from '../domain/contracts';

const constraintSchema = z.object({
  maxPrice: z.number().nonnegative().optional(),
  minRating: z.number().min(0).max(5).optional(),
  category: z.string().trim().min(1).optional(),
  inStock: z.boolean().optional(),
  brands: z.array(z.string().trim().min(1)).min(1).optional(),
  requiredTags: z.array(z.string().trim().min(1)).min(1).optional(),
});

const rankingRequestSchema = z.object({
  query: z.string().default(''),
  constraints: constraintSchema.default({}),
  limit: z.number().int().positive().optional(),
});

export type RankingRequest = {
  query: string;
  constraints?: Constraints;
  limit?: number;
};

export type MatchReason = {
  field: 'title' | 'category' | 'brand' | 'tags' | 'rating' | 'price' | 'availability';
  value: string;
};

export type RankedProduct = {
  product: Product;
  score: number;
  matchReasons: MatchReason[];
};

const FIELD_WEIGHTS = {
  title: 4,
  tags: 3,
  category: 2,
  brand: 2,
  description: 1,
} as const;

const SCORE_WEIGHTS = {
  lexical: 0.9,
  rating: 0.1,
} as const;

function normalize(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase('en-US').trim();
}

function tokens(value: string): string[] {
  return [...new Set(normalize(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean))];
}

function productIsInStock(product: Product): boolean | undefined {
  if (product.stock !== undefined) return product.stock > 0;
  if (!product.availabilityStatus) return undefined;
  const availability = normalize(product.availabilityStatus);
  if (availability.includes('out of stock')) return false;
  if (availability.includes('in stock') || availability.includes('low stock')) return true;
  return undefined;
}

function equalsNormalized(left: string, right: string): boolean {
  return normalize(left) === normalize(right);
}

function satisfiesConstraints(product: Product, constraints: Constraints): boolean {
  if (constraints.maxPrice !== undefined && product.price > constraints.maxPrice) return false;
  if (constraints.minRating !== undefined &&
      (product.rating === undefined || product.rating < constraints.minRating)) return false;
  if (constraints.category && !equalsNormalized(product.category, constraints.category)) return false;
  if (constraints.inStock !== undefined && productIsInStock(product) !== constraints.inStock) return false;
  if (constraints.brands &&
      (!product.brand || !constraints.brands.some((brand) => equalsNormalized(product.brand!, brand)))) {
    return false;
  }
  if (constraints.requiredTags && !constraints.requiredTags.every((required) =>
    product.tags.some((tag) => equalsNormalized(tag, required)))) {
    return false;
  }
  return true;
}

function matchingTokens(queryTokens: string[], value: string): string[] {
  const valueTokens = new Set(tokens(value));
  return queryTokens.filter((token) => valueTokens.has(token));
}

function lexicalScore(product: Product, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const fields = [
    [product.title, FIELD_WEIGHTS.title],
    [product.tags.join(' '), FIELD_WEIGHTS.tags],
    [product.category, FIELD_WEIGHTS.category],
    [product.brand ?? '', FIELD_WEIGHTS.brand],
    [product.description, FIELD_WEIGHTS.description],
  ] as const;
  const weightedMatches = fields.reduce(
    (sum, [value, weight]) => sum + matchingTokens(queryTokens, value).length * weight,
    0,
  );
  const maximum = queryTokens.length * Object.values(FIELD_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  return weightedMatches / maximum;
}

function matchReasons(product: Product, queryTokens: string[], constraints: Constraints): MatchReason[] {
  const reasons: MatchReason[] = [];
  if (matchingTokens(queryTokens, product.title).length) {
    reasons.push({ field: 'title', value: product.title });
  }
  if (product.brand && (matchingTokens(queryTokens, product.brand).length || constraints.brands)) {
    reasons.push({ field: 'brand', value: product.brand });
  }
  const matchedTags = product.tags.filter((tag) =>
    matchingTokens(queryTokens, tag).length ||
    constraints.requiredTags?.some((required) => equalsNormalized(required, tag)));
  if (matchedTags.length) reasons.push({ field: 'tags', value: matchedTags.join(', ') });
  if (reasons.length < 3 && (matchingTokens(queryTokens, product.category).length || constraints.category)) {
    reasons.push({ field: 'category', value: product.category });
  }
  if (reasons.length < 3 && constraints.maxPrice !== undefined) {
    reasons.push({ field: 'price', value: String(product.price) });
  }
  if (reasons.length < 3 && constraints.minRating !== undefined && product.rating !== undefined) {
    reasons.push({ field: 'rating', value: String(product.rating) });
  }
  if (reasons.length < 3 && constraints.inStock !== undefined) {
    reasons.push({ field: 'availability', value: constraints.inStock ? 'in stock' : 'out of stock' });
  }
  if (reasons.length === 0) {
    reasons.push({ field: 'category', value: product.category });
    if (product.rating !== undefined) reasons.push({ field: 'rating', value: String(product.rating) });
  }
  return reasons.slice(0, 3);
}

export function rankCatalogProducts(products: unknown, request: RankingRequest): RankedProduct[] {
  const validatedProducts = z.array(productSchema).parse(products);
  const parsedRequest = rankingRequestSchema.parse(request);
  const queryTokens = tokens(parsedRequest.query);

  return validatedProducts
    .filter((product) => satisfiesConstraints(product, parsedRequest.constraints))
    .map((product) => {
      const lexical = lexicalScore(product, queryTokens);
      const rating = (product.rating ?? 0) / 5;
      return {
        product,
        score: lexical * SCORE_WEIGHTS.lexical + rating * SCORE_WEIGHTS.rating,
        matchReasons: matchReasons(product, queryTokens, parsedRequest.constraints),
      };
    })
    .sort((left, right) => right.score - left.score || left.product.id - right.product.id)
    .slice(0, parsedRequest.limit);
}
