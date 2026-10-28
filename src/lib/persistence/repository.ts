import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { productSchema } from '../domain/contracts';
import { applyMigrations } from './migrations';
import type {
  CompleteTurnInput,
  ConversationRecord,
  IntentRecord,
  MessageRecord,
  ProductSnapshotRecord,
  ToolRunRecord,
  TurnRecord,
} from './types';

type SqlRow = Record<string, unknown>;

const sensitiveKeys = new Set([
  'apikey',
  'authorization',
  'password',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'credential',
  'credentials',
  'clientsecret',
  'cookie',
  'headers',
  'privatekey',
  'proxyauthorization',
  'setcookie',
  'xapikey',
]);

export class PersistenceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceConflictError';
  }
}

function required(value: string, field: string): string {
  if (!value.trim()) throw new TypeError(`${field} must be nonempty.`);
  return value;
}

function assertSafePayload(value: unknown, path = 'payload'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafePayload(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.replaceAll('-', '').replaceAll('_', '').toLowerCase();
    const sensitive = sensitiveKeys.has(normalizedKey)
      || normalizedKey.includes('authorization')
      || normalizedKey.endsWith('apikey')
      || normalizedKey.endsWith('accesstoken')
      || normalizedKey.endsWith('refreshtoken')
      || normalizedKey.endsWith('clientsecret')
      || normalizedKey.endsWith('privatekey')
      || normalizedKey.endsWith('password');
    if (sensitive) throw new TypeError(`${path}.${key} must not be persisted.`);
    assertSafePayload(nested, `${path}.${key}`);
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

function stableJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value));
  if (serialized === undefined) throw new TypeError('Persisted JSON values must be serializable.');
  return serialized;
}

function json(value: unknown): string {
  assertSafePayload(value);
  return stableJson(value);
}

function parseJson<T>(value: unknown): T {
  return JSON.parse(String(value)) as T;
}

function equalJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function conversationFromRow(row: SqlRow): ConversationRecord {
  return {
    id: String(row.id),
    ...(row.title === null ? {} : { title: String(row.title) }),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function messageFromRow(row: SqlRow): MessageRecord {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    turnId: String(row.turn_id),
    role: row.role as MessageRecord['role'],
    content: String(row.content),
    status: row.status as MessageRecord['status'],
    createdAt: String(row.created_at),
  };
}

function turnFromRow(row: SqlRow): TurnRecord {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    idempotencyKey: String(row.idempotency_key),
    status: row.status as TurnRecord['status'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ...(row.completed_at === null ? {} : { completedAt: String(row.completed_at) }),
  };
}

function intentFromRow(row: SqlRow): IntentRecord {
  return {
    id: String(row.id),
    turnId: String(row.turn_id),
    position: Number(row.position),
    goal: String(row.goal),
    query: String(row.query),
    constraints: parseJson<IntentRecord['constraints']>(row.constraints_json),
    status: row.status as IntentRecord['status'],
  };
}

function toolRunFromRow(row: SqlRow): ToolRunRecord {
  return {
    id: String(row.id),
    turnId: String(row.turn_id),
    ...(row.intent_id === null ? {} : { intentId: String(row.intent_id) }),
    toolName: String(row.tool_name),
    attempt: Number(row.attempt),
    input: parseJson(row.input_json),
    ...(row.output_reference_json === null ? {} : { outputReference: parseJson(row.output_reference_json) }),
    ...(row.error_code === null ? {} : { errorCode: String(row.error_code) }),
    startedAt: String(row.started_at),
    ...(row.completed_at === null ? {} : { completedAt: String(row.completed_at) }),
  };
}

function snapshotFromRow(row: SqlRow): ProductSnapshotRecord {
  return {
    id: String(row.id),
    turnId: String(row.turn_id),
    intentId: String(row.intent_id),
    products: productSchema.array().parse(parseJson(row.products_json)),
    createdAt: String(row.created_at),
  };
}

export class CommerceRepository implements Disposable {
  readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = new DatabaseSync(path, {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
    });
    this.database.exec('PRAGMA busy_timeout = 5000;');
    applyMigrations(this.database);
  }

  close(): void {
    this.database.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }

  createConversation(record: ConversationRecord): ConversationRecord {
    required(record.id, 'conversation.id');
    const existing = this.getConversation(record.id);
    if (existing) {
      if (!equalJson(existing, record)) throw new PersistenceConflictError(`Conversation ${record.id} already exists with different data.`);
      return existing;
    }
    this.database.prepare(`
      INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)
    `).run(record.id, record.title ?? null, record.createdAt, record.updatedAt);
    return record;
  }

  getConversation(id: string): ConversationRecord | undefined {
    const row = this.database.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as SqlRow | undefined;
    return row ? conversationFromRow(row) : undefined;
  }

  listConversations(): ConversationRecord[] {
    return (this.database.prepare('SELECT * FROM conversations ORDER BY updated_at DESC, id').all() as SqlRow[])
      .map(conversationFromRow);
  }

  createTurn(record: TurnRecord): TurnRecord {
    required(record.id, 'turn.id');
    required(record.conversationId, 'turn.conversationId');
    required(record.idempotencyKey, 'turn.idempotencyKey');
    const existingByKey = this.database.prepare('SELECT * FROM turns WHERE idempotency_key = ?')
      .get(record.idempotencyKey) as SqlRow | undefined;
    if (existingByKey) {
      const existing = turnFromRow(existingByKey);
      if (!equalJson(existing, record)) throw new PersistenceConflictError(`Idempotency key ${record.idempotencyKey} is already bound to a different turn.`);
      return existing;
    }
    this.database.prepare(`
      INSERT INTO turns (id, conversation_id, idempotency_key, status, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.conversationId, record.idempotencyKey, record.status,
      record.createdAt, record.updatedAt, record.completedAt ?? null);
    return record;
  }

  getTurn(id: string): TurnRecord | undefined {
    const row = this.database.prepare('SELECT * FROM turns WHERE id = ?').get(id) as SqlRow | undefined;
    return row ? turnFromRow(row) : undefined;
  }

  listTurns(conversationId: string): TurnRecord[] {
    return (this.database.prepare('SELECT * FROM turns WHERE conversation_id = ? ORDER BY created_at, id')
      .all(conversationId) as SqlRow[]).map(turnFromRow);
  }

  appendMessage(record: MessageRecord): MessageRecord {
    required(record.id, 'message.id');
    required(record.conversationId, 'message.conversationId');
    required(record.turnId, 'message.turnId');
    const row = this.database.prepare('SELECT * FROM messages WHERE id = ?').get(record.id) as SqlRow | undefined;
    if (row) {
      const existing = messageFromRow(row);
      if (!equalJson(existing, record)) throw new PersistenceConflictError(`Message ${record.id} already exists with different data.`);
      return existing;
    }
    this.database.prepare(`
      INSERT INTO messages (id, conversation_id, turn_id, role, content, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.conversationId, record.turnId, record.role, record.content, record.status, record.createdAt);
    return record;
  }

  listMessages(conversationId: string): MessageRecord[] {
    return (this.database.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, id')
      .all(conversationId) as SqlRow[]).map(messageFromRow);
  }

  listIntents(turnId: string): IntentRecord[] {
    return (this.database.prepare('SELECT * FROM intents WHERE turn_id = ? ORDER BY position, id')
      .all(turnId) as SqlRow[]).map(intentFromRow);
  }

  listToolRuns(turnId: string): ToolRunRecord[] {
    return (this.database.prepare('SELECT * FROM tool_runs WHERE turn_id = ? ORDER BY started_at, attempt, id')
      .all(turnId) as SqlRow[]).map(toolRunFromRow);
  }

  listProductSnapshots(turnId: string): ProductSnapshotRecord[] {
    return (this.database.prepare('SELECT * FROM product_snapshots WHERE turn_id = ? ORDER BY created_at, id')
      .all(turnId) as SqlRow[]).map(snapshotFromRow);
  }

  completeTurn(input: CompleteTurnInput): TurnRecord {
    required(input.turnId, 'completion.turnId');
    const digest = fingerprint(input);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const currentRow = this.database.prepare('SELECT * FROM turns WHERE id = ?').get(input.turnId) as SqlRow | undefined;
      if (!currentRow) throw new PersistenceConflictError(`Turn ${input.turnId} does not exist.`);
      const conversationId = String(currentRow.conversation_id);
      this.assertCompletionOwnership(input, conversationId);
      const currentFingerprint = currentRow.completion_fingerprint;
      if (currentFingerprint !== null) {
        if (String(currentFingerprint) !== digest) throw new PersistenceConflictError(`Turn ${input.turnId} was completed with different data.`);
        this.database.exec('COMMIT');
        return turnFromRow(currentRow);
      }

      for (const intent of input.intents) this.insertIntent(intent);
      for (const run of input.toolRuns) this.insertToolRun(run);
      for (const snapshot of input.productSnapshots) this.insertSnapshot(snapshot);
      if (input.assistantMessage) this.appendMessage(input.assistantMessage);

      this.database.prepare(`
        UPDATE turns SET status = ?, completion_fingerprint = ?, updated_at = ?, completed_at = ? WHERE id = ?
      `).run(input.status, digest, input.completedAt, input.completedAt, input.turnId);
      this.database.prepare(`
        UPDATE conversations SET updated_at = ? WHERE id = (SELECT conversation_id FROM turns WHERE id = ?)
      `).run(input.completedAt, input.turnId);
      this.database.exec('COMMIT');
      return this.getTurn(input.turnId)!;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private assertCompletionOwnership(input: CompleteTurnInput, conversationId: string): void {
    for (const intent of input.intents) {
      if (intent.turnId !== input.turnId) {
        throw new PersistenceConflictError(`Intent ${intent.id} does not belong to turn ${input.turnId}.`);
      }
    }
    const intentIds = new Set(input.intents.map(({ id }) => id));
    for (const run of input.toolRuns) {
      if (run.turnId !== input.turnId) {
        throw new PersistenceConflictError(`Tool run ${run.id} does not belong to turn ${input.turnId}.`);
      }
      if (run.intentId !== undefined && !intentIds.has(run.intentId)) {
        throw new PersistenceConflictError(`Tool run ${run.id} references an intent outside turn ${input.turnId}.`);
      }
    }
    for (const snapshot of input.productSnapshots) {
      if (snapshot.turnId !== input.turnId) {
        throw new PersistenceConflictError(`Snapshot ${snapshot.id} does not belong to turn ${input.turnId}.`);
      }
      if (!intentIds.has(snapshot.intentId)) {
        throw new PersistenceConflictError(`Snapshot ${snapshot.id} references an intent outside turn ${input.turnId}.`);
      }
    }
    if (input.assistantMessage
      && (input.assistantMessage.turnId !== input.turnId
        || input.assistantMessage.conversationId !== conversationId)) {
      throw new PersistenceConflictError(`Assistant message does not belong to turn ${input.turnId}.`);
    }
  }

  private insertIntent(record: IntentRecord): void {
    required(record.id, 'intent.id');
    required(record.turnId, 'intent.turnId');
    assertSafePayload(record.constraints, `intent.${record.id}.constraints`);
    this.database.prepare(`
      INSERT INTO intents (id, turn_id, position, goal, query, constraints_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.turnId, record.position, record.goal, record.query,
      json(record.constraints), record.status);
  }

  private insertToolRun(record: ToolRunRecord): void {
    required(record.id, 'toolRun.id');
    required(record.turnId, 'toolRun.turnId');
    required(record.toolName, 'toolRun.toolName');
    if (record.intentId !== undefined) required(record.intentId, 'toolRun.intentId');
    this.database.prepare(`
      INSERT INTO tool_runs (
        id, turn_id, intent_id, tool_name, attempt, input_json, output_reference_json,
        error_code, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.turnId, record.intentId ?? null, record.toolName, record.attempt,
      json(record.input), record.outputReference === undefined ? null : json(record.outputReference),
      record.errorCode ?? null, record.startedAt, record.completedAt ?? null);
  }

  private insertSnapshot(record: ProductSnapshotRecord): void {
    required(record.id, 'snapshot.id');
    required(record.turnId, 'snapshot.turnId');
    required(record.intentId, 'snapshot.intentId');
    const products = productSchema.array().parse(record.products);
    this.database.prepare(`
      INSERT INTO product_snapshots (id, turn_id, intent_id, products_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(record.id, record.turnId, record.intentId, json(products), record.createdAt);
  }
}
