import { createOpenAI } from '@ai-sdk/openai';
import { generateText, Output, type LanguageModel } from 'ai';
import { AgentBoundaryError, COMMERCE_MODEL } from '../agent';
import { toProviderAgentError } from '../agent/errors';
import type { Environment } from '../config/environment';
import { extractedTurnPlanSchema, type IntentExtractor } from './contracts';

type IntentPlanGenerationOptions = {
  model: LanguageModel;
  instructions: string;
  prompt: string;
};

export type IntentPlanGenerator = (options: IntentPlanGenerationOptions) => Promise<unknown>;

export type ProviderIntentExtractorOptions = {
  environment: Environment;
  generate?: IntentPlanGenerator;
  modelFactory?: (modelId: string, apiKey: string, baseURL?: string) => LanguageModel;
};

const instructions = `Extract one or more shopping intents from the shopper turn.
Return only the requested structured object. Preserve supplied intent IDs when refining prior state.
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
  const providerConfig = options.environment.AI_PROVIDER === 'openai'
    ? { modelId: options.environment.OPENAI_MODEL, apiKey: options.environment.OPENAI_API_KEY, baseURL: undefined }
    : { modelId: options.environment.LITELLM_MODEL, apiKey: options.environment.LITELLM_API_KEY, baseURL: options.environment.LITELLM_BASE_URL };
  if (!providerConfig.apiKey || !providerConfig.modelId || (options.environment.AI_PROVIDER === 'litellm' && !providerConfig.baseURL)) {
    throw new AgentBoundaryError('provider_authentication', 'The selected provider credential is unavailable.', false);
  }
  if (options.environment.AI_PROVIDER === 'openai' && providerConfig.modelId !== COMMERCE_MODEL) {
    throw new AgentBoundaryError('provider_authentication', 'Silent OpenAI model substitution is not allowed.', false);
  }
  const modelFactory = options.modelFactory ?? ((modelId, apiKey, baseURL) => {
    const provider = createOpenAI({ apiKey, baseURL, name: baseURL ? 'litellm' : 'openai' });
    return baseURL ? provider.chat(modelId) : provider(modelId);
  });
  const model = modelFactory(providerConfig.modelId, providerConfig.apiKey, providerConfig.baseURL);
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
      });
      return extractedTurnPlanSchema.parse(generated);
    } catch (error) {
      if (error instanceof AgentBoundaryError) throw error;
      if (error && typeof error === 'object' && 'issues' in error) throw error;
      throw toProviderAgentError(error);
    }
  };
}
