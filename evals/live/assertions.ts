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

function rawCatalogProducts(calls: CatalogBoundaryCall[]): Map<number, Record<string, unknown>> {
  const products = new Map<number, Record<string, unknown>>();
  for (const { rawOutput } of calls) {
    const candidates = rawOutput && typeof rawOutput === 'object' && 'products' in rawOutput && Array.isArray(rawOutput.products)
      ? rawOutput.products
      : rawOutput && typeof rawOutput === 'object' && 'id' in rawOutput
        ? [rawOutput]
        : [];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'object' && typeof (candidate as { id?: unknown }).id === 'number') {
        products.set((candidate as { id: number }).id, candidate as Record<string, unknown>);
      }
    }
  }
  return products;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
  const catalogSearches = input.catalogCalls.filter(isProductSearch);
  const grounded = products.every((product) => {
    const trusted = trustedProducts.get(product.id);
    return trusted !== undefined && Object.entries(product).every(([key, value]) => sameJson(trusted[key], value));
  });
  const checks: ObjectiveAssertion[] = [
    check('persisted-terminal-state', input.stateAfter?.lastTurnId === input.result.turnId, `persisted lastTurnId=${input.stateAfter?.lastTurnId ?? 'missing'}`),
    check('reopened-persistence-matches-result', input.persistenceRecovered, 'A newly opened repository must reproduce the exact terminal result and memory revision from disk.'),
    check('persisted-product-snapshots', products.every((product) => input.snapshots.some((snapshot) => snapshot.products.some((persisted) => sameJson(persisted, product)))), `${products.length} returned product(s) compared in full against persisted snapshots`),
    input.catalogCaptureComplete
      ? check('catalog-product-grounding', grounded, `${products.length} returned product(s) compared field-by-field with actual catalog HTTP output`)
      : assertion('catalog-product-grounding', 'INCONCLUSIVE', 'Catalog response capture was incomplete; actual grounding is not asserted.'),
  ];

  if (expected.outcomeCount?.min !== undefined) checks.push(check('minimum-outcomes', input.result.outcomes.length >= expected.outcomeCount.min, `expected >=${expected.outcomeCount.min}, actual ${input.result.outcomes.length}`));
  if (expected.outcomeCount?.max !== undefined) checks.push(check('maximum-outcomes', input.result.outcomes.length <= expected.outcomeCount.max, `expected <=${expected.outcomeCount.max}, actual ${input.result.outcomes.length}`));
  if (expected.completedOutcomeCount?.min !== undefined) {
    checks.push(check('minimum-completed-outcomes', completed.length >= expected.completedOutcomeCount.min, `expected >=${expected.completedOutcomeCount.min}, actual ${completed.length}`));
    checks.push(check('completed-outcomes-return-products', completed.length > 0 && completed.every(({ products: outcomeProducts }) => outcomeProducts.length > 0), `completed outcomes=${completed.length}; product counts=${completed.map(({ products: outcomeProducts }) => outcomeProducts.length).join(', ')}`));
  }
  if (expected.returnedProductCount) checks.push(check('minimum-returned-products', products.length >= expected.returnedProductCount.min, `expected >=${expected.returnedProductCount.min}, actual ${products.length}`));
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
      ? check('catalog-anchored-prices', products.length > 0 && products.every(({ id, price }) => trustedProducts.get(id)?.price === price), 'Every returned price must equal the actual catalog response price for that product ID.')
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
