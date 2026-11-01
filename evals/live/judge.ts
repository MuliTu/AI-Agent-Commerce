import { generateText, Output } from 'ai';
import { z } from 'zod';
import { createProviderModel } from '../../src/lib/agent/model';
import type { TurnArtifact } from './types';

export type JudgeConfiguration = {
  provider: 'openai' | 'litellm';
  model: string;
  apiKey: string;
  baseUrl: string;
  applicationProvider: 'openai' | 'litellm';
  applicationModel: string;
};

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
  configuration: JudgeConfiguration,
) {
  const model = createProviderModel(
    configuration.model,
    configuration.apiKey,
    configuration.baseUrl,
    configuration.provider === 'litellm' ? 'chat' : 'responses',
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
        strictJsonSchema: configuration.provider !== 'litellm',
        ...(configuration.provider === 'litellm' ? { reasoningEffort: 'none' as const } : {}),
      },
    },
  });
  return {
    ...result.output,
    provider: configuration.provider,
    model: configuration.model,
    executionIndependent: true as const,
    providerIndependent: configuration.provider !== configuration.applicationProvider,
    modelIndependent: configuration.provider !== configuration.applicationProvider
      || configuration.model !== configuration.applicationModel,
    usage: result.usage as unknown as Record<string, unknown>,
  };
}
