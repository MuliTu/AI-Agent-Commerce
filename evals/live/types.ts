import type { Product } from '../../src/lib/domain/contracts';
import type { OrchestrationResult } from '../../src/lib/orchestration/contracts';
import type {
  ConversationMemoryState,
  DecisionEventRecord,
  ProductSnapshotRecord,
  ToolRunRecord,
} from '../../src/lib/persistence';

export type EvaluationStatus = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export type ObjectiveExpectation = {
  outcomeCount?: { min?: number; max?: number };
  completedOutcomeCount?: { min?: number };
  returnedProductCount?: { min: number };
  clarification?: 'required' | 'forbidden' | 'allowed';
  catalogSearches?: 'required' | 'forbidden' | 'allowed';
  categoriesInclude?: string[];
  maxPriceAtMost?: number;
  preserveActiveIntentCount?: { min: number };
  stateOperation?: 'add' | 'replace' | 'refine' | 'clarify' | 'select_product';
  selectedProductFromPreviousDisplay?: boolean;
  focusCategory?: string;
  activeCategoriesExclude?: string[];
  comparativeAffordability?: {
    baselinePrice: number | null;
  };
  productIdsPrefix?: number[];
  productIdsExact?: number[];
  semanticEvidence?: {
    required: boolean;
    onlyVerified?: boolean;
    fallback?: 'allowed' | 'forbidden' | 'required';
    ordering?: 'tier_score_baseline' | 'price_first';
    exactQuotes?: boolean;
  };
};

export type EvaluationTurn = {
  id: string;
  prompt: string;
  expected: ObjectiveExpectation;
};

export type EvaluationScenario = {
  id: string;
  description: string;
  tags: string[];
  turns: EvaluationTurn[];
};

export type ObjectiveAssertion = {
  id: string;
  status: EvaluationStatus;
  reason: string;
};

export type CatalogBoundaryCall = {
  sequence: number;
  requestOccurrence: number;
  url: string;
  method: string;
  pathname: string;
  query: Record<string, string>;
  startedAt: string;
  completedAt: string;
  status: number | null;
  ok: boolean;
  rawOutput: unknown;
  returnedProducts: ProductEvidence[];
  error: string | null;
};

export type ProductEvidence = Pick<Product, 'id' | 'title' | 'price' | 'category'>;

export type TurnArtifact = {
  schemaVersion: 1;
  runId: string;
  scenarioId: string;
  scenarioDescription: string;
  turnId: string;
  input: string;
  expected: ObjectiveExpectation;
  transcript: Array<{ role: 'user' | 'assistant'; content: string }>;
  stateBefore: ConversationMemoryState | null;
  stateAfter: ConversationMemoryState | null;
  interpretation: DecisionEventRecord[];
  activeIntentIdsBefore: string[];
  activeIntentIdsAfter: string[];
  focusBefore: string | null;
  focusAfter: string | null;
  catalogCalls: CatalogBoundaryCall[];
  catalogCaptureComplete: boolean;
  catalogDecisionSummaries: ToolRunRecord[];
  returnedProducts: ProductEvidence[];
  productSnapshots: ProductSnapshotRecord[];
  response: string | null;
  result: OrchestrationResult | null;
  persistenceRecovery: {
    reopenedFromDisk: boolean;
    serviceRecreatedForTurn: boolean;
    persistedTurnStatus: string | null;
    persistedMessageCount: number;
    stateRevision: number | null;
  };
  objectiveAssertions: ObjectiveAssertion[];
  deterministicStatus: EvaluationStatus;
  judge: null | {
    status: EvaluationStatus;
    reason: string;
    criteria: Array<{ criterion: string; status: EvaluationStatus; reason: string }>;
    provider: string;
    model: string;
    executionIndependent: true;
    providerIndependent: boolean;
    modelIndependent: boolean;
    usage?: Record<string, unknown>;
  };
  status: EvaluationStatus;
  reasons: string[];
  durationMs: number;
};
