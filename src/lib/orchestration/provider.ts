import { generateText, Output, type LanguageModel } from 'ai';
import { AgentBoundaryError } from '../agent';
import { toProviderAgentError } from '../agent/errors';
import { createProviderModel, type ModelFactory } from '../agent/model';
import { isProviderConfigured, type Environment } from '../config/environment';
import { INTENT_EXTRACTION_SYSTEM_PROMPT } from '../ai/prompts';
import { extractedTurnPlanSchema, providerExtractedTurnPlanSchema, type IntentExtractor } from './contracts';

type IntentPlanGenerationOptions = {
  model: LanguageModel;
  instructions: string;
  prompt: string;
  maxOutputTokens?: number;
  maxRetries?: number;
  providerOptions?: {
    openai: {
      reasoningEffort?: 'none';
      strictJsonSchema: boolean;
    };
  };
};

export type IntentPlanGenerator = (options: IntentPlanGenerationOptions) => Promise<unknown>;

export type ProviderIntentExtractorOptions = {
  environment: Environment;
  generate?: IntentPlanGenerator;
  modelFactory?: ModelFactory;
};

async function defaultGenerate({ model, ...options }: IntentPlanGenerationOptions): Promise<unknown> {
  const result = await generateText({
    model,
    output: Output.object({
      schema: providerExtractedTurnPlanSchema,
      name: 'shopping_intent_plan',
      description: 'A validated single-agent plan containing separate shopping intents.',
    }),
    ...options,
  });
  return result.output;
}

export function createProviderIntentExtractor(options: ProviderIntentExtractorOptions): IntentExtractor {
  if (!isProviderConfigured(options.environment)) {
    throw new AgentBoundaryError(
      'provider_authentication',
      'A model provider must be explicitly enabled with a server-side credential.',
      false,
    );
  }
  const modelFactory = options.modelFactory ?? createProviderModel;
  const model = modelFactory(
    options.environment.LLM_MODEL,
    options.environment.LLM_API_KEY,
    options.environment.LLM_BASE_URL,
    options.environment.LLM_PROVIDER === 'litellm' ? 'chat' : 'responses',
  );
  const generator = options.generate ?? defaultGenerate;

  return async (context) => {
    try {
      const generated = await generator({
        model,
        instructions: INTENT_EXTRACTION_SYSTEM_PROMPT,
        prompt: JSON.stringify({
          shopperPrompt: context.prompt,
          previousIntents: context.previousIntents,
        }),
        maxRetries: 0,
        providerOptions: {
          openai: {
            strictJsonSchema: options.environment.LLM_PROVIDER !== 'litellm',
            ...(options.environment.LLM_PROVIDER === 'litellm' ? { reasoningEffort: 'none' as const } : {}),
          },
        },
        ...(options.environment.LLM_PROVIDER === 'litellm' ? {
          maxOutputTokens: 1000,
        } : {}),
      });
      const plan = extractedTurnPlanSchema.parse(generated);
      const previousIds = new Set(context.previousIntents.map(({ id }) => id));
      return {
        ...plan,
        intents: plan.intents.map((intent) => (
          {
            ...intent,
            // Provider-generated tags are semantic hints, not trusted catalog
            // taxonomy. Applying them as exact filters can erase an otherwise
            // valid category result (for example "photography" -> "camera").
            // Keep the wording in the query for ranking instead.
            constraints: { ...intent.constraints, requiredTags: undefined },
            ...(intent.intentId && !previousIds.has(intent.intentId)
              ? { intentId: undefined }
              : {}),
          }
        )),
      };
    } catch (error) {
      if (AgentBoundaryError.isInstance(error)) throw error;
      if (error && typeof error === 'object' && 'issues' in error) throw error;
      throw toProviderAgentError(error);
    }
  };
}
