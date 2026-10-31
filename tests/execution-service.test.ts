import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationExecutionService, PersistedExecutionError, type RunOrchestration } from '../src/lib/execution';
import { CommerceRepository, PersistenceConflictError } from '../src/lib/persistence';
import type { OrchestrationResult } from '../src/lib/orchestration';
import { createGetHandler, createPostHandler, POST } from '../src/app/api/orchestrate/route';
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

  it('serializes overlapping turns per conversation even when the later turn would finish first', async () => {
    const repository = new CommerceRepository(databasePath());
    const releaseFirst = deferred<void>();
    const runner = vi.fn(async (input: Parameters<RunOrchestration>[0]) => {
      if (input.turnId === 'slow-first') await releaseFirst.promise;
      return {
        turnId: input.turnId,
        status: 'completed' as const,
        response: input.turnId,
        outcomes: [{
          intent: {
            id: input.turnId, goal: input.prompt, query: input.prompt, constraints: {}, status: 'completed' as const,
          },
          products: [],
        }],
      };
    });
    const service = new ConversationExecutionService(repository, runner, () => '2026-10-28T11:00:00.000Z');

    const first = service.execute({ conversationId: 'serialized', turnId: 'slow-first', prompt: 'First' });
    const second = service.execute({ conversationId: 'serialized', turnId: 'fast-second', prompt: 'Second' });
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries(service.readConversation('serialized').turns.map(({ id, status }) => [id, status])))
      .toEqual({ 'slow-first': 'running', 'fast-second': 'queued' });

    releaseFirst.resolve();
    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { turnId: 'slow-first' }, { turnId: 'fast-second' },
    ]);
    expect(runner.mock.calls.map(([input]) => input.turnId)).toEqual(['slow-first', 'fast-second']);
    expect(repository.getConversationState('serialized')).toMatchObject({ revision: 2, lastTurnId: 'fast-second' });
    expect(service.readConversation('serialized').turns.every(({ status }) => status === 'completed')).toBe(true);
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

  it('resolves a displayed ordinal from persisted state after a service restart without calling the model', async () => {
    const path = databasePath();
    const products = [{
      product: { id: 11, title: 'First Phone', description: '', category: 'smartphones', price: 300, tags: [], images: [] },
      score: 1, matchReasons: [],
    }, {
      product: { id: 12, title: 'Second Phone', description: '', category: 'smartphones', price: 250, tags: [], images: [] },
      score: 0.9, matchReasons: [],
    }];
    const firstRunner = vi.fn(async (input: Parameters<RunOrchestration>[0]) => {
      input.observeDecision?.({ stage: 'catalog_search', intentId: 'phones', category: 'smartphones', filters: {} });
      return { turnId: input.turnId, status: 'completed' as const, response: 'Found phones.', outcomes: [{
        intent: { id: 'phones', goal: 'Find phones', query: 'phones', constraints: { category: 'smartphones' }, status: 'completed' as const },
        products,
      }] };
    });
    const firstRepository = new CommerceRepository(path);
    const firstService = new ConversationExecutionService(firstRepository, firstRunner, () => '2026-10-28T11:00:00.000Z');
    await firstService.execute({ conversationId: 'ordinal', turnId: 'turn-1', prompt: 'Find phones' });
    firstRepository.close();

    const restartedRepository = new CommerceRepository(path);
    const restartedRunner = vi.fn();
    const restartedService = new ConversationExecutionService(restartedRepository, restartedRunner, () => '2026-10-28T11:01:00.000Z');
    const selected = await restartedService.execute({
      conversationId: 'ordinal', turnId: 'turn-2', prompt: 'Show me the second one',
    });

    expect(restartedRunner).not.toHaveBeenCalled();
    expect(selected.outcomes[0].products.map(({ product }) => product.id)).toEqual([12]);
    expect(restartedRepository.getConversationState('ordinal')).toMatchObject({
      revision: 2, currentFocusIntentId: 'phones', lastOperation: 'select_product',
    });
    expect(restartedRepository.listToolRuns('turn-1')).toMatchObject([{
      toolName: 'listCategoryProducts', outputReference: { productIds: [11, 12] },
    }]);
    restartedRepository.close();
  });

  it.each<{
    prompt: string;
    expectedOutcomes: Array<{
      id: string;
      category: string;
      constraints: { category: string; sort?: 'price_asc'; maxPrice?: number };
    }>;
  }>([
    {
      prompt: 'Show me the second one and find perfume',
      expectedOutcomes: [
        { id: 'phones', category: 'smartphones', constraints: { category: 'smartphones' } },
        { id: 'perfume', category: 'fragrances', constraints: { category: 'fragrances' } },
      ],
    },
    {
      prompt: 'Make the second one cheaper',
      expectedOutcomes: [
        { id: 'phones', category: 'smartphones', constraints: { category: 'smartphones', sort: 'price_asc' } },
      ],
    },
    {
      prompt: 'Show me the second one under $200',
      expectedOutcomes: [
        { id: 'phones', category: 'smartphones', constraints: { category: 'smartphones', maxPrice: 200 } },
      ],
    },
  ])('resolves the actual displayed product and preserves compound semantics: $prompt', async ({ prompt, expectedOutcomes }) => {
    const repository = new CommerceRepository(databasePath());
    const products = [1, 2].map((id) => ({
      product: { id, title: `Phone ${id}`, description: '', category: 'smartphones', price: 300 - id, tags: [], images: [] },
      score: 1, matchReasons: [],
    }));
    const runner = vi.fn<RunOrchestration>(async (input) => {
      if (input.turnId === 'turn-1') return {
        turnId: input.turnId,
        status: 'completed' as const,
        response: 'Found phones.',
        outcomes: [{
          intent: { id: 'phones', goal: 'Phones', query: 'phones', constraints: { category: 'smartphones' }, status: 'completed' as const },
          products,
        }],
      };
      expect(input.displayedProductReference).toEqual({
        intentId: 'phones',
        position: 1,
        product: { id: 2, title: 'Phone 2', price: 298, category: 'smartphones' },
      });
      return {
        turnId: input.turnId,
        status: 'completed' as const,
        response: 'Handled complete request.',
        outcomes: expectedOutcomes.map(({ id, category, constraints }) => ({
          intent: { id, goal: category, query: category, constraints, status: 'completed' as const },
          products: id === 'phones' ? [products[1]] : [],
        })),
      };
    });
    const service = new ConversationExecutionService(repository, runner, () => '2026-10-28T11:00:00.000Z');
    await service.execute({ conversationId: prompt, turnId: 'turn-1', prompt: 'Find phones' });
    const result = await service.execute({ conversationId: prompt, turnId: 'turn-2', prompt });

    expect(runner).toHaveBeenCalledTimes(2);
    expect(result.outcomes.map(({ intent }) => ({ id: intent.id, constraints: intent.constraints })))
      .toEqual(expectedOutcomes.map(({ id, constraints }) => ({ id, constraints })));
    expect(result.outcomes.find(({ intent }) => intent.id === 'phones')?.products[0]?.product.id).toBe(2);
    repository.close();
  });

  it('keeps active siblings in canonical state while rendering only an ambiguity prompt', async () => {
    const repository = new CommerceRepository(databasePath());
    const completedIntent = (id: string, category: string) => ({
      intent: { id, goal: category, query: category, constraints: { category }, status: 'completed' as const },
      products: [],
    });
    const runner = vi.fn(async (input: { turnId: string; previous?: OrchestrationResult }) => {
      if (input.turnId === 'turn-1') return {
        turnId: input.turnId, status: 'completed' as const, response: 'Found both.',
        outcomes: [completedIntent('phones', 'smartphones'), completedIntent('scents', 'fragrances')],
      };
      if (input.turnId === 'turn-2') return {
        turnId: input.turnId, status: 'partial' as const, response: 'Which one?', outcomes: [{
          intent: { id: 'selector', goal: 'Choose', query: 'cheaper', constraints: { sort: 'price_asc' as const }, status: 'needs_clarification' as const },
          products: [],
          clarification: { field: 'category' as const, question: 'Which category?', options: ['Smartphones', 'Fragrances'], reason: 'requested' as const },
        }],
      };
      expect(input.previous?.outcomes.map(({ intent }) => intent.id)).toEqual(['phones', 'scents', 'selector']);
      return {
        turnId: input.turnId, status: 'completed' as const, response: 'Updated fragrances.',
        outcomes: [completedIntent('phones', 'smartphones'), completedIntent('scents', 'fragrances')],
      };
    });
    const service = new ConversationExecutionService(repository, runner, () => '2026-10-28T11:00:00.000Z');

    await service.execute({ conversationId: 'multi-state', turnId: 'turn-1', prompt: 'Find phones and fragrances' });
    const visibleClarification = await service.execute({ conversationId: 'multi-state', turnId: 'turn-2', prompt: 'Show cheaper options' });
    expect(visibleClarification.outcomes.map(({ intent }) => intent.id)).toEqual(['selector']);
    expect(repository.getConversationState('multi-state')?.activeResult?.outcomes.map(({ intent }) => intent.id))
      .toEqual(['phones', 'scents', 'selector']);
    await service.execute({ conversationId: 'multi-state', turnId: 'turn-3', prompt: 'Fragrances' });
    expect(repository.getConversationState('multi-state')).toMatchObject({ revision: 3, lastOperation: 'refine' });
    repository.close();
  });

  it('bounds active model context while retaining the complete turn result', async () => {
    const repository = new CommerceRepository(databasePath());
    const runner = vi.fn(async (input: { turnId: string; previous?: OrchestrationResult }) => {
      if (input.turnId === 'turn-1') return {
        turnId: input.turnId, status: 'completed' as const, response: 'Found many goals.',
        outcomes: Array.from({ length: 9 }, (_, index) => ({
          intent: { id: `intent-${index}`, goal: `Goal ${index}`, query: `query-${index}`, constraints: {}, status: 'completed' as const },
          products: [],
        })),
      };
      expect(input.previous?.outcomes).toHaveLength(8);
      expect(input.previous?.outcomes[0].intent.id).toBe('intent-1');
      return { turnId: input.turnId, status: 'completed' as const, response: 'Done.', outcomes: [input.previous!.outcomes[0]] };
    });
    const service = new ConversationExecutionService(repository, runner, () => '2026-10-28T11:00:00.000Z');

    const first = await service.execute({ conversationId: 'bounded', turnId: 'turn-1', prompt: 'Find nine things' });
    expect(first.outcomes).toHaveLength(9);
    expect(service.readConversation('bounded').turns[0].result?.outcomes).toHaveLength(9);
    expect(repository.getConversationState('bounded')?.activeResult?.outcomes).toHaveLength(8);
    await service.execute({ conversationId: 'bounded', turnId: 'turn-2', prompt: 'Continue' });
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
  it('returns safe JSON when a disposable SQLite database is corrupt during service construction', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bazak-corrupt-route-'));
    const databasePath = join(directory, 'commerce.sqlite');
    const corruptContents = 'this is not a sqlite database';
    writeFileSync(databasePath, corruptContents);
    vi.stubEnv('BAZAK_DATABASE_PATH', databasePath);
    vi.stubEnv('NODE_ENV', 'production');

    try {
      const response = await POST(new Request('http://local/api/orchestrate', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'Find a laptop', conversationId: 'corrupt-db', turnId: 'turn-corrupt-db' }),
      }));

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: 'orchestration_failed',
          message: 'The shopping turn could not be completed.',
          retryable: false,
        },
      });
      expect(readFileSync(databasePath, 'utf8')).toBe(corruptContents);
    } finally {
      vi.unstubAllEnvs();
      rmSync(directory, { recursive: true, force: true });
    }
  });

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

  it('emits correlated request and result diagnostics when explicitly enabled in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('BAZAK_SERVER_DIAGNOSTICS', 'summary');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const response = await createPostHandler({ execute: vi.fn(async () => result) })(new Request('http://local/api/orchestrate', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Show me cheaper perfume options', conversationId: 'diagnostic-conversation', turnId: 'diagnostic-turn',
        }),
      }));
      expect(response.status).toBe(200);
      const lines = info.mock.calls.map(([line]) => String(line));
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('request_received');
      expect(lines[1]).toContain('result_completed');
      const traceIds = lines.map((line) => JSON.parse(line.replace('bazak_server_diagnostic ', '')).traceId);
      expect(new Set(traceIds).size).toBe(1);
      expect(lines.join('\n')).not.toContain('Show me cheaper perfume options');
    } finally {
      info.mockRestore();
      vi.unstubAllEnvs();
    }
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
