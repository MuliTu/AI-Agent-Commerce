import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationExecutionService, PersistedExecutionError } from '../src/lib/execution';
import { CommerceRepository, PersistenceConflictError } from '../src/lib/persistence';
import type { OrchestrationResult } from '../src/lib/orchestration';
import { createGetHandler, createPostHandler } from '../src/app/api/orchestrate/route';
import { createConversationsGetHandler, createConversationsPatchHandler } from '../src/app/api/conversations/route';
import { AgentBoundaryError } from '../src/lib/agent';
import { toProviderAgentError } from '../src/lib/agent/errors';

const result: OrchestrationResult = {
  turnId: 'turn-1',
  status: 'completed',
  response: 'I found one validated option.',
  outcomes: [{
    intent: { id: 'intent-1', goal: 'Find a laptop', query: 'laptop', constraints: {}, status: 'completed' },
    products: [],
  }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('ConversationExecutionService', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function databasePath() {
    const directory = mkdtempSync(join(tmpdir(), 'bazak-execution-'));
    directories.push(directory);
    return join(directory, 'commerce.sqlite');
  }

  it('persists accepted work before completion and keeps running after its first caller disconnects', async () => {
    const path = databasePath();
    const repository = new CommerceRepository(path);
    const completion = deferred<OrchestrationResult>();
    const service = new ConversationExecutionService(repository, () => completion.promise, () => '2026-10-28T11:00:00.000Z');

    const execution = service.execute({
      conversationId: 'conversation-1', turnId: 'turn-1', prompt: 'Find a laptop',
    });
    expect(service.readConversation('conversation-1').turns[0].status).toBe('running');

    const secondClient = new ConversationExecutionService(new CommerceRepository(path), vi.fn());
    expect(secondClient.readConversation('conversation-1').messages[0].content).toBe('Find a laptop');

    completion.resolve(result);
    await expect(execution).resolves.toEqual(result);
    expect(secondClient.readConversation('conversation-1').turns[0]).toMatchObject({
      status: 'completed', result,
    });
    repository.close();
  });

  it('binds in-flight and completed replays to the canonical semantic acceptance fingerprint', async () => {
    const repository = new CommerceRepository(databasePath());
    const completion = deferred<OrchestrationResult>();
    const runner = vi.fn(() => completion.promise);
    let now = '2026-10-28T11:00:00.000Z';
    const service = new ConversationExecutionService(repository, runner, () => now);
    const input = { conversationId: 'conversation-1', turnId: 'turn-1', prompt: 'Find a laptop' };

    const first = service.execute(input);
    const second = service.execute(input);
    expect(() => service.execute({ ...input, prompt: 'Find shoes' })).toThrow(PersistenceConflictError);
    expect(() => service.execute({ ...input, retryIntentId: 'intent-1' })).toThrow(PersistenceConflictError);
    completion.resolve(result);
    await expect(Promise.all([first, second])).resolves.toEqual([result, result]);

    now = '2026-10-29T12:00:00.000Z';
    await expect(service.execute(input)).resolves.toEqual(result);
    expect(() => service.execute({ ...input, prompt: 'Find shoes' })).toThrow(PersistenceConflictError);
    expect(() => service.execute({ ...input, retryIntentId: 'intent-1' })).toThrow(PersistenceConflictError);
    expect(runner).toHaveBeenCalledOnce();
    repository.close();
  });

  it('marks startup leftovers failed instead of claiming server-shutdown survival', () => {
    const repository = new CommerceRepository(databasePath());
    repository.acceptTurn({
      conversation: { id: 'conversation-1', createdAt: '2026-10-28T10:00:00.000Z', updatedAt: '2026-10-28T10:00:00.000Z' },
      turn: { id: 'turn-1', conversationId: 'conversation-1', idempotencyKey: 'conversation-1:turn-1', status: 'queued', createdAt: '2026-10-28T10:00:00.000Z', updatedAt: '2026-10-28T10:00:00.000Z' },
      userMessage: { id: 'turn-1:user', conversationId: 'conversation-1', turnId: 'turn-1', role: 'user', content: 'Find a laptop', status: 'completed', createdAt: '2026-10-28T10:00:00.000Z' },
      acceptanceFingerprint: 'test-fingerprint',
    });
    repository.markTurnRunning('turn-1', '2026-10-28T10:00:01.000Z');
    const service = new ConversationExecutionService(repository, vi.fn(), () => '2026-10-28T11:00:00.000Z');

    expect(service.recoverInterruptedWork()).toBe(1);
    expect(service.readConversation('conversation-1').turns[0]).toMatchObject({
      status: 'failed',
      failure: { code: 'server_restart' },
    });
    expect(service.recoverInterruptedWork()).toBe(0);
    expect(() => repository.markTurnRunning('turn-1', '2026-10-28T11:00:01.000Z'))
      .toThrow(PersistenceConflictError);
    repository.close();
  });

  it('rejects a reused stable turn ID with different input', async () => {
    const repository = new CommerceRepository(databasePath());
    const service = new ConversationExecutionService(repository, async () => result, () => '2026-10-28T11:00:00.000Z');
    await service.execute({ conversationId: 'conversation-1', turnId: 'turn-1', prompt: 'Find a laptop' });

    expect(() => service.execute({ conversationId: 'conversation-1', turnId: 'turn-1', prompt: 'Find shoes' }))
      .toThrow(PersistenceConflictError);
    repository.close();
  });

  it('persists a clarification result as a terminal partial turn', async () => {
    const clarificationResult: OrchestrationResult = {
      turnId: 'turn-clarification',
      status: 'partial',
      response: 'I need one detail before I can recommend a product.',
      outcomes: [{
        intent: {
          id: 'intent-clarification',
          goal: 'Find a gift',
          query: 'gift',
          constraints: {},
          status: 'needs_clarification',
        },
        products: [],
        clarification: {
          field: 'category',
          question: 'Which product category should I focus on?',
          options: ['Laptops', 'Fragrances'],
          reason: 'requested',
        },
      }],
    };
    const repository = new CommerceRepository(databasePath());
    const service = new ConversationExecutionService(
      repository,
      async () => clarificationResult,
      () => '2026-10-28T11:00:00.000Z',
    );

    await expect(service.execute({
      conversationId: 'conversation-clarification',
      turnId: 'turn-clarification',
      prompt: 'Find a gift',
    })).resolves.toEqual(clarificationResult);
    expect(service.readConversation('conversation-clarification').turns[0]).toMatchObject({
      status: 'partial',
      result: clarificationResult,
    });
    repository.close();
  });
});

describe('orchestration route contracts', () => {
  it('classifies a missing conversation ID as request validation', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const response = await createGetHandler({ readConversation: vi.fn() })(new Request('http://local/api/orchestrate'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'invalid_request', message: 'A conversation ID is required.' },
      diagnostic: { stage: 'request_validation', class: 'request_validation' },
    });
    vi.unstubAllEnvs();
  });

  it('includes allowlisted diagnostics only in development responses', async () => {
    const request = () => new Request('http://local/api/orchestrate', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: '' }),
    });
    vi.stubEnv('NODE_ENV', 'development');
    const development = await createPostHandler({ execute: vi.fn() })(request());
    await expect(development.json()).resolves.toMatchObject({
      error: { code: 'invalid_request' },
      diagnostic: { stage: 'request_validation', class: 'request_validation' },
    });

    vi.stubEnv('NODE_ENV', 'production');
    const production = await createPostHandler({ execute: vi.fn() })(request());
    const body = await production.json();
    expect(body).toMatchObject({ error: { code: 'invalid_request' } });
    expect(body).not.toHaveProperty('diagnostic');
    expect(JSON.stringify(body)).not.toContain('private');
    vi.unstubAllEnvs();
  });

  it('recognizes cross-module branded provider and persisted failures', async () => {
    const brandedAgent = Object.assign(new Error('safe provider failure'), {
      [Symbol.for('bazak.agent.AgentBoundaryError')]: true,
      code: 'provider_unavailable',
      retryable: false,
    });
    const provider = await createPostHandler({ execute: vi.fn(async () => { throw brandedAgent; }) })(new Request('http://local/api/orchestrate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Find a laptop', conversationId: 'branded-provider', turnId: 'turn-provider' }),
    }));
    expect(provider.status).toBe(502);

    const brandedPersisted = Object.assign(new Error('safe persisted provider failure'), {
      [Symbol.for('bazak.execution.PersistedExecutionError')]: true,
      code: 'provider_unavailable',
      retryable: false,
    });
    const replay = await createPostHandler({ execute: vi.fn(async () => { throw brandedPersisted; }) })(new Request('http://local/api/orchestrate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Find a laptop', conversationId: 'branded-replay', turnId: 'turn-replay' }),
    }));
    expect(replay.status).toBe(502);
    await expect(replay.json()).resolves.toMatchObject({ error: { code: 'provider_unavailable', retryable: false } });
  });

  it('normalizes diagnostics carried by a cross-module branded failure', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const brandedAgent = Object.assign(new Error('safe provider failure'), {
      [Symbol.for('bazak.agent.AgentBoundaryError')]: true,
      code: 'provider_unavailable',
      retryable: false,
      diagnostic: {
        stage: 'provider_request', class: 'api_call_error', status: 400,
        code: 'invalid_json_schema', param: 'text.format.schema',
        message: 'private response', headers: { authorization: 'secret' },
      },
    });
    const response = await createPostHandler({ execute: vi.fn(async () => { throw brandedAgent; }) })(new Request('http://local/api/orchestrate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Find a laptop', conversationId: 'branded-diagnostic', turnId: 'turn-branded-diagnostic' }),
    }));
    const body = await response.json();
    expect(body.diagnostic).toEqual({
      stage: 'provider_request', class: 'api_call_error', status: 400,
      code: 'invalid_json_schema', param: 'text.format.schema',
    });
    expect(JSON.stringify(body)).not.toContain('private response');
    expect(JSON.stringify(body)).not.toContain('authorization');
    vi.unstubAllEnvs();
  });

  it('surfaces allowlisted API-call diagnostics only in development', async () => {
    const apiError = Object.assign(new Error('private provider body'), {
      [Symbol.for('vercel.ai.error.AI_APICallError')]: true,
      statusCode: 400,
      data: { error: { code: 'invalid_json_schema', param: 'text.format.schema', message: 'private response' } },
    });
    const mapped = toProviderAgentError(apiError);
    const request = () => new Request('http://local/api/orchestrate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Find a laptop', conversationId: 'diagnostic', turnId: 'turn-diagnostic' }),
    });

    vi.stubEnv('NODE_ENV', 'development');
    const development = await createPostHandler({ execute: vi.fn(async () => { throw mapped; }) })(request());
    const developmentBody = await development.json();
    expect(developmentBody).toMatchObject({
      diagnostic: { stage: 'provider_request', class: 'api_call_error', status: 400, code: 'invalid_json_schema', param: 'text.format.schema' },
    });
    expect(JSON.stringify(developmentBody)).not.toContain('private response');

    vi.stubEnv('NODE_ENV', 'production');
    const production = await createPostHandler({ execute: vi.fn(async () => { throw mapped; }) })(request());
    expect(await production.json()).not.toHaveProperty('diagnostic');
    vi.unstubAllEnvs();
  });
  it('validates POST input and delegates to the injected execution service', async () => {
    const execute = vi.fn(async () => result);
    const handler = createPostHandler({ execute });
    const response = await handler(new Request('http://local/api/orchestrate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Find a laptop', conversationId: 'conversation-1', turnId: 'turn-1' }),
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ result });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('returns a terminal clarification result instead of an execution failure', async () => {
    const clarificationResult: OrchestrationResult = {
      turnId: 'turn-clarification',
      status: 'partial',
      response: 'I need one detail before I can recommend a product.',
      outcomes: [{
        intent: {
          id: 'intent-clarification', goal: 'Find a gift', query: 'gift',
          constraints: {}, status: 'needs_clarification',
        },
        products: [],
        clarification: {
          field: 'category', question: 'Which product category should I focus on?',
          options: ['Laptops', 'Fragrances'], reason: 'requested',
        },
      }],
    };
    const response = await createPostHandler({ execute: vi.fn(async () => clarificationResult) })(new Request('http://local/api/orchestrate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Find a gift', conversationId: 'conversation-clarification', turnId: 'turn-clarification' }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ result: clarificationResult });
  });

  it('distinguishes an invalid local request from a sanitized upstream provider failure', async () => {
    const invalidHandler = createPostHandler({ execute: vi.fn() });
    const invalid = await invalidHandler(new Request('http://local/api/orchestrate', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: '' }),
    }));
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: 'invalid_request' } });

    const upstreamHandler = createPostHandler({ execute: vi.fn(async () => {
      throw new AgentBoundaryError('provider_unavailable', 'The model provider request failed.', false, new Error('private upstream body'));
    }) });
    const upstream = await upstreamHandler(new Request('http://local/api/orchestrate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Find a laptop', conversationId: 'conversation-upstream', turnId: 'turn-upstream' }),
    }));
    expect(upstream.status).toBe(502);
    await expect(upstream.json()).resolves.toEqual({
      error: { code: 'provider_unavailable', message: 'The model provider request failed.', retryable: false },
    });
  });

  it('returns 502 for a persisted nonretryable provider-unavailable failure', async () => {
    const upstreamHandler = createPostHandler({ execute: vi.fn(async () => {
      throw new PersistedExecutionError('provider_unavailable', 'The model provider request failed.', false);
    }) });
    const response = await upstreamHandler(new Request('http://local/api/orchestrate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Find a laptop', conversationId: 'conversation-replay', turnId: 'turn-replay' }),
    }));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'provider_unavailable', retryable: false } });
  });

  it('preserves a typed provider error on the first failure and an exact persisted replay', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bazak-route-error-'));
    const repository = new CommerceRepository(join(directory, 'commerce.sqlite'));
    let now = '2026-10-28T11:00:00.000Z';
    const runner = vi.fn(async () => {
      throw new AgentBoundaryError('provider_authentication', 'The model provider rejected the request.', false);
    });
    const service = new ConversationExecutionService(repository, runner, () => now);
    const handler = createPostHandler(service);
    const request = () => new Request('http://local/api/orchestrate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Find a laptop', conversationId: 'conversation-auth', turnId: 'turn-auth' }),
    });

    const first = await handler(request());
    expect(first.status).toBe(503);
    await expect(first.json()).resolves.toMatchObject({ error: { code: 'provider_authentication', retryable: false } });
    now = '2026-10-29T11:00:00.000Z';
    const replay = await handler(request());
    expect(replay.status).toBe(503);
    await expect(replay.json()).resolves.toMatchObject({ error: { code: 'provider_authentication', retryable: false } });
    expect(runner).toHaveBeenCalledOnce();
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('returns persisted state by conversation ID and a truthful not-found response', async () => {
    const state = {
      conversation: { id: 'conversation-1', createdAt: 'now', updatedAt: 'now' },
      turns: [{ id: 'turn-1', conversationId: 'conversation-1', status: 'completed' as const, createdAt: 'now', updatedAt: 'now', completedAt: 'now', result }],
      messages: [{ id: 'turn-1:user', turnId: 'turn-1', role: 'user' as const, content: 'Find a laptop', status: 'completed' as const, createdAt: 'now' }],
    };
    const handler = createGetHandler({ readConversation: () => state });
    const response = await handler(new Request('http://local/api/orchestrate?conversationId=conversation-1'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(state);
  });
});

describe('conversation management route contracts', () => {
  it('lists active conversations and validates reversible mutations', async () => {
    const conversation = { id: 'conversation-1', title: 'Laptop search', createdAt: 'now', updatedAt: 'now' };
    const service = {
      listConversations: vi.fn(() => [conversation]),
      renameConversation: vi.fn(() => ({ ...conversation, title: 'Work laptops' })),
      archiveConversation: vi.fn(() => ({ ...conversation, archivedAt: 'later' })),
      restoreConversation: vi.fn(() => conversation),
    };
    const list = await createConversationsGetHandler(service)();
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toEqual({ conversations: [conversation] });

    const patch = createConversationsPatchHandler(service);
    const renamed = await patch(new Request('http://local/api/conversations?conversationId=conversation-1', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'rename', title: 'Work laptops' }),
    }));
    expect(renamed.status).toBe(200);
    expect(service.renameConversation).toHaveBeenCalledWith('conversation-1', 'Work laptops');

    const invalid = await patch(new Request('http://local/api/conversations?conversationId=conversation-1', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'rename', title: ' ' }),
    }));
    expect(invalid.status).toBe(400);
  });
});
