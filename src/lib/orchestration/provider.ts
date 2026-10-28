import { generateText, Output, type LanguageModel } from 'ai';
import { AgentBoundaryError } from '../agent';
import { toProviderAgentError } from '../agent/errors';
import { createProviderModel, type ModelFactory } from '../agent/model';
import { isProviderConfigured, type Environment } from '../config/environment';
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

const instructions = `Extract one or more shopping intents from the shopper turn.
Return only the requested structured object.
Never invent an intentId. Use null for new intents; when refining prior state, use only an exact ID supplied in previousIntents.
Every new intent must include both a concise goal and a catalog search query.
Use null for any unavailable optional intent or constraint value; include every field requested by the schema.
Never include product records, product IDs, prices, or other catalog facts in the intent plan.
Product data is fetched and validated separately by deterministic application code.`;

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
        instructions,
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
          intent.intentId && !previousIds.has(intent.intentId)
            ? { ...intent, intentId: undefined }
            : intent
        )),
      };
    } catch (error) {
      if (AgentBoundaryError.isInstance(error)) throw error;
      if (error && typeof error === 'object' && 'issues' in error) throw error;
      throw toProviderAgentError(error);
    }
  };
}
