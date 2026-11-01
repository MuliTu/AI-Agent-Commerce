import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reassessArtifactDirectory } from './reassess';

describe('offline live-artifact reassessment', () => {
  it('reassesses saved evidence without provider or catalog calls', () => {
    const source = process.env.BAZAK_EVAL_SOURCE_ARTIFACT_DIR?.trim();
    if (!source) throw new Error('BAZAK_EVAL_SOURCE_ARTIFACT_DIR is required.');
    const output = process.env.BAZAK_EVAL_REASSESS_OUTPUT_DIR?.trim() || join(source, `reassessment-${Date.now()}`);
    const summary = reassessArtifactDirectory(source, output);
    console.info('bazak_offline_reassessment_summary', JSON.stringify(summary));
    expect(summary.offlineReassessment).toBe(true);
  });
});
