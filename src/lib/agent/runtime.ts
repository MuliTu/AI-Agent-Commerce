import { createOpenAI } from '@ai-sdk/openai';
import { generateText, stepCountIs, type LanguageModel, type StopCondition, type ToolSet } from 'ai';
import type { Environment } from '../config/environment';
import type { AgentCatalogClient } from './tools';
import { createCatalogTools } from './tools';
import { AgentBoundaryError, toProviderAgentError } from './errors';
import { agentPromptSchema, agentTextOutputSchema } from './contracts';

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
  modelFactory?: (modelId: typeof COMMERCE_MODEL, apiKey: string) => LanguageModel;
};

export function createCommerceAgent(options: CommerceAgentOptions) {
  if (options.environment.AI_PROVIDER !== 'openai' || !options.environment.OPENAI_API_KEY) {
    throw new AgentBoundaryError(
      'provider_authentication',
      'OpenAI must be explicitly enabled with a server-side credential.',
      false,
    );
  }
  if (options.environment.OPENAI_MODEL !== COMMERCE_MODEL) {
    throw new AgentBoundaryError('provider_authentication', 'Silent model substitution is not allowed.', false);
  }

  const modelFactory = options.modelFactory ?? ((modelId, apiKey) => createOpenAI({ apiKey })(modelId));
  const generator = options.generate ?? generateText;
  const model = modelFactory(COMMERCE_MODEL, options.environment.OPENAI_API_KEY);
  const tools = createCatalogTools(options.catalog);

  return {
    modelId: COMMERCE_MODEL,
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
