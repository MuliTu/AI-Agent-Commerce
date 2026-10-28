import type { DatabaseSync } from 'node:sqlite';

type Migration = { version: number; sql: string };

export const migrations: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE turns (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed')),
        completion_fingerprint TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        UNIQUE(id, conversation_id)
      ) STRICT;

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
        created_at TEXT NOT NULL,
        FOREIGN KEY(turn_id, conversation_id) REFERENCES turns(id, conversation_id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE intents (
        id TEXT PRIMARY KEY,
        turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position >= 0),
        goal TEXT NOT NULL,
        query TEXT NOT NULL,
        constraints_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('ready', 'needs_clarification', 'completed', 'failed')),
        UNIQUE(id, turn_id),
        UNIQUE(turn_id, position)
      ) STRICT;

      CREATE TABLE tool_runs (
        id TEXT PRIMARY KEY,
        turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
        intent_id TEXT,
        tool_name TEXT NOT NULL,
        attempt INTEGER NOT NULL CHECK (attempt > 0),
        input_json TEXT NOT NULL,
        output_reference_json TEXT,
        error_code TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        UNIQUE(turn_id, tool_name, attempt, intent_id),
        FOREIGN KEY(intent_id, turn_id) REFERENCES intents(id, turn_id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE product_snapshots (
        id TEXT PRIMARY KEY,
        turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
        intent_id TEXT NOT NULL,
        products_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(intent_id, turn_id) REFERENCES intents(id, turn_id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC, id);
      CREATE INDEX idx_messages_conversation_order ON messages(conversation_id, created_at, id);
      CREATE INDEX idx_turns_conversation_order ON turns(conversation_id, created_at, id);
      CREATE INDEX idx_intents_turn_order ON intents(turn_id, position, id);
      CREATE INDEX idx_tool_runs_turn_order ON tool_runs(turn_id, started_at, attempt, id);
      CREATE INDEX idx_product_snapshots_turn ON product_snapshots(turn_id, created_at, id);
    `,
  },
] as const;

export function applyMigrations(database: DatabaseSync): void {
  const supportedVersions = migrations.map(({ version }) => version);
  const uniqueVersions = new Set(supportedVersions);
  const orderedVersions = [...supportedVersions].sort((left, right) => left - right);
  if (uniqueVersions.size !== supportedVersions.length
    || supportedVersions.some((version, index) => version !== orderedVersions[index])) {
    throw new Error('Persistence migrations must have unique, ascending versions.');
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const applied = database.prepare('SELECT version FROM schema_migrations').all()
    .map((row) => Number((row as { version: number }).version));
  const appliedVersions = new Set(applied);
  const unsupported = applied.filter((version) => !uniqueVersions.has(version));
  if (unsupported.length > 0) {
    throw new Error(`Database schema version is newer than this application supports: ${unsupported.join(', ')}.`);
  }
  const record = database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(migration.sql);
      record.run(migration.version, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}
