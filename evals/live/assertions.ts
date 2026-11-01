import type { ConversationMemoryState, ProductSnapshotRecord, ToolRunRecord } from '../../src/lib/persistence';
import type { OrchestrationResult } from '../../src/lib/orchestration/contracts';
import type { EvaluationTurn, ObjectiveAssertion } from './types';

type AssertionInput = {
  turn: EvaluationTurn;
  result: OrchestrationResult;
  stateBefore?: ConversationMemoryState;
  stateAfter?: ConversationMemoryState;
  catalogCalls: ToolRunRecord[];
  snapshots: ProductSnapshotRecord[];
};

const assertion = (id: string, pass: boolean, reason: string): ObjectiveAssertion => ({ id, pass, reason });

export function evaluateObjectiveAssertions(input: AssertionInput): ObjectiveAssertion[] {
  const { expected } = input.turn;
  const products = input.result.outcomes.flatMap(({ products: ranked }) => ranked.map(({ product }) => product));
  const clarifications = input.result.outcomes.filter(({ clarification }) => clarification !== undefined);
  const completed = input.result.outcomes.filter(({ intent }) => intent.status === 'completed');
  const checks: ObjectiveAssertion[] = [
    assertion('persisted-terminal-state', input.stateAfter?.lastTurnId === input.result.turnId, `persisted lastTurnId=${input.stateAfter?.lastTurnId ?? 'missing'}`),
    assertion('catalog-product-grounding', products.every((product) => input.snapshots.some((snapshot) => snapshot.products.some(({ id }) => id === product.id))), `${products.length} returned product(s) checked against persisted catalog snapshots`),
  ];

  if (expected.outcomeCount?.min !== undefined) checks.push(assertion('minimum-outcomes', input.result.outcomes.length >= expected.outcomeCount.min, `expected >=${expected.outcomeCount.min}, actual ${input.result.outcomes.length}`));
  if (expected.outcomeCount?.max !== undefined) checks.push(assertion('maximum-outcomes', input.result.outcomes.length <= expected.outcomeCount.max, `expected <=${expected.outcomeCount.max}, actual ${input.result.outcomes.length}`));
  if (expected.completedOutcomeCount?.min !== undefined) checks.push(assertion('minimum-completed-outcomes', completed.length >= expected.completedOutcomeCount.min, `expected >=${expected.completedOutcomeCount.min}, actual ${completed.length}`));
  if (expected.clarification === 'required') checks.push(assertion('clarification-required', clarifications.length > 0, `actual clarification count ${clarifications.length}`));
  if (expected.clarification === 'forbidden') checks.push(assertion('clarification-forbidden', clarifications.length === 0, `actual clarification count ${clarifications.length}`));
  if (expected.catalogCalls === 'required') checks.push(assertion('catalog-call-required', input.catalogCalls.length > 0, `actual persisted catalog calls ${input.catalogCalls.length}`));
  if (expected.catalogCalls === 'forbidden') checks.push(assertion('catalog-call-forbidden', input.catalogCalls.length === 0, `actual persisted catalog calls ${input.catalogCalls.length}`));
  for (const category of expected.categoriesInclude ?? []) {
    checks.push(assertion(`category-${category}`, input.result.outcomes.some(({ intent }) => intent.constraints.category === category), `expected category ${category}; actual ${input.result.outcomes.map(({ intent }) => intent.constraints.category ?? 'none').join(', ')}`));
  }
  if (expected.maxPriceAtMost !== undefined) {
    checks.push(assertion('max-price-constraint', input.result.outcomes.some(({ intent }) => intent.constraints.maxPrice !== undefined && intent.constraints.maxPrice <= expected.maxPriceAtMost!), `expected interpreted maxPrice <= ${expected.maxPriceAtMost}; actual ${input.result.outcomes.map(({ intent }) => intent.constraints.maxPrice ?? 'none').join(', ')}`));
    checks.push(assertion('returned-prices', products.every(({ price }) => price <= expected.maxPriceAtMost!), `expected every returned price <= ${expected.maxPriceAtMost}; actual ${products.map(({ price }) => price).join(', ')}`));
  }
  if (expected.preserveActiveIntentCount) checks.push(assertion('active-intents-preserved', (input.stateAfter?.activeResult?.outcomes.length ?? 0) >= expected.preserveActiveIntentCount.min, `expected >=${expected.preserveActiveIntentCount.min}, actual ${input.stateAfter?.activeResult?.outcomes.length ?? 0}`));
  if (expected.stateOperation) checks.push(assertion('state-operation', input.stateAfter?.lastOperation === expected.stateOperation, `expected ${expected.stateOperation}, actual ${input.stateAfter?.lastOperation ?? 'missing'}`));
  if (expected.selectedProductFromPreviousDisplay) {
    const priorIds = new Set(input.stateBefore?.activeResult?.outcomes.flatMap(({ products: ranked }) => ranked.map(({ product }) => product.id)) ?? []);
    checks.push(assertion('selected-product-from-display', products.length === 1 && priorIds.has(products[0]!.id), `expected exactly one previously displayed product; actual IDs ${products.map(({ id }) => id).join(', ')}`));
  }
  return checks;
}
