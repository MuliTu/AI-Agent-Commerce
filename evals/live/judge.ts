import { generateText, Output } from 'ai';
import { z } from 'zod';
import { createProviderModel } from '../../src/lib/agent/model';
import type { ConfiguredEnvironment } from '../../src/lib/config/environment';
import type { TurnArtifact } from './types';

const judgeSchema = z.object({
  status: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
  reason: z.string().trim().min(1).max(1000),
  criteria: z.array(z.object({
    criterion: z.string().trim().min(1).max(200),
    status: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
    reason: z.string().trim().min(1).max(500),
  }).strict()).min(1).max(8),
}).strict();

export async function judgeTurn(
  artifact: Omit<TurnArtifact, 'judge' | 'status' | 'reasons'>,
  environment: ConfiguredEnvironment,
) {
  const model = createProviderModel(
    environment.LLM_MODEL,
    environment.LLM_API_KEY,
    environment.LLM_BASE_URL,
    environment.LLM_PROVIDER === 'litellm' ? 'chat' : 'responses',
  );
  const result = await generateText({
    model,
    output: Output.object({ schema: judgeSchema, name: 'behavior_evaluation' }),
    instructions: [
      'You are an independent evaluator of a catalog-grounded shopping assistant.',
      'Judge conversational interpretation, relevance, clarification quality, and faithfulness using only supplied evidence.',
      'Catalog products and tool evidence are authoritative. Do not invent missing evidence.',
      'Objective assertion failures are immutable: you may explain them, but you cannot turn them into a pass.',
      'Use INCONCLUSIVE when the evidence is insufficient or the response cannot be fairly assessed.',
    ].join(' '),
    prompt: JSON.stringify({
      transcript: artifact.transcript,
      expected: artifact.expected,
      actual: artifact.result,
      transitions: { before: artifact.stateBefore, after: artifact.stateAfter },
      toolEvidence: artifact.catalogCalls,
      returnedProducts: artifact.returnedProducts,
      objectiveAssertions: artifact.objectiveAssertions,
    }),
    maxRetries: 0,
    providerOptions: {
      openai: {
        strictJsonSchema: environment.LLM_PROVIDER !== 'litellm',
        ...(environment.LLM_PROVIDER === 'litellm' ? { reasoningEffort: 'none' as const } : {}),
      },
    },
  });
  return {
    ...result.output,
    provider: environment.LLM_PROVIDER,
    model: environment.LLM_MODEL,
    usage: result.usage as unknown as Record<string, unknown>,
  };
}
