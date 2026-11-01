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
  clarification?: 'required' | 'forbidden' | 'allowed';
  catalogCalls?: 'required' | 'forbidden' | 'allowed';
  categoriesInclude?: string[];
  maxPriceAtMost?: number;
  preserveActiveIntentCount?: { min: number };
  stateOperation?: 'add' | 'replace' | 'refine' | 'clarify' | 'select_product';
  selectedProductFromPreviousDisplay?: boolean;
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
  pass: boolean;
  reason: string;
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
  catalogCalls: ToolRunRecord[];
  returnedProducts: ProductEvidence[];
  productSnapshots: ProductSnapshotRecord[];
  response: string | null;
  result: OrchestrationResult | null;
  persistenceRecovery: {
    reopenedFromDisk: boolean;
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
    usage?: Record<string, unknown>;
  };
  status: EvaluationStatus;
  reasons: string[];
  durationMs: number;
};
