import { z } from 'zod';

const environmentSchema = z.object({
  AI_PROVIDER: z.enum(['disabled', 'openai', 'litellm']).default('disabled'),
  OPENAI_MODEL: z.literal('gpt-5.4-mini').default('gpt-5.4-mini'),
  OPENAI_API_KEY: z.string().trim().optional(),
  LITELLM_BASE_URL: z.string().url().optional(),
  LITELLM_MODEL: z.literal('qwen3.5-9b').optional(),
  LITELLM_API_KEY: z.string().trim().optional(),
}).superRefine((value, context) => {
  if (value.AI_PROVIDER === 'openai' && !value.OPENAI_API_KEY) {
    context.addIssue({ code: 'custom', path: ['OPENAI_API_KEY'], message: 'Required when AI_PROVIDER=openai' });
  }
  if (value.AI_PROVIDER === 'litellm') {
    if (!value.LITELLM_API_KEY) {
      context.addIssue({ code: 'custom', path: ['LITELLM_API_KEY'], message: 'Required when AI_PROVIDER=litellm' });
    }
    if (!value.LITELLM_BASE_URL) {
      context.addIssue({ code: 'custom', path: ['LITELLM_BASE_URL'], message: 'Required when AI_PROVIDER=litellm' });
      return;
    }
    if (!value.LITELLM_MODEL) {
      context.addIssue({ code: 'custom', path: ['LITELLM_MODEL'], message: 'Required when AI_PROVIDER=litellm' });
    }
    const endpoint = new URL(value.LITELLM_BASE_URL);
    const isLoopback = ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);
    if (endpoint.protocol !== 'http:' || !isLoopback || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      context.addIssue({
        code: 'custom',
        path: ['LITELLM_BASE_URL'],
        message: 'LiteLLM development access must use a credential-free loopback HTTP URL.',
      });
    }
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
