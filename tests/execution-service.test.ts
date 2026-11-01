import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationExecutionService, PersistedExecutionError, type RunOrchestration } from '../src/lib/execution';
import { buildConversationContext, nextConversationMemoryState } from '../src/lib/execution/conversation-context';
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
        referenceId: 'displayed:phones:1',
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

  it('focuses a changed clarification and later refines a completed sibling without reviving clarification copy', async () => {
    const repository = new CommerceRepository(databasePath());
    const completedIntent = (id: string, category: string, maxPrice: number) => ({
      intent: { id, goal: category, query: category, constraints: { category, maxPrice }, status: 'completed' as const },
      products: [],
    });
    const perfumeQuestion = {
      intent: {
        id: 'perfume', goal: 'fragrances', query: 'cheaper fragrances',
        constraints: { category: 'fragrances', maxPrice: 100, sort: 'price_asc' as const },
        status: 'needs_clarification' as const,
      },
      products: [],
      clarification: {
        field: 'maxPrice' as const, question: 'Maximum?', options: ['Under $50', 'Under $75'], reason: 'requested' as const,
      },
    };
    const runner = vi.fn(async (input: { turnId: string }) => {
      if (input.turnId === 'turn-1') return {
        turnId: input.turnId, status: 'completed' as const, response: 'Found both.',
        outcomes: [completedIntent('phones', 'smartphones', 300), completedIntent('perfume', 'fragrances', 100)],
      };
      if (input.turnId === 'turn-2') return {
        turnId: input.turnId, status: 'partial' as const, response: 'Maximum?',
        outcomes: [completedIntent('phones', 'smartphones', 300), perfumeQuestion],
      };
      return {
        turnId: input.turnId, status: 'partial' as const, response: 'Found phones.',
        outcomes: [perfumeQuestion, completedIntent('phones', 'smartphones', 250)],
      };
    });
    const service = new ConversationExecutionService(repository, runner, () => '2026-10-28T11:00:00.000Z');

    await service.execute({ conversationId: 'focus-transition', turnId: 'turn-1', prompt: 'Find both' });
    await service.execute({ conversationId: 'focus-transition', turnId: 'turn-2', prompt: 'Show me cheaper perfumes' });
    expect(repository.getConversationState('focus-transition')).toMatchObject({
      revision: 2, currentFocusIntentId: 'perfume', lastOperation: 'clarify',
    });
    await service.execute({ conversationId: 'focus-transition', turnId: 'turn-3', prompt: 'Go back to smartphones' });
    expect(repository.getConversationState('focus-transition')).toMatchObject({
      revision: 3, currentFocusIntentId: 'phones', lastOperation: 'refine',
      activeResult: { outcomes: [
        { intent: { id: 'perfume', status: 'needs_clarification' } },
        { intent: { id: 'phones', status: 'completed', constraints: { maxPrice: 250 } } },
      ] },
    });
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

  it('persists paused outcomes across repository recreation and resumes them without duplication', async () => {
    const path = databasePath();
    const phoneOutcome = {
      intent: { id: 'phones', goal: 'Phones', query: 'phones', constraints: { category: 'smartphones' }, status: 'completed' as const },
      products: [],
    };
    const fragranceOutcome = {
      intent: { id: 'fragrance', goal: 'Fragrance', query: 'fragrance', constraints: { category: 'fragrances' }, status: 'completed' as const },
      products: [],
    };
    const firstRepository = new CommerceRepository(path);
    const firstService = new ConversationExecutionService(firstRepository, async (input) => input.turnId === 'phone-turn'
      ? { turnId: input.turnId, status: 'completed', response: 'Phones.', outcomes: [phoneOutcome] }
      : {
          turnId: input.turnId, status: 'completed', response: 'Switched.', outcomes: [fragranceOutcome],
          stateActions: { pauseIntentIds: ['phones'], resumeIntentIds: [] },
        }, () => '2026-10-28T11:00:00.000Z');
    await firstService.execute({ conversationId: 'pause-resume', turnId: 'phone-turn', prompt: 'Find phones' });
    await firstService.execute({ conversationId: 'pause-resume', turnId: 'fragrance-turn', prompt: 'Pause phones and find fragrance' });
    firstRepository.close();

    const restartedRepository = new CommerceRepository(path);
    expect(restartedRepository.getConversationState('pause-resume')).toMatchObject({
      activeResult: { outcomes: [{ intent: { id: 'fragrance' } }] },
      pausedOutcomes: [{ intent: { id: 'phones' } }],
    });
    const restartedService = new ConversationExecutionService(restartedRepository, async (input) => ({
      turnId: input.turnId, status: 'completed', response: 'Resumed.', outcomes: [phoneOutcome],
      stateActions: { pauseIntentIds: [], resumeIntentIds: ['phones'] },
    }), () => '2026-10-28T11:01:00.000Z');
    await restartedService.execute({ conversationId: 'pause-resume', turnId: 'resume-turn', prompt: 'Resume the phone search' });
    expect(restartedRepository.getConversationState('pause-resume')).toMatchObject({
      activeResult: { outcomes: [{ intent: { id: 'fragrance' } }, { intent: { id: 'phones' } }] }, pausedOutcomes: [],
    });
    restartedRepository.close();
  });

  it('does not keep a paused intent active when a combined action ends in clarification', async () => {
    const path = databasePath();
    const phoneOutcome = {
      intent: { id: 'phones', goal: 'Phones', query: 'phones', constraints: { category: 'smartphones' }, status: 'completed' as const },
      products: [],
    };
    const repository = new CommerceRepository(path);
    const service = new ConversationExecutionService(repository, async (input) => input.turnId === 'initial'
      ? { turnId: input.turnId, status: 'completed', response: 'Phones.', outcomes: [phoneOutcome] }
      : {
          turnId: input.turnId,
          status: 'partial',
          response: 'What comparison price should I use?',
          outcomes: [{
            ...phoneOutcome,
            intent: { ...phoneOutcome.intent, status: 'needs_clarification' as const },
            clarification: {
              field: 'maxPrice' as const,
              question: 'What comparison price should I use?',
              options: ['Under $300', 'Under $400'],
              reason: 'requested' as const,
            },
          }],
          stateActions: { pauseIntentIds: ['phones'], resumeIntentIds: [] },
        }, () => '2026-10-28T11:00:00.000Z');

    await service.execute({ conversationId: 'pause-clarify', turnId: 'initial', prompt: 'Find phones' });
    await service.execute({ conversationId: 'pause-clarify', turnId: 'pause-and-clarify', prompt: 'Pause that and compare another request' });

    const state = repository.getConversationState('pause-clarify');
    expect(state?.activeResult?.outcomes).toEqual([]);
    expect(state?.pausedOutcomes).toEqual([phoneOutcome]);
    expect(state?.currentFocusIntentId).toBeUndefined();
    repository.close();
  });

  it('updates paused clarifications in place and resumes clarified outcomes transactionally', async () => {
    const path = databasePath();
    const phoneOutcome = {
      intent: { id: 'phones', goal: 'Phones', query: 'phones', constraints: { category: 'smartphones' }, status: 'completed' as const },
      products: [],
    };
    const fragranceOutcome = {
      intent: { id: 'fragrance', goal: 'Fragrance', query: 'fragrance', constraints: { category: 'fragrances' }, status: 'completed' as const },
      products: [],
    };
    const clarification = {
      ...phoneOutcome,
      intent: { ...phoneOutcome.intent, status: 'needs_clarification' as const },
      clarification: {
        field: 'maxPrice' as const, question: 'What comparison price should I use?',
        options: ['Under $300', 'Under $400'], reason: 'requested' as const,
      },
    };
    const repository = new CommerceRepository(path);
    const service = new ConversationExecutionService(repository, async (input) => {
      if (input.turnId === 'initial') return { turnId: input.turnId, status: 'completed' as const, response: 'Phones.', outcomes: [phoneOutcome] };
      if (input.turnId === 'switch') return {
        turnId: input.turnId, status: 'completed' as const, response: 'Fragrance.', outcomes: [fragranceOutcome],
        stateActions: { pauseIntentIds: ['phones'], resumeIntentIds: [] },
      };
      return {
        turnId: input.turnId, status: 'partial' as const, response: clarification.clarification.question,
        outcomes: [clarification],
        stateActions: { pauseIntentIds: [], resumeIntentIds: input.turnId === 'resume-clarify' ? ['phones'] : [] },
      };
    }, () => '2026-10-28T11:00:00.000Z');

    await service.execute({ conversationId: 'paused-clarification', turnId: 'initial', prompt: 'Find phones' });
    await service.execute({ conversationId: 'paused-clarification', turnId: 'switch', prompt: 'Pause phones and find fragrance' });
    await service.execute({ conversationId: 'paused-clarification', turnId: 'clarify-paused', prompt: 'Clarify the paused phone search' });
    expect(repository.getConversationState('paused-clarification')).toMatchObject({
      currentFocusIntentId: 'fragrance',
      activeResult: { outcomes: [{ intent: { id: 'fragrance' } }] },
      pausedOutcomes: [{ intent: { id: 'phones', status: 'needs_clarification' } }],
    });

    await service.execute({ conversationId: 'paused-clarification', turnId: 'resume-clarify', prompt: 'Resume and clarify phones' });
    expect(repository.getConversationState('paused-clarification')).toMatchObject({
      currentFocusIntentId: 'phones',
      activeResult: { outcomes: [{ intent: { id: 'fragrance' } }, { intent: { id: 'phones', status: 'needs_clarification' } }] },
      pausedOutcomes: [],
    });
    repository.close();
  });

  it('applies pause and resume actions without deleting unrelated active intents', () => {
    const outcome = (id: string) => ({
      intent: { id, goal: id, query: id, constraints: {}, status: 'completed' as const }, products: [],
    });
    const previous = { turnId: 'previous', status: 'completed' as const, response: 'previous', outcomes: [outcome('a'), outcome('c')] };
    const transition = (result: OrchestrationResult, pausedOutcomes = [outcome('b')]) => nextConversationMemoryState({
      conversationId: 'state-actions', turnId: result.turnId, completedAt: '2026-10-28T11:00:00.000Z',
      context: { previous, stateRevision: 1, currentFocusIntentId: 'c', pausedOutcomes }, result,
    });

    const pauseResume = transition({
      turnId: 'pause-resume', status: 'completed', response: 'updated', outcomes: [outcome('b')],
      stateActions: { pauseIntentIds: ['a'], resumeIntentIds: ['b'] },
    });
    expect(pauseResume.activeResult?.outcomes.map(({ intent }) => intent.id)).toEqual(['c', 'b']);
    expect((pauseResume.pausedOutcomes ?? []).map(({ intent }) => intent.id)).toEqual(['a']);
    expect(pauseResume.currentFocusIntentId).toBe('b');

    const pauseOnly = transition({
      turnId: 'pause-only', status: 'completed', response: 'paused', outcomes: [],
      stateActions: { pauseIntentIds: ['a'], resumeIntentIds: [] },
    });
    expect(pauseOnly.activeResult?.outcomes.map(({ intent }) => intent.id)).toEqual(['c']);

    const resumeAndSearch = transition({
      turnId: 'resume-search', status: 'completed', response: 'searched', outcomes: [outcome('d')],
      stateActions: { pauseIntentIds: [], resumeIntentIds: ['b'] },
    });
    expect(resumeAndSearch.activeResult?.outcomes.map(({ intent }) => intent.id)).toEqual(['a', 'c', 'b', 'd']);
    expect(resumeAndSearch.pausedOutcomes).toEqual([]);
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

describe('persisted display-group resolution regressions', () => {
  const ranked = (id: number, title: string, category: string) => ({
    product: { id, title, description: '', category, price: id, tags: [], images: [] },
    score: 1,
    matchReasons: [],
  });

  it('resolves a category-qualified ordinal from historical displayed order after a topic switch', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bazak-display-history-'));
    const path = join(directory, 'commerce.sqlite');
    const runner = vi.fn<RunOrchestration>(async ({ turnId, prompt }) => ({
      turnId,
      status: 'completed',
      response: 'Found results.',
      outcomes: prompt.includes('perfume') ? [{
        intent: { id: 'perfume', goal: 'Perfume', query: 'perfume', constraints: { category: 'fragrances' }, status: 'completed' },
        products: [ranked(9, 'Perfume One', 'fragrances'), ranked(10, 'Perfume Two', 'fragrances')],
      }] : [{
        intent: { id: 'phones', goal: 'Phones', query: 'phones', constraints: { category: 'smartphones' }, status: 'completed' },
        products: [ranked(120, 'Phone One', 'smartphones'), ranked(121, 'Phone Two', 'smartphones')],
      }],
    }));
    const first = new CommerceRepository(path);
    const service = new ConversationExecutionService(first, runner);
    await service.execute({ conversationId: 'history', turnId: 'one', prompt: 'Find smartphones' });
    await service.execute({ conversationId: 'history', turnId: 'two', prompt: 'Instead, show me perfume' });
    first.close();

    const reopened = new CommerceRepository(path);
    const shouldNotRun = vi.fn<RunOrchestration>();
    const restored = new ConversationExecutionService(reopened, shouldNotRun);
    const selected = await restored.execute({ conversationId: 'history', turnId: 'three', prompt: 'In smartphones, show me the second one' });
    expect(selected.outcomes.flatMap(({ products }) => products.map(({ product }) => product.id))).toEqual([121]);
    expect(shouldNotRun).not.toHaveBeenCalled();
    expect(reopened.getConversationState('history')?.selectedProducts?.map(({ product }) => product.id)).toContain(121);
    reopened.close();
    const secondReopen = new CommerceRepository(path);
    const restoredAgain = new ConversationExecutionService(secondReopen, shouldNotRun);
    const described = await restoredAgain.execute({ conversationId: 'history', turnId: 'four', prompt: 'Tell me more about that phone' });
    expect(described.outcomes[0].products[0].product.id).toBe(121);
    expect(shouldNotRun).not.toHaveBeenCalled();
    secondReopen.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('selects the same ordinal from every persisted list, or clarifies without a new search when unavailable', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bazak-multi-display-'));
    const repository = new CommerceRepository(join(directory, 'commerce.sqlite'));
    const runner = vi.fn<RunOrchestration>(async ({ turnId }) => ({
      turnId, status: 'completed', response: 'Found two lists.', outcomes: [{
        intent: { id: 'phones', goal: 'Phones', query: 'phones', constraints: { category: 'smartphones' }, status: 'completed' },
        products: [ranked(120, 'P1', 'smartphones'), ranked(121, 'P2', 'smartphones'), ranked(122, 'P3', 'smartphones'), ranked(123, 'P4', 'smartphones')],
      }, {
        intent: { id: 'perfume', goal: 'Perfume', query: 'perfume', constraints: { category: 'fragrances' }, status: 'completed' },
        products: [ranked(9, 'F1', 'fragrances'), ranked(10, 'F2', 'fragrances')],
      }],
    }));
    const service = new ConversationExecutionService(repository, runner);
    await service.execute({ conversationId: 'both', turnId: 'one', prompt: 'Find phones and perfume' });
    const seconds = await service.execute({ conversationId: 'both', turnId: 'two', prompt: 'Show the second product from both lists' });
    expect(seconds.outcomes.flatMap(({ products }) => products.map(({ product }) => product.id))).toEqual([121, 10]);
    const repeated = await service.execute({ conversationId: 'both', turnId: 'three', prompt: 'Show the second product from both lists' });
    expect(repeated.outcomes.flatMap(({ products }) => products.map(({ product }) => product.id))).toEqual([121, 10]);
    const fourths = await service.execute({ conversationId: 'both', turnId: 'four', prompt: 'Show the fourth product from both lists' });
    expect(fourths.status).toBe('partial');
    expect(fourths.outcomes[0].clarification?.options).toHaveLength(2);
    expect(fourths.outcomes[0].clarification?.question).toContain('do not have that position');
    const available = await service.execute({
      conversationId: 'both', turnId: 'five', prompt: 'Use the lists that have this item',
      clarification: { intentId: 'clarify:four', field: 'query', value: 'Use the lists that have this item' },
    });
    expect(available.outcomes.flatMap(({ products }) => products.map(({ product }) => product.id))).toEqual([123]);
    expect(runner).toHaveBeenCalledOnce();
    expect(repository.listToolRuns('five')).toEqual([]);
    const activeBeforeDismiss = repository.getConversationState('both')?.activeResult;
    await service.execute({ conversationId: 'both', turnId: 'six', prompt: 'Show the fourth product from both lists' });
    const dismissed = await service.execute({
      conversationId: 'both', turnId: 'seven', prompt: 'Keep the current displayed results',
      clarification: { intentId: 'clarify:six', field: 'query', value: 'Keep the current displayed results' },
    });
    expect(dismissed.response).toContain('unchanged');
    expect(repository.getConversationState('both')?.activeResult).toEqual(activeBeforeDismiss);
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('does not intercept unrelated anaphora and rejects stale selected-product state', () => {
    const product = ranked(121, 'Phone Two', 'smartphones').product;
    const displayed: OrchestrationResult = { turnId: 'one', status: 'completed', response: 'Phones', outcomes: [{
      intent: { id: 'phones', goal: 'Phones', query: 'phones', constraints: { category: 'smartphones' }, status: 'completed' },
      products: [ranked(120, 'Phone One', 'smartphones'), { product, score: 1, matchReasons: [] }],
    }] };
    const state = { conversationId: 'c', revision: 2, activeResult: displayed, lastOperation: 'select_product' as const, lastTurnId: 'two', updatedAt: 'now', selectedProducts: [{ intentId: 'phones', position: 1, product, selectedAtTurnId: 'two' }] };
    expect(buildConversationContext({ prompt: 'Find phones like that', persistedState: state, latestCompletedResult: displayed, completedResults: [displayed] }).displayedProductReference).toBeUndefined();
    const corrupt = { ...state, selectedProducts: [{ ...state.selectedProducts[0], product: { ...product, price: 999 } }] };
    expect(buildConversationContext({ prompt: 'Tell me more about that phone', persistedState: corrupt, latestCompletedResult: displayed, completedResults: [displayed] }).displayedProductReference).toBeUndefined();
  });

  it('keeps the active products and focus after a non-mutating unsupported refinement', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bazak-non-mutating-failure-'));
    const repository = new CommerceRepository(join(directory, 'commerce.sqlite'));
    const runner = vi.fn<RunOrchestration>(async ({ turnId }) => turnId === 'one' ? {
      turnId, status: 'completed', response: 'Phones.', outcomes: [{
        intent: { id: 'phones', goal: 'Phones under $500', query: 'phones', constraints: { category: 'smartphones', maxPrice: 500 }, status: 'completed' },
        products: [ranked(1, 'Phone', 'smartphones')],
      }],
    } : {
      turnId, status: 'failed', response: 'Brand exclusion is not supported.', outcomes: [{
        intent: { id: `${turnId}:constraint`, goal: 'Exclude Apple', query: 'not Apple', constraints: {}, status: 'failed' },
        products: [], error: { code: 'unsupported_constraint', message: 'Brand exclusion is not supported.', retryable: false },
      }],
    });
    const service = new ConversationExecutionService(repository, runner);
    await service.execute({ conversationId: 'focus', turnId: 'one', prompt: 'Show phones under $500' });
    const before = repository.getConversationState('focus');
    await service.execute({ conversationId: 'focus', turnId: 'two', prompt: 'Keep the budget but exclude Apple' });
    const after = repository.getConversationState('focus');
    expect(after?.activeResult).toEqual(before?.activeResult);
    expect(after?.currentFocusIntentId).toBe('phones');
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('clarifies duplicate category groups and includes distinct historical lists in an explicit both reference', () => {
    const outcome = (id: string, category: string, productId: number) => ({
      intent: { id, goal: id, query: id, constraints: { category }, status: 'completed' as const },
      products: [ranked(productId, id, category), ranked(productId + 1, `${id} two`, category)],
    });
    const current: OrchestrationResult = { turnId: 'two', status: 'completed', response: 'Current', outcomes: [outcome('phone-a', 'smartphones', 1), outcome('phone-b', 'smartphones', 10)] };
    const duplicateState = { conversationId: 'c', revision: 2, activeResult: current, lastOperation: 'add' as const, lastTurnId: 'two', updatedAt: 'now' };
    const duplicate = buildConversationContext({ prompt: 'In smartphones, show the second one', persistedState: duplicateState, latestCompletedResult: current, completedResults: [current] });
    expect(duplicate.displayedProductReference).toBeUndefined();
    expect(duplicate.ordinalResolutionIssue?.reason).toBe('ambiguous_group');

    const old: OrchestrationResult = { turnId: 'one', status: 'completed', response: 'Old', outcomes: [outcome('perfume', 'fragrances', 20)] };
    const oneActive = { ...duplicateState, activeResult: { turnId: 'three', status: 'completed' as const, response: 'Phone', outcomes: [outcome('phone-a', 'smartphones', 1)] } };
    const both = buildConversationContext({ prompt: 'Show the second one from both lists', persistedState: oneActive, latestCompletedResult: oneActive.activeResult, completedResults: [old, oneActive.activeResult] });
    expect(both.displayedProductSelection?.groups.map(({ product }) => product.id)).toEqual([21, 2]);
    expect(both.ordinalResolutionIssue).toBeUndefined();
  });

  it('persists and resolves a duplicate-list ordinal clarification without calling the model or catalog again', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bazak-ordinal-choice-'));
    const path = join(directory, 'commerce.sqlite');
    const initialRunner = vi.fn<RunOrchestration>(async ({ turnId }) => ({
      turnId, status: 'completed', response: 'Two phone lists.', outcomes: [
        { intent: { id: 'budget-300', goal: 'Phones under $300', query: 'phones', constraints: { category: 'smartphones', maxPrice: 300 }, status: 'completed' }, products: [ranked(1, 'A', 'smartphones'), ranked(2, 'B', 'smartphones')] },
        { intent: { id: 'budget-700', goal: 'Phones under $700', query: 'phones', constraints: { category: 'smartphones', maxPrice: 700 }, status: 'completed' }, products: [ranked(10, 'C', 'smartphones'), ranked(11, 'D', 'smartphones')] },
      ],
    }));
    const repository = new CommerceRepository(path);
    const service = new ConversationExecutionService(repository, initialRunner);
    await service.execute({ conversationId: 'duplicate-lists', turnId: 'one', prompt: 'Give me phone lists under $300 and $700' });
    const clarification = await service.execute({ conversationId: 'duplicate-lists', turnId: 'two', prompt: 'In smartphones, show the second one' });
    expect(clarification.outcomes[0].clarification?.options).toEqual(expect.arrayContaining([
      expect.stringContaining('under $300'), expect.stringContaining('under $700'),
    ]));
    const selectedLabel = clarification.outcomes[0].clarification!.options.find((option) => option.includes('under $700'))!;
    repository.close();

    const reopened = new CommerceRepository(path);
    const shouldNotRun = vi.fn<RunOrchestration>();
    const restored = new ConversationExecutionService(reopened, shouldNotRun);
    const selection = await restored.execute({
      conversationId: 'duplicate-lists', turnId: 'three', prompt: selectedLabel,
      clarification: { intentId: 'clarify:two', field: 'query', value: selectedLabel },
    });
    expect(selection.outcomes.flatMap(({ products }) => products.map(({ product }) => product.id))).toEqual([11]);
    expect(shouldNotRun).not.toHaveBeenCalled();
    expect(reopened.listToolRuns('three')).toEqual([]);
    expect(reopened.getConversationState('duplicate-lists')?.selectedProducts?.at(-1)).toMatchObject({ intentId: 'budget-700', position: 1, product: { id: 11 } });
    expect(reopened.getConversationState('duplicate-lists')?.activeResult?.stateActions?.pendingDisplayedSelection).toBeUndefined();
    const described = await restored.execute({ conversationId: 'duplicate-lists', turnId: 'four', prompt: 'Tell me about that selected product' });
    expect(described.outcomes[0].products[0].product.id).toBe(11);
    expect(shouldNotRun).not.toHaveBeenCalled();
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('resolves the exact six-turn topic-switch sequence from persisted display history without another search', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bazak-six-turn-history-'));
    const repository = new CommerceRepository(join(directory, 'commerce.sqlite'));
    const runner = vi.fn<RunOrchestration>(async ({ turnId }) => {
      if (turnId === 'one') return {
        turnId, status: 'completed', response: 'Phones under $300.', outcomes: [{
          intent: { id: 'phones', goal: 'Phones', query: 'phones', constraints: { category: 'smartphones', maxPrice: 300 }, status: 'completed' },
          products: [ranked(120, 'Phone One', 'smartphones'), ranked(121, 'Phone Two', 'smartphones'), ranked(122, 'Phone Three', 'smartphones')],
        }],
      };
      if (turnId === 'two') return {
        turnId, status: 'partial', response: 'What price should I use?', outcomes: [{
          intent: { id: 'phones', goal: 'Phones', query: 'phones', constraints: { category: 'smartphones', maxPrice: 300 }, status: 'needs_clarification' },
          products: [], clarification: { field: 'maxPrice', reason: 'requested', question: 'What maximum price?', options: ['$200', '$250'] },
        }],
      };
      if (turnId === 'three') return {
        turnId, status: 'completed', response: 'Phones under $200.', outcomes: [{
          intent: { id: 'phones', goal: 'Phones', query: 'phones', constraints: { category: 'smartphones', maxPrice: 200 }, status: 'completed' },
          products: [ranked(128, 'Realme C35', 'smartphones'), ranked(121, 'iPhone 5s', 'smartphones')],
        }],
      };
      if (turnId === 'four') return {
        turnId, status: 'completed', response: 'Perfumes under $100.', outcomes: [{
          intent: { id: 'perfume', goal: 'Perfume', query: 'perfume', constraints: { category: 'fragrances', maxPrice: 100 }, status: 'completed' },
          products: [ranked(6, 'CK One', 'fragrances'), ranked(9, 'Dolce Shine', 'fragrances'), ranked(8, 'Dior J’adore', 'fragrances'), ranked(10, 'Gucci Bloom', 'fragrances')],
        }],
      };
      throw new Error(`Unexpected orchestration for ${turnId}`);
    });
    const service = new ConversationExecutionService(repository, runner);
    await service.execute({ conversationId: 'manual-sequence', turnId: 'one', prompt: 'Find smartphones under $300' });
    await service.execute({ conversationId: 'manual-sequence', turnId: 'two', prompt: 'Show me cheaper options' });
    await service.execute({ conversationId: 'manual-sequence', turnId: 'three', prompt: 'Under $200' });
    await service.execute({ conversationId: 'manual-sequence', turnId: 'four', prompt: 'Instead, show me a perfume under $100' });
    const phone = await service.execute({ conversationId: 'manual-sequence', turnId: 'five', prompt: 'In smartphones, tell me about the second one' });
    expect(phone.outcomes.flatMap(({ products }) => products.map(({ product }) => product.id))).toEqual([121]);
    const stateBeforeBoth = repository.getConversationState('manual-sequence');
    const both = await service.execute({ conversationId: 'manual-sequence', turnId: 'six', prompt: 'Show me the second product from each list' });
    expect(both.outcomes.flatMap(({ products }) => products.map(({ product }) => product.id))).toEqual([121, 9]);
    expect(runner).toHaveBeenCalledTimes(4);
    expect(repository.listToolRuns('six')).toEqual([]);
    const stateAfterBoth = repository.getConversationState('manual-sequence');
    expect(stateAfterBoth?.activeResult).toEqual(stateBeforeBoth?.activeResult);
    expect(stateAfterBoth?.pausedOutcomes).toEqual(stateBeforeBoth?.pausedOutcomes);
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('restores a complete pending multi-intent budget clarification after reopening the database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bazak-pending-budget-'));
    const path = join(directory, 'commerce.sqlite');
    const pending = {
      turnId: 'clarify', status: 'partial' as const,
      response: 'Which product should receive the budget?',
      outcomes: [{
        intent: { id: 'selector', goal: 'Choose a product for the budget', query: 'laptop and perfume under $100', constraints: { maxPrice: 100 }, status: 'needs_clarification' as const },
        products: [],
        clarification: { field: 'category' as const, question: 'Which product?', options: ['laptops', 'fragrances'], reason: 'split' as const },
      }],
      stateActions: {
        pauseIntentIds: [], resumeIntentIds: [],
        pendingBudgetClarification: {
          kind: 'ambiguous_multi_intent_budget' as const,
          selectorIntentId: 'selector', maxPrice: 100,
          candidates: [
            { category: 'laptops', intent: { goal: 'Find a laptop', query: 'laptop', constraints: { category: 'laptops' }, status: 'ready' as const } },
            { category: 'fragrances', intent: { goal: 'Find a perfume', query: 'perfume', constraints: { category: 'fragrances' }, status: 'ready' as const } },
          ],
        },
      },
    };
    const firstRepository = new CommerceRepository(path);
    const firstService = new ConversationExecutionService(firstRepository, vi.fn<RunOrchestration>(async () => pending));
    await firstService.execute({ conversationId: 'pending-budget', turnId: 'clarify', prompt: 'Find a laptop and a perfume under $100' });
    firstRepository.close();

    const reopened = new CommerceRepository(path);
    const resumedRunner = vi.fn<RunOrchestration>(async (input) => {
      expect(input.previous?.stateActions?.pendingBudgetClarification).toEqual(pending.stateActions.pendingBudgetClarification);
      expect(input.clarification).toEqual({ intentId: 'selector', field: 'category', value: 'laptops' });
      return {
        turnId: input.turnId, status: 'completed', response: 'Continued both requests.', outcomes: [
          { intent: { id: 'laptop', goal: 'Find a laptop', query: 'laptop', constraints: { category: 'laptops', maxPrice: 100 }, status: 'completed' }, products: [] },
          { intent: { id: 'perfume', goal: 'Find a perfume', query: 'perfume', constraints: { category: 'fragrances' }, status: 'completed' }, products: [ranked(9, 'Perfume', 'fragrances')] },
        ],
      };
    });
    const restoredService = new ConversationExecutionService(reopened, resumedRunner);
    const resolved = await restoredService.execute({
      conversationId: 'pending-budget', turnId: 'resolve', prompt: 'laptops',
      clarification: { intentId: 'selector', field: 'category', value: 'laptops' },
    });
    expect(resolved.outcomes.map(({ intent }) => intent.constraints)).toEqual([
      { category: 'laptops', maxPrice: 100 }, { category: 'fragrances' },
    ]);
    expect(resumedRunner).toHaveBeenCalledOnce();
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('keeps a contradictory-price repair bound to its saved target across recovery and malformed answers', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bazak-price-repair-'));
    const path = join(directory, 'commerce.sqlite');
    const active: OrchestrationResult = {
      turnId: 'one', status: 'completed', response: 'Two lists.', outcomes: [
        { intent: { id: 'laptop', goal: 'Laptops', query: 'laptops', constraints: { category: 'laptops' }, status: 'completed' }, products: [ranked(1, 'Laptop', 'laptops')] },
        { intent: { id: 'fragrance', goal: 'Fragrances', query: 'fragrances', constraints: { category: 'fragrances' }, status: 'completed' }, products: [ranked(2, 'Perfume', 'fragrances')] },
      ],
    };
    const pending: OrchestrationResult = {
      turnId: 'two', status: 'partial', response: 'Use one maximum.', outcomes: [{
        intent: { id: 'two:price-repair', goal: 'Repair the laptops budget', query: 'over 900 under 500', constraints: { category: 'laptops', maxPrice: 500 }, status: 'needs_clarification' },
        products: [], clarification: { field: 'maxPrice', question: 'Use one maximum.', options: ['Use maximum $500', 'Enter a different maximum price'], reason: 'requested' },
      }],
      stateActions: { pauseIntentIds: [], resumeIntentIds: [], preserveActiveResult: true, pendingPriceConstraintRepair: {
        kind: 'contradictory_price', selectorIntentId: 'two:price-repair', targetIntentId: 'laptop', targetCategory: 'laptops', minPrice: 900, maxPrice: 500,
      } },
    };
    const firstRepository = new CommerceRepository(path);
    const firstRunner = vi.fn<RunOrchestration>(async ({ turnId }) => turnId === 'one' ? active : pending);
    const firstService = new ConversationExecutionService(firstRepository, firstRunner);
    await firstService.execute({ conversationId: 'repair', turnId: 'one', prompt: 'Show laptops and fragrances' });
    await firstService.execute({ conversationId: 'repair', turnId: 'two', prompt: 'For the laptop only, over $900 but under $500' });
    firstRepository.close();

    const reopened = new CommerceRepository(path);
    const resumedRunner = vi.fn<RunOrchestration>(async (input) => {
      expect(input.prompt).toBe('For laptops, use a maximum price of $500.');
      expect(input.priceConstraintRepair).toEqual({ targetIntentId: 'laptop', targetCategory: 'laptops', maxPrice: 500 });
      expect(input.previous?.outcomes.map(({ intent }) => intent.id)).toEqual(['laptop', 'fragrance']);
      return { turnId: input.turnId, status: 'completed', response: 'Updated laptops only.', outcomes: [
        { ...active.outcomes[0], intent: { ...active.outcomes[0].intent, constraints: { category: 'laptops', maxPrice: 500 } } },
        active.outcomes[1],
      ] };
    });
    const restored = new ConversationExecutionService(reopened, resumedRunner);
    const malformed = await restored.execute({ conversationId: 'repair', turnId: 'three', prompt: 'the.900' });
    expect(malformed.response).toContain('laptops');
    expect(malformed.outcomes[0].clarification?.options).toEqual(['Use maximum $500', 'Enter a different maximum price']);
    expect(resumedRunner).not.toHaveBeenCalled();
    expect(reopened.getConversationState('repair')?.activeResult?.outcomes.map(({ intent }) => intent.id)).toEqual(['laptop', 'fragrance']);

    const resolved = await restored.execute({
      conversationId: 'repair', turnId: 'four', prompt: 'Use maximum $500',
      clarification: { intentId: 'two:price-repair', field: 'maxPrice', value: 'Use maximum $500' },
    });
    expect(resolved.response).toBe('Updated laptops only.');
    expect(resumedRunner).toHaveBeenCalledOnce();

    const confirmationRunner = vi.fn<RunOrchestration>(async (input) => {
      if (input.turnId.endsWith('-one')) return { ...active, turnId: input.turnId };
      if (input.turnId.endsWith('-two')) return {
        ...pending, turnId: input.turnId,
        outcomes: [{ ...pending.outcomes[0], intent: { ...pending.outcomes[0].intent, id: `${input.turnId}:price-repair` } }],
        stateActions: { ...pending.stateActions!, pendingPriceConstraintRepair: { ...pending.stateActions!.pendingPriceConstraintRepair!, selectorIntentId: `${input.turnId}:price-repair` } },
      };
      expect(input.priceConstraintRepair).toEqual({ targetIntentId: 'laptop', targetCategory: 'laptops', maxPrice: 500 });
      return { ...active, turnId: input.turnId, response: 'Updated laptops only.' };
    });
    const confirmationService = new ConversationExecutionService(reopened, confirmationRunner);
    const confirmationPrompts = ['Yes, use $500', 'Okay, maximum $500', 'Go with $500', 'כן, $500', '500'];
    for (const [index, confirmationPrompt] of confirmationPrompts.entries()) {
      const prefix = `confirmation-${index}`;
      await confirmationService.execute({ conversationId: prefix, turnId: `${prefix}-one`, prompt: 'Show laptops and fragrances' });
      await confirmationService.execute({ conversationId: prefix, turnId: `${prefix}-two`, prompt: 'For laptop, over $900 under $500' });
      const confirmation = await confirmationService.execute({ conversationId: prefix, turnId: `${prefix}-three`, prompt: confirmationPrompt });
      expect(confirmation.response).toBe('Updated laptops only.');
    }

    const topicRunner = vi.fn<RunOrchestration>(async (input) => {
      if (input.turnId.endsWith('-one')) return { ...active, turnId: input.turnId };
      if (input.turnId.endsWith('-two')) return {
        ...pending, turnId: input.turnId,
        outcomes: [{ ...pending.outcomes[0], intent: { ...pending.outcomes[0].intent, id: `${input.turnId}:price-repair` } }],
        stateActions: { ...pending.stateActions!, pendingPriceConstraintRepair: { ...pending.stateActions!.pendingPriceConstraintRepair!, selectorIntentId: `${input.turnId}:price-repair` } },
      };
      expect(['Instead, show smartphones under $300', 'Smartphones under $300', 'I want smartphones under $300', 'עכשיו סמארטפונים עד $300']).toContain(input.prompt);
      expect(input.priceConstraintRepair).toBeUndefined();
      return { turnId: input.turnId, status: 'completed', response: 'New phones.', outcomes: [] };
    });
    const topicService = new ConversationExecutionService(reopened, topicRunner);
    const topicSwitches = ['Instead, show smartphones under $300', 'Smartphones under $300', 'I want smartphones under $300', 'עכשיו סמארטפונים עד $300'];
    for (const [index, topicPrompt] of topicSwitches.entries()) {
      const prefix = `topic-${index}`;
      await topicService.execute({ conversationId: prefix, turnId: `${prefix}-one`, prompt: 'Show laptops and fragrances' });
      await topicService.execute({ conversationId: prefix, turnId: `${prefix}-two`, prompt: 'For laptop, over $900 under $500' });
      await topicService.execute({ conversationId: prefix, turnId: `${prefix}-three`, prompt: topicPrompt });
    }
    expect(topicRunner).toHaveBeenCalledTimes(topicSwitches.length * 3);
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('selects from several explicit historical lists and names only lists missing the requested position', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bazak-several-history-'));
    const repository = new CommerceRepository(join(directory, 'commerce.sqlite'));
    const runner = vi.fn<RunOrchestration>(async ({ turnId }) => ({
      turnId, status: 'completed', response: turnId, outcomes: [{
        intent: { id: turnId, goal: turnId, query: turnId, constraints: { category: turnId }, status: 'completed' },
        products: turnId === 'laptops'
          ? [ranked(1, 'L1', 'laptops')]
          : [ranked(turnId === 'phones' ? 10 : 20, 'One', turnId), ranked(turnId === 'phones' ? 11 : 21, 'Two', turnId)],
      }],
    }));
    const service = new ConversationExecutionService(repository, runner);
    await service.execute({ conversationId: 'several', turnId: 'phones', prompt: 'Phones' });
    await service.execute({ conversationId: 'several', turnId: 'fragrances', prompt: 'Fragrances' });
    await service.execute({ conversationId: 'several', turnId: 'laptops', prompt: 'Laptops' });
    const result = await service.execute({ conversationId: 'several', turnId: 'select', prompt: 'Show the second product from each list' });
    expect(result.status).toBe('partial');
    expect(result.response).toContain('laptops');
    expect(result.response).not.toContain('smartphones');
    expect(runner).toHaveBeenCalledTimes(3);
    expect(repository.listToolRuns('select')).toEqual([]);
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('persists the exact product selected from the latest changed display order', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bazak-changed-order-'));
    const repository = new CommerceRepository(join(directory, 'commerce.sqlite'));
    const first = ranked(1, 'One', 'smartphones');
    const second = ranked(2, 'Two', 'smartphones');
    const runner = vi.fn<RunOrchestration>(async ({ turnId }) => ({
      turnId, status: 'completed', response: 'Phones', outcomes: [{
        intent: { id: 'phones', goal: 'Phones', query: 'phones', constraints: { category: 'smartphones' }, status: 'completed' },
        products: turnId === 'one' ? [first, second] : [second, first],
      }],
    }));
    const service = new ConversationExecutionService(repository, runner);
    await service.execute({ conversationId: 'changed', turnId: 'one', prompt: 'Find phones' });
    await service.execute({ conversationId: 'changed', turnId: 'two', prompt: 'Refine phones' });
    const selected = await service.execute({ conversationId: 'changed', turnId: 'three', prompt: 'Show me the second one' });
    expect(selected.outcomes[0].products[0].product.id).toBe(1);
    expect(repository.getConversationState('changed')?.selectedProducts?.at(-1)?.product).toEqual(first.product);
    expect(runner).toHaveBeenCalledTimes(2);
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('does not parse ranking language as an ordinal selection', () => {
    expect(buildConversationContext({ prompt: 'Find a third generation phone', completedResults: [] }).displayedProductReference).toBeUndefined();
  });
});
