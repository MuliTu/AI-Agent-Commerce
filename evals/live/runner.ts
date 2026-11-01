import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { AgentBoundaryError } from '../../src/lib/agent';
import { parseEnvironment, isProviderConfigured } from '../../src/lib/config/environment';
import { ConversationExecutionService } from '../../src/lib/execution';
import { runLiveOrchestration } from '../../src/lib/orchestration/live';
import { CommerceRepository } from '../../src/lib/persistence';
import { evaluateObjectiveAssertions } from './assertions';
import { judgeTurn } from './judge';
import { liveEvaluationScenarios } from './scenarios';
import type { EvaluationScenario, EvaluationStatus, TurnArtifact } from './types';

type RunSummary = {
  schemaVersion: 1;
  runId: string;
  startedAt: string;
  completedAt: string;
  gitBase: '2435b86';
  provider: string;
  model: string | null;
  databasePath: string;
  artifactDirectory: string;
  scenarioCount: number;
  turnCount: number;
  callCounts: {
    applicationTurns: number;
    catalogCalls: number;
    judgeCalls: number;
    applicationProviderCalls: 'not_exposed_by_runtime';
  };
  statusCounts: Record<EvaluationStatus, number>;
  status: EvaluationStatus;
  reasons: string[];
  artifacts: string[];
};

function safeId(value: string): string {
  return value.replace(/[^a-z0-9-]+/giu, '-').replace(/^-|-$/gu, '').toLocaleLowerCase('en-US');
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

function combineStatus(deterministic: EvaluationStatus, judge: EvaluationStatus | null): EvaluationStatus {
  if (deterministic === 'FAIL') return 'FAIL';
  if (deterministic === 'INCONCLUSIVE' || judge === 'INCONCLUSIVE' || judge === null) return 'INCONCLUSIVE';
  return judge === 'FAIL' ? 'FAIL' : 'PASS';
}

function statusFromArtifacts(artifacts: TurnArtifact[]): EvaluationStatus {
  if (artifacts.some(({ status }) => status === 'FAIL')) return 'FAIL';
  if (artifacts.some(({ status }) => status === 'INCONCLUSIVE')) return 'INCONCLUSIVE';
  return 'PASS';
}

function isUnavailable(error: unknown): boolean {
  if (AgentBoundaryError.isInstance(error)) {
    return ['provider_authentication', 'provider_unavailable', 'provider_rate_limit'].includes(error.code);
  }
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; kind?: unknown; status?: unknown; code?: unknown };
  return candidate.name === 'CatalogError'
    && (candidate.kind === 'network' || candidate.kind === 'timeout' || (typeof candidate.status === 'number' && candidate.status >= 500));
}

export function createIsolatedDatabasePath(environment: NodeJS.ProcessEnv = process.env): string {
  const directory = mkdtempSync(join(tmpdir(), 'bazak-live-eval-'));
  const databasePath = join(directory, 'commerce.sqlite');
  environment.BAZAK_DATABASE_PATH = databasePath;
  const relativeToTemp = relative(realpathSync(tmpdir()), realpathSync(directory));
  if (!environment.BAZAK_DATABASE_PATH || !isAbsolute(databasePath) || relativeToTemp.startsWith('..') || basename(databasePath) !== 'commerce.sqlite') {
    throw new Error('BAZAK_DATABASE_PATH is not an isolated temporary evaluation database.');
  }
  return databasePath;
}

function configuredArtifactDirectory(runId: string): string {
  const configured = process.env.BAZAK_EVAL_ARTIFACT_DIR?.trim();
  const directory = resolve(configured || join(tmpdir(), 'bazak-live-eval-artifacts', runId));
  mkdirSync(directory, { recursive: true });
  return directory;
}

export async function runLiveEvaluation(input: { scenarios?: EvaluationScenario[] } = {}): Promise<RunSummary> {
  const startedAt = new Date().toISOString();
  const runId = `${startedAt.replace(/[:.]/gu, '-')}-${process.pid}`;
  const artifactDirectory = configuredArtifactDirectory(runId);
  const databasePath = createIsolatedDatabasePath();
  const environment = parseEnvironment(process.env);
  const scenarios = input.scenarios ?? liveEvaluationScenarios;
  const summaryBase = {
    schemaVersion: 1 as const,
    runId,
    startedAt,
    gitBase: '2435b86' as const,
    provider: environment.LLM_PROVIDER,
    model: environment.LLM_PROVIDER === 'disabled' ? null : environment.LLM_MODEL,
    databasePath,
    artifactDirectory,
    scenarioCount: scenarios.length,
  };

  if (!isProviderConfigured(environment)) {
    const summary: RunSummary = {
      ...summaryBase,
      completedAt: new Date().toISOString(),
      turnCount: 0,
      callCounts: { applicationTurns: 0, catalogCalls: 0, judgeCalls: 0, applicationProviderCalls: 'not_exposed_by_runtime' },
      statusCounts: { PASS: 0, FAIL: 0, INCONCLUSIVE: 1 },
      status: 'INCONCLUSIVE',
      reasons: ['No real LLM provider is configured. The harness did not substitute a mock provider or mock catalog.'],
      artifacts: [],
    };
    writeJson(join(artifactDirectory, 'summary.json'), summary);
    return summary;
  }

  const repository = new CommerceRepository(databasePath);
  const service = new ConversationExecutionService(repository, runLiveOrchestration);
  const artifacts: TurnArtifact[] = [];
  const artifactPaths: string[] = [];
  let applicationTurns = 0;
  let catalogCalls = 0;
  let judgeCalls = 0;

  try {
    for (const scenario of scenarios) {
      const conversationId = `eval-${runId}-${safeId(scenario.id)}`;
      for (const [index, turn] of scenario.turns.entries()) {
        const turnId = `${conversationId}-${index + 1}-${safeId(turn.id)}`;
        const stateBefore = repository.getConversationState(conversationId) ?? null;
        const started = performance.now();
        let result = null;
        let executionError: unknown;
        applicationTurns += 1;
        try {
          result = await service.execute({ conversationId, turnId, prompt: turn.prompt });
        } catch (error) {
          executionError = error;
        }

        const reader = new CommerceRepository(databasePath);
        const stateAfter = reader.getConversationState(conversationId) ?? null;
        const toolRuns = reader.listToolRuns(turnId);
        const snapshots = reader.listProductSnapshots(turnId);
        const decisions = reader.listDecisionEvents(turnId);
        const persistedTurn = reader.getTurn(turnId);
        const messages = reader.listMessages(conversationId);
        reader.close();
        catalogCalls += toolRuns.length;

        const transcript = messages.map(({ role, content }) => ({ role, content }));
        const returnedProducts = result?.outcomes.flatMap(({ products }) => products.map(({ product }) => ({
          id: product.id,
          title: product.title,
          price: product.price,
          category: product.category,
        }))) ?? [];
        const objectiveAssertions = result
          ? evaluateObjectiveAssertions({ turn, result, stateBefore: stateBefore ?? undefined, stateAfter: stateAfter ?? undefined, catalogCalls: toolRuns, snapshots })
          : [];
        const unavailable = executionError !== undefined && isUnavailable(executionError);
        const deterministicStatus: EvaluationStatus = unavailable
          ? 'INCONCLUSIVE'
          : executionError || objectiveAssertions.some(({ pass }) => !pass)
            ? 'FAIL'
            : 'PASS';
        const durationMs = Math.round(performance.now() - started);
        const baseArtifact = {
          schemaVersion: 1 as const,
          runId,
          scenarioId: scenario.id,
          scenarioDescription: scenario.description,
          turnId,
          input: turn.prompt,
          expected: turn.expected,
          transcript,
          stateBefore,
          stateAfter,
          interpretation: decisions,
          activeIntentIdsBefore: stateBefore?.activeResult?.outcomes.map(({ intent }) => intent.id) ?? [],
          activeIntentIdsAfter: stateAfter?.activeResult?.outcomes.map(({ intent }) => intent.id) ?? [],
          focusBefore: stateBefore?.currentFocusIntentId ?? null,
          focusAfter: stateAfter?.currentFocusIntentId ?? null,
          catalogCalls: toolRuns,
          returnedProducts,
          productSnapshots: snapshots,
          response: result?.response ?? null,
          result,
          persistenceRecovery: {
            reopenedFromDisk: true,
            persistedTurnStatus: persistedTurn?.status ?? null,
            persistedMessageCount: messages.length,
            stateRevision: stateAfter?.revision ?? null,
          },
          objectiveAssertions,
          deterministicStatus,
          durationMs,
        };
        let judge = null;
        if (result && deterministicStatus !== 'INCONCLUSIVE') {
          try {
            judgeCalls += 1;
            judge = await judgeTurn(baseArtifact, environment);
          } catch (error) {
            executionError ??= error;
          }
        }
        const reasons = [
          ...objectiveAssertions.filter(({ pass }) => !pass).map(({ id, reason }) => `${id}: ${reason}`),
          ...(executionError ? [unavailable ? 'Provider or catalog unavailable; no mock was used.' : `Execution or judge error: ${executionError instanceof Error ? executionError.message : String(executionError)}`] : []),
          ...(judge ? [`Judge: ${judge.reason}`] : []),
        ];
        const effectiveJudgeStatus: EvaluationStatus | null = judge?.status ?? (executionError && result ? 'INCONCLUSIVE' : null);
        const artifact: TurnArtifact = {
          ...baseArtifact,
          judge,
          status: combineStatus(deterministicStatus, effectiveJudgeStatus),
          reasons,
        };
        const artifactPath = join(artifactDirectory, `${String(artifactPaths.length + 1).padStart(2, '0')}-${safeId(scenario.id)}-${safeId(turn.id)}.json`);
        writeJson(artifactPath, artifact);
        artifactPaths.push(artifactPath);
        artifacts.push(artifact);

        if (executionError && !unavailable && !result) break;
      }
    }
  } finally {
    repository.close();
  }

  const status = statusFromArtifacts(artifacts);
  const statusCounts = artifacts.reduce<Record<EvaluationStatus, number>>((counts, artifact) => ({ ...counts, [artifact.status]: counts[artifact.status] + 1 }), { PASS: 0, FAIL: 0, INCONCLUSIVE: 0 });
  const summary: RunSummary = {
    ...summaryBase,
    completedAt: new Date().toISOString(),
    turnCount: artifacts.length,
    callCounts: { applicationTurns, catalogCalls, judgeCalls, applicationProviderCalls: 'not_exposed_by_runtime' },
    statusCounts,
    status,
    reasons: artifacts.filter(({ status: turnStatus }) => turnStatus !== 'PASS').flatMap(({ scenarioId, turnId, reasons }) => reasons.map((reason) => `${scenarioId}/${turnId}: ${reason}`)),
    artifacts: artifactPaths,
  };
  writeJson(join(artifactDirectory, 'summary.json'), summary);
  return summary;
}

export const liveEvaluationInternals = { combineStatus, statusFromArtifacts, isUnavailable };
