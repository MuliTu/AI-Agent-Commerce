import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createIsolatedDatabasePath, liveEvaluationInternals } from './runner';

describe('live evaluation harness mechanics', () => {
  it('creates and verifies an unused SQLite path below the operating-system temp directory', () => {
    const environment = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
    const path = createIsolatedDatabasePath(environment);
    expect(environment.BAZAK_DATABASE_PATH).toBe(path);
    expect(relative(tmpdir(), path).startsWith('..')).toBe(false);
    expect(existsSync(path)).toBe(false);
  });

  it('never lets a judge override a deterministic failure', () => {
    expect(liveEvaluationInternals.combineStatus('FAIL', 'PASS')).toBe('FAIL');
    expect(liveEvaluationInternals.combineStatus('PASS', 'FAIL')).toBe('FAIL');
    expect(liveEvaluationInternals.combineStatus('PASS', 'INCONCLUSIVE')).toBe('INCONCLUSIVE');
    expect(liveEvaluationInternals.combineStatus('PASS', 'PASS')).toBe('PASS');
  });
});
