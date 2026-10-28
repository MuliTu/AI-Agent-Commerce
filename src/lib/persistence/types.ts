import type { Constraints, IntentStatus, TurnStatus } from '../domain/contracts';
import type { Product } from '../domain/contracts';
import type { OrchestrationResult } from '../orchestration/contracts';

export type ConversationRecord = {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
};

export type MessageRecord = {
  id: string;
  conversationId: string;
  turnId: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'pending' | 'completed' | 'failed';
  createdAt: string;
};

export type TurnRecord = {
  id: string;
  conversationId: string;
  idempotencyKey: string;
  acceptanceFingerprint?: string;
  status: TurnStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  result?: OrchestrationResult;
  failure?: {
    code: string;
    message: string;
    retryable: boolean;
  };
};

export type AcceptTurnInput = {
  conversation: ConversationRecord;
  turn: TurnRecord;
  userMessage: MessageRecord;
  acceptanceFingerprint: string;
};

export type IntentRecord = {
  id: string;
  turnId: string;
  position: number;
  goal: string;
  query: string;
  constraints: Constraints;
  status: IntentStatus;
};

export type ToolRunRecord = {
  id: string;
  turnId: string;
  intentId?: string;
  toolName: string;
  attempt: number;
  input: unknown;
  outputReference?: unknown;
  errorCode?: string;
  startedAt: string;
  completedAt?: string;
};

export type ProductSnapshotRecord = {
  id: string;
  turnId: string;
  intentId: string;
  products: Product[];
  createdAt: string;
};

export type CompleteTurnInput = {
  turnId: string;
  status: Extract<TurnStatus, 'completed' | 'partial' | 'failed'>;
  completedAt: string;
  assistantMessage?: MessageRecord;
  intents: IntentRecord[];
  toolRuns: ToolRunRecord[];
  productSnapshots: ProductSnapshotRecord[];
  result?: OrchestrationResult;
};
