import type { ConversationMemoryState, ProductSnapshotRecord } from '../../src/lib/persistence';
import type { OrchestrationResult } from '../../src/lib/orchestration/contracts';
import type { CatalogBoundaryCall, EvaluationStatus, EvaluationTurn, ObjectiveAssertion } from './types';

type AssertionInput = {
  turn: EvaluationTurn;
  result: OrchestrationResult;
  stateBefore?: ConversationMemoryState;
  stateAfter?: ConversationMemoryState;
  catalogCalls: CatalogBoundaryCall[];
  catalogCaptureComplete: boolean;
  snapshots: ProductSnapshotRecord[];
  persistenceRecovered: boolean;
};

const assertion = (id: string, status: EvaluationStatus, reason: string): ObjectiveAssertion => ({ id, status, reason });
const check = (id: string, pass: boolean, reason: string): ObjectiveAssertion => assertion(id, pass ? 'PASS' : 'FAIL', reason);

function rawCatalogProducts(calls: CatalogBoundaryCall[]): Map<number, Record<string, unknown>[]> {
  const products = new Map<number, Record<string, unknown>[]>();
  for (const { rawOutput } of calls) {
    const candidates = rawOutput && typeof rawOutput === 'object' && 'products' in rawOutput && Array.isArray(rawOutput.products)
      ? rawOutput.products
      : rawOutput && typeof rawOutput === 'object' && 'id' in rawOutput
        ? [rawOutput]
        : [];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'object' && typeof (candidate as { id?: unknown }).id === 'number') {
        const id = (candidate as { id: number }).id;
        products.set(id, [...(products.get(id) ?? []), candidate as Record<string, unknown>]);
      }
    }
  }
  return products;
}

function sameJson(left: unknown, right: unknown): boolean {
  const canonicalize = (value: unknown): unknown => Array.isArray(value)
    ? value.map(canonicalize)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, nested]) => [key, canonicalize(nested)]))
      : value;
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function isProductSearch(call: CatalogBoundaryCall): boolean {
  return call.pathname === '/products'
    || call.pathname === '/products/search'
    || call.pathname.startsWith('/products/category/');
}

export function evaluateObjectiveAssertions(input: AssertionInput): ObjectiveAssertion[] {
  const { expected } = input.turn;
  const products = input.result.outcomes.flatMap(({ products: ranked }) => ranked.map(({ product }) => product));
  const clarifications = input.result.outcomes.filter(({ clarification }) => clarification !== undefined);
  const completed = input.result.outcomes.filter(({ intent }) => intent.status === 'completed');
  const trustedProducts = rawCatalogProducts(input.catalogCalls);
  const priorProducts = new Map(input.stateBefore?.activeResult?.outcomes.flatMap(({ products: ranked }) =>
    ranked.map(({ product }) => [product.id, product] as const)) ?? []);
  const catalogSearches = input.catalogCalls.filter(isProductSearch);
  const returnedIds = products.map(({ id }) => id);
  const grounded = products.every((product) => {
    const trusted = trustedProducts.get(product.id) ?? [];
    return (trusted.length > 0 && trusted.some((record) => Object.entries(product).every(([key, value]) => sameJson(record[key], value))))
      || sameJson(priorProducts.get(product.id), product);
  });
  const uniqueReturnedIds = new Set(returnedIds).size === returnedIds.length;
  const conflictingCatalogIds = [...trustedProducts].filter(([, records]) => records.some((record) =>
    records.some((candidate) => !sameJson(record, candidate))));
  const tierRank = { supported: 0, partial: 1, unknown: 2 } as const;
  const exactQuotes = input.result.outcomes.flatMap(({ products: ranked }) => ranked).every(({ product, semanticRelevance }) =>
    !semanticRelevance || semanticRelevance.evidence.every(({ field, quote }) => field === 'tags'
      ? product.tags.some((tag) => tag.includes(quote))
      : product[field].includes(quote)));
  const hardFiltersHold = input.result.outcomes.every(({ intent, products: ranked }) => ranked.every(({ product }) =>
    (intent.constraints.maxPrice === undefined || product.price <= intent.constraints.maxPrice)
    && (intent.constraints.minRating === undefined || (product.rating ?? 0) >= intent.constraints.minRating)
    && (intent.constraints.inStock !== true || (product.stock ?? 0) > 0)
    && (!intent.constraints.brands || (product.brand !== undefined && intent.constraints.brands.includes(product.brand)))
    && (!intent.constraints.category || product.category === intent.constraints.category)));
  const checks: ObjectiveAssertion[] = [
    check('persisted-terminal-state', input.stateAfter?.lastTurnId === input.result.turnId, `persisted lastTurnId=${input.stateAfter?.lastTurnId ?? 'missing'}`),
    check('reopened-persistence-matches-result', input.persistenceRecovered, 'A newly opened repository must reproduce the exact terminal result and memory revision from disk.'),
    check('persisted-product-snapshots', products.every((product) => input.snapshots.some((snapshot) => snapshot.products.some((persisted) => sameJson(persisted, product)))
      || sameJson(priorProducts.get(product.id), product)), `${products.length} returned product(s) compared in full against persisted snapshots or trusted prior state`),
    input.catalogCaptureComplete
      ? check('catalog-product-grounding', grounded && conflictingCatalogIds.length === 0, `${products.length} returned product(s) compared field-by-field with actual catalog HTTP output; conflicting catalog IDs ${conflictingCatalogIds.map(([id]) => id).join(', ') || 'none'}`)
      : assertion('catalog-product-grounding', 'INCONCLUSIVE', 'Catalog response capture was incomplete; actual grounding is not asserted.'),
    check('unique-returned-product-ids', uniqueReturnedIds, `returned IDs ${returnedIds.join(', ') || 'none'}`),
    check('hard-filter-precedence', hardFiltersHold, 'Every returned product must satisfy its intent hard filters before semantic ranking.'),
  ];

  if (expected.outcomeCount?.min !== undefined) checks.push(check('minimum-outcomes', input.result.outcomes.length >= expected.outcomeCount.min, `expected >=${expected.outcomeCount.min}, actual ${input.result.outcomes.length}`));
  if (expected.outcomeCount?.max !== undefined) checks.push(check('maximum-outcomes', input.result.outcomes.length <= expected.outcomeCount.max, `expected <=${expected.outcomeCount.max}, actual ${input.result.outcomes.length}`));
  if (expected.completedOutcomeCount?.min !== undefined) {
    checks.push(check('minimum-completed-outcomes', completed.length >= expected.completedOutcomeCount.min, `expected >=${expected.completedOutcomeCount.min}, actual ${completed.length}`));
    checks.push(check('completed-outcomes-return-products', completed.length > 0 && completed.every(({ products: outcomeProducts }) => outcomeProducts.length > 0), `completed outcomes=${completed.length}; product counts=${completed.map(({ products: outcomeProducts }) => outcomeProducts.length).join(', ')}`));
  }
  if (expected.returnedProductCount) checks.push(check('minimum-returned-products', products.length >= expected.returnedProductCount.min, `expected >=${expected.returnedProductCount.min}, actual ${products.length}`));
  if (expected.comparativeAffordability) {
    const baseline = expected.comparativeAffordability.baselinePrice;
    checks.push(baseline === null
      ? check('comparative-affordability-resolution', clarifications.length > 0, 'No reliable single-product price baseline exists; comparative affordability requires an explicit clarification.')
      : check('comparative-affordability-resolution', products.length > 0 && products.every(({ price }) => price < baseline), `Every returned product must be strictly cheaper than the trusted baseline ${baseline}; actual prices ${products.map(({ price }) => price).join(', ') || 'none'}.`));
  }
  if (expected.productIdsPrefix) checks.push(check('product-id-prefix', expected.productIdsPrefix.every((id, index) => returnedIds[index] === id), `expected prefix ${expected.productIdsPrefix.join(', ')}, actual ${returnedIds.join(', ')}`));
  if (expected.productIdsExact) checks.push(check('product-ids-exact', sameJson(returnedIds, expected.productIdsExact), `expected ${expected.productIdsExact.join(', ')}, actual ${returnedIds.join(', ')}`));
  if (expected.semanticEvidence) {
    const semanticProducts = input.result.outcomes.flatMap(({ products: ranked }) => ranked);
    const complete = semanticProducts.every(({ semanticRelevance }) => semanticRelevance !== undefined);
    const fallbackOutcomes = input.result.outcomes.filter(({ semanticStatus }) => semanticStatus === 'fallback');
    checks.push(check('semantic-evidence-complete', !expected.semanticEvidence.required || complete, `${semanticProducts.filter(({ semanticRelevance }) => semanticRelevance !== undefined).length}/${semanticProducts.length} products include semantic evidence`));
    if (expected.semanticEvidence.exactQuotes) checks.push(check('semantic-evidence-exact-quotes', exactQuotes, 'Every semantic quote must be a literal span of the returned product title, description, or tags.'));
    if (expected.semanticEvidence.onlyVerified) checks.push(check('semantic-evidence-strict-only', semanticProducts.every(({ semanticRelevance }) => semanticRelevance?.tier === 'supported'), 'Strict-only results must all be supported.'));
    if (expected.semanticEvidence.fallback === 'forbidden') checks.push(check('semantic-fallback-forbidden', fallbackOutcomes.length === 0, `fallback outcomes ${fallbackOutcomes.length}`));
    if (expected.semanticEvidence.fallback === 'required') checks.push(check('semantic-fallback-required', fallbackOutcomes.length > 0, `fallback outcomes ${fallbackOutcomes.length}`));
    if (expected.semanticEvidence.ordering) {
      const ordered = input.result.outcomes.every(({ products: ranked }) => ranked.every((item, index) => {
        const previous = ranked[index - 1];
        if (!previous || !previous.semanticRelevance || !item.semanticRelevance) return true;
        const previousTier = tierRank[previous.semanticRelevance.tier];
        const tier = tierRank[item.semanticRelevance.tier];
        const semanticComparison = previousTier - tier
          || item.semanticRelevance.score - previous.semanticRelevance.score
          || item.score - previous.score
          || previous.product.id - item.product.id;
        return expected.semanticEvidence?.ordering === 'price_first'
          ? previous.product.price < item.product.price
            || (previous.product.price === item.product.price && semanticComparison <= 0)
          : semanticComparison <= 0;
      }));
      checks.push(check('semantic-ordering', ordered, `expected ${expected.semanticEvidence.ordering} ordering within each outcome`));
    }
  }
  if (expected.clarification === 'required') checks.push(check('clarification-required', clarifications.length > 0, `actual clarification count ${clarifications.length}`));
  if (expected.clarification === 'forbidden') checks.push(check('clarification-forbidden', clarifications.length === 0, `actual clarification count ${clarifications.length}`));
  if (expected.catalogSearches === 'required') checks.push(input.catalogCaptureComplete ? check('catalog-search-required', catalogSearches.length > 0, `captured product search/list calls ${catalogSearches.length}; all catalog HTTP calls ${input.catalogCalls.length}`) : assertion('catalog-search-required', 'INCONCLUSIVE', 'Catalog boundary capture was incomplete.'));
  if (expected.catalogSearches === 'forbidden') checks.push(input.catalogCaptureComplete ? check('catalog-search-forbidden', catalogSearches.length === 0, `captured product search/list calls ${catalogSearches.length}; paths=${catalogSearches.map(({ pathname }) => pathname).join(', ') || 'none'}`) : assertion('catalog-search-forbidden', 'INCONCLUSIVE', 'Catalog boundary capture was incomplete.'));
  for (const category of expected.categoriesInclude ?? []) {
    checks.push(check(`category-${category}`, input.result.outcomes.some(({ intent }) => intent.constraints.category === category), `expected category ${category}; actual ${input.result.outcomes.map(({ intent }) => intent.constraints.category ?? 'none').join(', ')}`));
  }
  if (expected.maxPriceAtMost !== undefined) {
    checks.push(check('max-price-constraint', input.result.outcomes.some(({ intent }) => intent.constraints.maxPrice !== undefined && intent.constraints.maxPrice <= expected.maxPriceAtMost!), `expected interpreted maxPrice <= ${expected.maxPriceAtMost}; actual ${input.result.outcomes.map(({ intent }) => intent.constraints.maxPrice ?? 'none').join(', ')}`));
    checks.push(check('returned-prices', products.length > 0 && products.every(({ price }) => price <= expected.maxPriceAtMost!), `expected at least one product and every price <= ${expected.maxPriceAtMost}; actual ${products.map(({ price }) => price).join(', ') || 'none'}`));
    checks.push(input.catalogCaptureComplete
      ? check('catalog-anchored-prices', products.length > 0 && products.every(({ id, price }) => trustedProducts.get(id)?.some((record) => record.price === price)), 'Every returned price must equal the actual catalog response price for that product ID.')
      : assertion('catalog-anchored-prices', 'INCONCLUSIVE', 'Catalog response capture was incomplete.'));
  }
  if (expected.preserveActiveIntentCount) checks.push(check('active-intents-preserved', (input.stateAfter?.activeResult?.outcomes.length ?? 0) >= expected.preserveActiveIntentCount.min, `expected >=${expected.preserveActiveIntentCount.min}, actual ${input.stateAfter?.activeResult?.outcomes.length ?? 0}`));
  if (expected.stateOperation) checks.push(check('state-operation', input.stateAfter?.lastOperation === expected.stateOperation, `expected ${expected.stateOperation}, actual ${input.stateAfter?.lastOperation ?? 'missing'}`));
  if (expected.selectedProductFromPreviousDisplay) {
    const priorIds = new Set(input.stateBefore?.activeResult?.outcomes.flatMap(({ products: ranked }) => ranked.map(({ product }) => product.id)) ?? []);
    checks.push(check('selected-product-from-display', products.length === 1 && priorIds.has(products[0]!.id), `expected exactly one previously displayed product; actual IDs ${products.map(({ id }) => id).join(', ')}`));
  }
  if (expected.focusCategory) {
    const focused = input.stateAfter?.activeResult?.outcomes.find(({ intent }) => intent.id === input.stateAfter?.currentFocusIntentId);
    checks.push(check('focus-category', focused?.intent.constraints.category === expected.focusCategory, `expected focus category ${expected.focusCategory}; actual ${focused?.intent.constraints.category ?? 'none'}`));
  }
  for (const category of expected.activeCategoriesExclude ?? []) {
    const activeCategories = input.stateAfter?.activeResult?.outcomes.map(({ intent }) => intent.constraints.category) ?? [];
    checks.push(check(`stale-category-excluded-${category}`, !activeCategories.includes(category), `active categories: ${activeCategories.join(', ') || 'none'}`));
  }
  return checks;
}
