import { z } from 'zod';

const environmentSchema = z.object({
  AI_PROVIDER: z.enum(['disabled', 'openai']).default('disabled'),
  OPENAI_MODEL: z.literal('gpt-5.4-mini').default('gpt-5.4-mini'),
  OPENAI_API_KEY: z.string().trim().optional(),
}).superRefine((value, context) => {
  if (value.AI_PROVIDER === 'openai' && !value.OPENAI_API_KEY) {
    context.addIssue({ code: 'custom', path: ['OPENAI_API_KEY'], message: 'Required when AI_PROVIDER=openai' });
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
