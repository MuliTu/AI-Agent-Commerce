import { z } from 'zod';

export const OPENAI_MODEL = 'gpt-5.4-mini' as const;
export const OPENAI_BASE_URL = 'https://api.openai.com/v1' as const;
export const LITELLM_MODEL = 'qwen3.5-9b' as const;
export const LITELLM_BASE_URL = 'http://127.0.0.1:4001/v1' as const;

const credential = z.string().trim().min(1);

const environmentSchema = z.discriminatedUnion('LLM_PROVIDER', [
  z.object({
    LLM_PROVIDER: z.literal('disabled'),
    LLM_API_KEY: z.string().trim().optional(),
    LLM_MODEL: z.string().trim().optional(),
    LLM_BASE_URL: z.string().trim().optional(),
  }),
  z.object({
    LLM_PROVIDER: z.literal('openai'),
    LLM_API_KEY: credential,
    LLM_MODEL: z.literal(OPENAI_MODEL).default(OPENAI_MODEL),
    LLM_BASE_URL: z.literal(OPENAI_BASE_URL).default(OPENAI_BASE_URL),
  }),
  z.object({
    LLM_PROVIDER: z.literal('litellm'),
    LLM_API_KEY: credential,
    LLM_MODEL: z.literal(LITELLM_MODEL).default(LITELLM_MODEL),
    LLM_BASE_URL: z.literal(LITELLM_BASE_URL).default(LITELLM_BASE_URL),
  }),
]);

export type Environment = z.infer<typeof environmentSchema>;
export type ConfiguredEnvironment = Exclude<Environment, { LLM_PROVIDER: 'disabled' }>;

export function parseEnvironment(input: Record<string, string | undefined>): Environment {
  const result = environmentSchema.safeParse({
    ...input,
    LLM_PROVIDER: input.LLM_PROVIDER ?? 'disabled',
  });
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid server configuration: ${issues.join('; ')}`);
  }
  return result.data;
}

export function getProviderLabel(environment: Environment): string {
  if (environment.LLM_PROVIDER === 'litellm') return 'Local LiteLLM / Qwen';
  if (environment.LLM_PROVIDER === 'openai') return 'OpenAI / GPT-5.4-mini';
  return 'Model configuration required';
}

export function isProviderConfigured(environment: Environment): environment is ConfiguredEnvironment {
  return environment.LLM_PROVIDER !== 'disabled';
}
