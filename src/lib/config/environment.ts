import { z } from 'zod';

const environmentSchema = z.object({
  AI_PROVIDER: z.enum(['disabled', 'openai', 'litellm']).default('disabled'),
  OPENAI_MODEL: z.literal('gpt-5.4-mini').default('gpt-5.4-mini'),
  OPENAI_API_KEY: z.string().trim().optional(),
  LITELLM_BASE_URL: z.literal('http://127.0.0.1:4001/v1').default('http://127.0.0.1:4001/v1'),
  LITELLM_MODEL: z.literal('qwen3.5-9b').default('qwen3.5-9b'),
  LITELLM_API_KEY: z.string().trim().optional(),
}).superRefine((value, context) => {
  if (value.AI_PROVIDER === 'openai' && !value.OPENAI_API_KEY) {
    context.addIssue({ code: 'custom', path: ['OPENAI_API_KEY'], message: 'Required when AI_PROVIDER=openai' });
  }
  if (value.AI_PROVIDER === 'litellm' && !value.LITELLM_API_KEY) {
    context.addIssue({ code: 'custom', path: ['LITELLM_API_KEY'], message: 'Required when AI_PROVIDER=litellm' });
  }
});

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(input: Record<string, string | undefined>): Environment {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid server configuration: ${issues.join('; ')}`);
  }
  return result.data;
}

export function getProviderLabel(environment: Environment): string {
  return environment.AI_PROVIDER === 'litellm' ? 'Local LiteLLM / Qwen' : 'Live OpenAI';
}
