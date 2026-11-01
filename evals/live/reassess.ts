import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateObjectiveAssertions } from './assertions';
import { liveEvaluationScenarios } from './scenarios';
import type { EvaluationStatus, ObjectiveExpectation, TurnArtifact } from './types';

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function safeId(value: string): string {
  return value.replace(/[^a-z0-9-]+/giu, '-').replace(/^-|-$/gu, '').toLocaleLowerCase('en-US');
}

function expectedFor(artifact: TurnArtifact): ObjectiveExpectation {
  const scenario = liveEvaluationScenarios.find(({ id }) => id === artifact.scenarioId);
  const turn = scenario?.turns.find(({ id }) => artifact.turnId.endsWith(`-${safeId(id)}`));
  if (!turn) throw new Error(`No current scenario expectation matches ${artifact.turnId}.`);
  return turn.expected;
}

export function reassessTurnArtifact(saved: TurnArtifact): TurnArtifact {
  if (!saved.result) return saved;
  const expected = expectedFor(saved);
  const objectiveAssertions = evaluateObjectiveAssertions({
    turn: { id: saved.turnId, prompt: saved.input, expected },
    result: saved.result,
    stateBefore: saved.stateBefore ?? undefined,
    stateAfter: saved.stateAfter ?? undefined,
    catalogCalls: saved.catalogCalls,
    catalogCaptureComplete: saved.catalogCaptureComplete,
    snapshots: saved.productSnapshots,
    persistenceRecovered: saved.persistenceRecovery.reopenedFromDisk,
  });
  const deterministicStatus: EvaluationStatus = saved.deterministicStatus === 'INCONCLUSIVE'
    ? 'INCONCLUSIVE'
    : objectiveAssertions.some(({ status }) => status === 'FAIL')
      ? 'FAIL'
      : objectiveAssertions.some(({ status }) => status === 'INCONCLUSIVE')
        ? 'INCONCLUSIVE'
        : 'PASS';
  const expectationChanged = !sameJson(saved.expected, expected);
  const judge = expectationChanged && saved.judge
    ? {
        ...saved.judge,
        status: 'INCONCLUSIVE' as const,
        reason: 'The saved judge call evaluated an older acceptance criterion. It was not rerun, so no semantic verdict is claimed for the corrected expectation.',
        criteria: [{
          criterion: 'Corrected acceptance criterion',
          status: 'INCONCLUSIVE' as const,
          reason: 'Offline reassessment cannot reuse the prior judge PASS for the new comparative-affordability requirement.',
        }],
      }
    : saved.judge;
  const status: EvaluationStatus = deterministicStatus === 'FAIL'
    ? 'FAIL'
    : deterministicStatus === 'INCONCLUSIVE' || !judge || judge.status === 'INCONCLUSIVE'
      ? 'INCONCLUSIVE'
      : judge.status;
  return {
    ...saved,
    expected,
    objectiveAssertions,
    deterministicStatus,
    judge,
    status,
    reasons: [
      ...objectiveAssertions.filter(({ status: assertionStatus }) => assertionStatus !== 'PASS').map(({ id, status: assertionStatus, reason }) => `${assertionStatus} ${id}: ${reason}`),
      ...(judge ? [`Judge: ${judge.reason}`] : []),
    ],
  };
}

export function reassessArtifactDirectory(sourceDirectory: string, outputDirectory: string) {
  mkdirSync(outputDirectory, { recursive: false });
  const artifacts = readdirSync(sourceDirectory)
    .filter((name) => /^\d\d-.*\.json$/u.test(name))
    .sort()
    .map((name) => {
      const saved = JSON.parse(readFileSync(join(sourceDirectory, name), 'utf8')) as TurnArtifact;
      const reassessed = reassessTurnArtifact(saved);
      writeFileSync(join(outputDirectory, name), `${JSON.stringify(reassessed, null, 2)}\n`, { flag: 'wx' });
      return reassessed;
    });
  const sourceSummary = JSON.parse(readFileSync(join(sourceDirectory, 'summary.json'), 'utf8')) as Record<string, unknown>;
  const statusCounts = artifacts.reduce<Record<EvaluationStatus, number>>((counts, artifact) => ({ ...counts, [artifact.status]: counts[artifact.status] + 1 }), { PASS: 0, FAIL: 0, INCONCLUSIVE: 0 });
  const status: EvaluationStatus = statusCounts.FAIL > 0 ? 'FAIL' : statusCounts.INCONCLUSIVE > 0 ? 'INCONCLUSIVE' : 'PASS';
  const summary = {
    schemaVersion: 1,
    offlineReassessment: true,
    sourceRunId: sourceSummary.runId,
    candidateRevision: sourceSummary.candidateRevision,
    sourceDirectory,
    outputDirectory,
    statusCounts,
    status,
    reasons: artifacts.filter(({ status: turnStatus }) => turnStatus !== 'PASS').flatMap(({ turnId, reasons }) => reasons.map((reason) => `${turnId}: ${reason}`)),
    artifacts: readdirSync(outputDirectory).filter((name) => /^\d\d-.*\.json$/u.test(name)).sort().map((name) => join(outputDirectory, name)),
  };
  writeFileSync(join(outputDirectory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
  return summary;
}
