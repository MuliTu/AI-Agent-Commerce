import { describe, expect, it } from 'vitest';
import { runLiveEvaluation } from './runner';

describe('live behavior evaluation', () => {
  it('runs real-provider, real-catalog scenarios or reports unavailable infrastructure as inconclusive', async () => {
    const summary = await runLiveEvaluation();
    console.info('bazak_live_eval_summary', JSON.stringify(summary));
    expect(summary.status, `Live evaluation is not a green CI result unless every turn passes.\n${summary.reasons.join('\n')}`).toBe('PASS');
  });
});
