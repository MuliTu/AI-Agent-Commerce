import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('delivered architecture documentation', () => {
  it('describes application-owned catalog execution without claiming a live model tool-loop', () => {
    const sources = [read('README.md'), read('outputs/SPEC.md'), read('outputs/DECISIONS.md')];

    for (const source of sources) {
      expect(source).toMatch(/structured (?:intent\/action |model )?(?:output|plan)/i);
      expect(source).toMatch(/application (?:code )?(?:invokes|decomposes|resolves)/i);
    }
    expect(sources.join('\n')).toMatch(/tool-loop prototype.*(?:removed|never wired)/is);
  });

  it('keeps implemented retry evidence distinct from deferred initial-call retry', () => {
    const sources = [read('README.md'), read('outputs/SPEC.md'), read('outputs/PLAN.md'), read('outputs/DECISIONS.md')];

    for (const source of sources) expect(source).toMatch(/(?:initial(?:-call| execution| catalog| calls?).*defer|defer.*initial(?:-call| execution| catalog| calls?))/is);
    expect(read('README.md')).toMatch(/persisted as sanitized `tool_runs`/i);
  });

  it('retains the assignment-facing README topics and runnable scripts', () => {
    const readme = read('README.md');
    const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

    for (const script of ['dev', 'build', 'test', 'test:e2e', 'eval:live']) {
      expect(packageJson.scripts[script]).toBeTruthy();
    }
    for (const topic of [
      'Run locally',
      'Architecture and trade-offs',
      'Ambiguity, off-catalog requests, and failures',
      'Persistence, full disks, corruption, and cleared storage',
      'End-to-end evaluation',
      'What I would change with another week',
    ]) expect(readme).toContain(topic);
  });
});
