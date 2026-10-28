import { generateText, stepCountIs, type LanguageModel, type StopCondition, type ToolSet } from 'ai';
import type { Environment } from '../config/environment';
import type { AgentCatalogClient } from './tools';
import { createCatalogTools } from './tools';
import { AgentBoundaryError, toProviderAgentError } from './errors';
import { agentPromptSchema, agentTextOutputSchema } from './contracts';
import { createProviderModel, type ModelFactory } from './model';

export const COMMERCE_MODEL = 'gpt-5.4-mini' as const;
export const MAX_TOOL_STEPS = 5;

type AgentGenerationOptions = {
  model: LanguageModel;
  tools: ToolSet;
  stopWhen: StopCondition<ToolSet>;
  instructions: string;
  prompt: string;
};

export type AgentTextGenerator = (options: AgentGenerationOptions) => Promise<{ text: string }>;

export type CommerceAgentOptions = {
  environment: Environment;
  catalog: AgentCatalogClient;
  generate?: AgentTextGenerator;
  modelFactory?: ModelFactory;
};

export function createCommerceAgent(options: CommerceAgentOptions) {
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
  const generator = options.generate ?? generateText;
  const modelId = options.environment.AI_PROVIDER === 'openai'
    ? options.environment.OPENAI_MODEL
    : options.environment.LITELLM_MODEL;
  const model = options.environment.AI_PROVIDER === 'openai'
    ? modelFactory(modelId, options.environment.OPENAI_API_KEY!)
    : modelFactory(
      modelId,
      options.environment.LITELLM_API_KEY!,
      options.environment.LITELLM_BASE_URL,
      'chat',
    );
  const tools = createCatalogTools(options.catalog);

  return {
    modelId,
    maxToolSteps: MAX_TOOL_STEPS,
    tools,
    async generate(prompt: string): Promise<string> {
      const promptResult = agentPromptSchema.safeParse(prompt);
      if (!promptResult.success) {
        throw new AgentBoundaryError('invalid_tool_output', 'A nonempty shopper prompt is required.', false);
      }
      try {
        const result = await generator({
          model,
          tools,
          stopWhen: stepCountIs(MAX_TOOL_STEPS),
          instructions: 'Use only the supplied catalog tools for product facts and IDs. Never invent products.',
          prompt: promptResult.data,
        });
        const outputResult = agentTextOutputSchema.safeParse(result);
        if (!outputResult.success) {
          throw new AgentBoundaryError(
            'invalid_tool_output',
            'The model provider returned an invalid text response.',
            false,
          );
        }
        return outputResult.data.text;
      } catch (error) {
        throw toProviderAgentError(error);
      }
    },
  };
}
