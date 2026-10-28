import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyMigrations,
  CommerceRepository,
  PersistenceConflictError,
  type CompleteTurnInput,
  type ConversationRecord,
  type MessageRecord,
  type TurnRecord,
} from '../../src/lib/persistence';

const catalogProduct = {
  id: 6,
  title: 'Calvin Klein CK One',
  description: 'A validated catalog product.',
  category: 'fragrances',
  price: 49.99,
  tags: ['fragrance'],
  images: ['https://cdn.example.test/product.png'],
};

const conversation: ConversationRecord = {
  id: 'conversation-1',
  title: 'Work setup',
  createdAt: '2026-10-28T10:00:00.000Z',
  updatedAt: '2026-10-28T10:00:00.000Z',
};

const turn: TurnRecord = {
  id: 'turn-1',
  conversationId: conversation.id,
  idempotencyKey: 'conversation-1:turn-1',
  status: 'queued',
  createdAt: '2026-10-28T10:01:00.000Z',
  updatedAt: '2026-10-28T10:01:00.000Z',
};

const userMessage: MessageRecord = {
  id: 'message-user',
  conversationId: conversation.id,
  turnId: turn.id,
  role: 'user',
  content: 'Find a work laptop and basketball shoes.',
  status: 'completed',
  createdAt: '2026-10-28T10:01:01.000Z',
};

function completion(overrides: Partial<CompleteTurnInput> = {}): CompleteTurnInput {
  return {
    turnId: turn.id,
    status: 'completed',
    completedAt: '2026-10-28T10:02:00.000Z',
    assistantMessage: {
      id: 'message-assistant',
      conversationId: conversation.id,
      turnId: turn.id,
      role: 'assistant',
      content: 'I found validated catalog options for both goals.',
      status: 'completed',
      createdAt: '2026-10-28T10:02:00.000Z',
    },
    intents: [
      {
        id: 'intent-laptop',
        turnId: turn.id,
        position: 0,
        goal: 'Find a work laptop',
        query: 'work laptop',
        constraints: { maxPrice: 1500 },
        status: 'completed',
      },
      {
        id: 'intent-shoes',
        turnId: turn.id,
        position: 1,
        goal: 'Find basketball shoes',
        query: 'basketball shoes',
        constraints: {},
        status: 'completed',
      },
    ],
    toolRuns: [
      {
        id: 'tool-laptop-1',
        turnId: turn.id,
        intentId: 'intent-laptop',
        toolName: 'searchCatalog',
        attempt: 1,
        input: { query: 'work laptop', limit: 20 },
        outputReference: { snapshotId: 'snapshot-laptop' },
        startedAt: '2026-10-28T10:01:10.000Z',
        completedAt: '2026-10-28T10:01:11.000Z',
      },
    ],
    productSnapshots: [
      {
        id: 'snapshot-laptop',
        turnId: turn.id,
        intentId: 'intent-laptop',
        products: [catalogProduct],
        createdAt: '2026-10-28T10:01:11.000Z',
      },
    ],
    ...overrides,
  };
}

describe('CommerceRepository', () => {
  let directory: string;
  let databasePath: string;
  let repository: CommerceRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'bazak-persistence-'));
    databasePath = join(directory, 'commerce.sqlite');
    repository = new CommerceRepository(databasePath);
  });

  afterEach(() => {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function seedTurn(): void {
    repository.createConversation(conversation);
    repository.createTurn(turn);
    repository.appendMessage(userMessage);
  }

  it('migrates an empty database and can apply migrations again', () => {
    repository.close();
    repository = new CommerceRepository(databasePath);

    expect(repository.database.prepare('SELECT version FROM schema_migrations ORDER BY version').all())
      .toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
  });

  it('round-trips conversations, messages, turns, intents, tools, and snapshots in stable order', () => {
    seedTurn();
    repository.completeTurn(completion());

    expect(repository.getConversation(conversation.id)).toEqual({
      ...conversation,
      updatedAt: '2026-10-28T10:02:00.000Z',
    });
    expect(repository.listMessages(conversation.id).map(({ id }) => id))
      .toEqual(['message-user', 'message-assistant']);
    expect(repository.listTurns(conversation.id)).toEqual([{ ...turn,
      status: 'completed',
      updatedAt: '2026-10-28T10:02:00.000Z',
      completedAt: '2026-10-28T10:02:00.000Z',
    }]);
    expect(repository.listIntents(turn.id).map(({ id }) => id))
      .toEqual(['intent-laptop', 'intent-shoes']);
    expect(repository.listToolRuns(turn.id)).toEqual(completion().toolRuns);
    expect(repository.listProductSnapshots(turn.id)).toEqual(completion().productSnapshots);
  });

  it('orders conversations deterministically and exposes committed data to a second connection', () => {
    repository.createConversation(conversation);
    repository.createConversation({
      ...conversation,
      id: 'conversation-2',
      title: 'Newer search',
      createdAt: '2026-10-28T10:03:00.000Z',
      updatedAt: '2026-10-28T10:03:00.000Z',
    });

    const reader = new CommerceRepository(databasePath);
    try {
      expect(reader.listConversations().map(({ id }) => id))
        .toEqual(['conversation-2', 'conversation-1']);
      expect(reader.getConversation(conversation.id)).toEqual(conversation);
    } finally {
      reader.close();
    }
  });

  it('treats exact create and completion replays as idempotent', () => {
    seedTurn();
    expect(repository.createConversation(conversation)).toEqual(conversation);
    expect(repository.createTurn(turn)).toEqual(turn);
    expect(repository.appendMessage(userMessage)).toEqual(userMessage);

    repository.completeTurn(completion());
    repository.completeTurn(completion());

    expect(repository.listIntents(turn.id)).toHaveLength(2);
    expect(repository.listToolRuns(turn.id)).toHaveLength(1);
    expect(repository.listProductSnapshots(turn.id)).toHaveLength(1);
    expect(repository.listMessages(conversation.id)).toHaveLength(2);
  });

  it('rejects an idempotency key reused for a different turn', () => {
    repository.createConversation(conversation);
    repository.createTurn(turn);

    expect(() => repository.createTurn({ ...turn, id: 'turn-other' }))
      .toThrow(PersistenceConflictError);
  });

  it('rolls back a half-written completion when a later write conflicts', () => {
    seedTurn();
    repository.appendMessage({ ...completion().assistantMessage!, content: 'Existing conflicting content.' });

    expect(() => repository.completeTurn(completion())).toThrow(PersistenceConflictError);
    expect(repository.getTurn(turn.id)?.status).toBe('queued');
    expect(repository.listIntents(turn.id)).toEqual([]);
    expect(repository.listToolRuns(turn.id)).toEqual([]);
    expect(repository.listProductSnapshots(turn.id)).toEqual([]);
  });

  it('rejects secret-shaped tool payloads and rolls back the transaction', () => {
    seedTurn();
    const unsafe = completion({
      toolRuns: [{ ...completion().toolRuns[0], input: { authorization: 'Bearer should-not-persist' } }],
    });

    expect(() => repository.completeTurn(unsafe)).toThrow('must not be persisted');
    expect(repository.getTurn(turn.id)?.status).toBe('queued');
    expect(repository.listIntents(turn.id)).toEqual([]);
  });

  it('rejects nested credential aliases before writing completion state', () => {
    seedTurn();
    const unsafe = completion({
      toolRuns: [{
        ...completion().toolRuns[0],
        input: { request: { accessToken: 'should-not-persist' } },
      }],
    });

    expect(() => repository.completeTurn(unsafe)).toThrow('must not be persisted');
    expect(repository.getTurn(turn.id)?.status).toBe('queued');
    expect(repository.listIntents(turn.id)).toEqual([]);
  });

  it('rejects a conflicting replay after completion', () => {
    seedTurn();
    repository.completeTurn(completion());

    expect(() => repository.completeTurn(completion({ status: 'partial' })))
      .toThrow(PersistenceConflictError);
  });

  it('rejects messages that mix a conversation with another conversation turn', () => {
    seedTurn();
    const otherConversation = { ...conversation, id: 'conversation-2' };
    const otherTurn = {
      ...turn,
      id: 'turn-2',
      conversationId: otherConversation.id,
      idempotencyKey: 'conversation-2:turn-2',
    };
    repository.createConversation(otherConversation);
    repository.createTurn(otherTurn);

    expect(() => repository.appendMessage({
      ...userMessage,
      id: 'message-cross-conversation',
      turnId: otherTurn.id,
    })).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('rejects completion records that do not belong to the completed turn', () => {
    seedTurn();
    const cases: CompleteTurnInput[] = [
      completion({ intents: [{ ...completion().intents[0], turnId: 'turn-other' }] }),
      completion({ toolRuns: [{ ...completion().toolRuns[0], turnId: 'turn-other' }] }),
      completion({ toolRuns: [{ ...completion().toolRuns[0], intentId: 'intent-other' }] }),
      completion({ productSnapshots: [{ ...completion().productSnapshots[0], turnId: 'turn-other' }] }),
      completion({ productSnapshots: [{ ...completion().productSnapshots[0], intentId: 'intent-other' }] }),
      completion({ assistantMessage: { ...completion().assistantMessage!, conversationId: 'conversation-other' } }),
    ];

    for (const unsafe of cases) {
      expect(() => repository.completeTurn(unsafe)).toThrow(PersistenceConflictError);
      expect(repository.getTurn(turn.id)?.status).toBe('queued');
      expect(repository.listIntents(turn.id)).toEqual([]);
    }
  });

  it('rejects malformed product snapshots before persisting completion state', () => {
    seedTurn();
    const malformed = completion({
      productSnapshots: [{
        ...completion().productSnapshots[0],
        products: [{ id: 0, title: '' }] as never,
      }],
    });

    expect(() => repository.completeTurn(malformed)).toThrow();
    expect(repository.getTurn(turn.id)?.status).toBe('queued');
    expect(repository.listIntents(turn.id)).toEqual([]);
    expect(repository.listProductSnapshots(turn.id)).toEqual([]);
  });

  it.each([
    { headers: { accept: 'application/json' } },
    { 'x-api-key': 'must-not-persist' },
    { 'proxy-authorization': 'must-not-persist' },
    { cookie: 'session=must-not-persist' },
  ])('rejects credential-bearing tool metadata: %j', (input) => {
    seedTurn();
    const unsafe = completion({
      toolRuns: [{ ...completion().toolRuns[0], input }],
    });

    expect(() => repository.completeTurn(unsafe)).toThrow('must not be persisted');
    expect(repository.getTurn(turn.id)?.status).toBe('queued');
  });

  it('treats semantically equal JSON with different key order as the same replay', () => {
    seedTurn();
    const first = completion({
      intents: [{
        ...completion().intents[0],
        constraints: { maxPrice: 1500, minRating: 4 },
      }],
    });
    const replay = completion({
      intents: [{
        ...completion().intents[0],
        constraints: { minRating: 4, maxPrice: 1500 },
      }],
    });

    repository.completeTurn(first);
    expect(() => repository.completeTurn(replay)).not.toThrow();
    expect(repository.listIntents(turn.id)).toHaveLength(1);
  });

  it('fails closed when the database contains an unsupported future migration', () => {
    repository.database.prepare(
      'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
    ).run(999, '2026-10-28T12:00:00.000Z');

    expect(() => applyMigrations(repository.database))
      .toThrow('Database schema version is newer than this application supports: 999.');
  });
});
