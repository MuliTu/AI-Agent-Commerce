import { generateText, Output, type LanguageModel } from 'ai';
import { AgentBoundaryError, COMMERCE_MODEL } from '../agent';
import { toProviderAgentError } from '../agent/errors';
import { createProviderModel, type ModelFactory } from '../agent/model';
import type { Environment } from '../config/environment';
import { extractedTurnPlanSchema, type IntentExtractor } from './contracts';

type IntentPlanGenerationOptions = {
  model: LanguageModel;
  instructions: string;
  prompt: string;
  maxOutputTokens?: number;
  providerOptions?: {
    openai: {
      reasoningEffort: 'none';
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
Never invent an intentId. Omit intentId for new intents; when refining prior state, use only an exact ID supplied in previousIntents.
Every new intent must include both a concise goal and a catalog search query.
Never include product records, product IDs, prices, or other catalog facts in the intent plan.
Product data is fetched and validated separately by deterministic application code.`;

async function defaultGenerate({ model, ...options }: IntentPlanGenerationOptions): Promise<unknown> {
  const result = await generateText({
    model,
    output: Output.object({
      schema: extractedTurnPlanSchema,
      name: 'shopping_intent_plan',
      description: 'A validated single-agent plan containing separate shopping intents.',
    }),
    ...options,
  });
  return result.output;
}

export function createProviderIntentExtractor(options: ProviderIntentExtractorOptions): IntentExtractor {
  if (options.environment.AI_PROVIDER === 'disabled') {
    throw new AgentBoundaryError(
      'provider_authentication',
      'A model provider must be explicitly enabled with a server-side credential.',
      false,
    );
  }
  if (options.environment.AI_PROVIDER === 'openai'
    && (!options.environment.OPENAI_API_KEY || options.environment.OPENAI_MODEL !== COMMERCE_MODEL)) {
    throw new AgentBoundaryError('provider_authentication', 'OpenAI configuration is invalid.', false);
  }
  if (options.environment.AI_PROVIDER === 'litellm'
    && (!options.environment.LITELLM_API_KEY
      || options.environment.LITELLM_MODEL !== 'qwen3.5-9b'
      || options.environment.LITELLM_BASE_URL !== 'http://127.0.0.1:4001/v1')) {
    throw new AgentBoundaryError('provider_authentication', 'LiteLLM configuration is invalid.', false);
  }
  const modelFactory = options.modelFactory ?? createProviderModel;
  const model = options.environment.AI_PROVIDER === 'openai'
    ? modelFactory(options.environment.OPENAI_MODEL, options.environment.OPENAI_API_KEY!)
    : modelFactory(
      options.environment.LITELLM_MODEL,
      options.environment.LITELLM_API_KEY!,
      options.environment.LITELLM_BASE_URL,
      'chat',
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
        ...(options.environment.AI_PROVIDER === 'litellm' ? {
          maxOutputTokens: 1000,
          providerOptions: { openai: { reasoningEffort: 'none' as const } },
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
      if (error instanceof AgentBoundaryError) throw error;
      if (error && typeof error === 'object' && 'issues' in error) throw error;
      throw toProviderAgentError(error);
    }
  };
}
