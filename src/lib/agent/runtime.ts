import { generateText, stepCountIs, type LanguageModel, type StopCondition, type ToolSet } from 'ai';
import { isProviderConfigured, type Environment } from '../config/environment';
import type { AgentCatalogClient } from './tools';
import { createCatalogTools } from './tools';
import { AgentBoundaryError, toProviderAgentError } from './errors';
import { agentPromptSchema, agentTextOutputSchema } from './contracts';
import { createProviderModel, type ModelFactory } from './model';
import { COMMERCE_AGENT_SYSTEM_PROMPT } from '../ai/prompts';

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
  if (!isProviderConfigured(options.environment)) {
    throw new AgentBoundaryError(
      'provider_authentication',
      'A model provider must be explicitly enabled with a server-side credential.',
      false,
    );
  }
  const modelFactory = options.modelFactory ?? createProviderModel;
  const generator = options.generate ?? generateText;
  const modelId = options.environment.LLM_MODEL;
  const model = modelFactory(
    modelId,
    options.environment.LLM_API_KEY,
    options.environment.LLM_BASE_URL,
    options.environment.LLM_PROVIDER === 'litellm' ? 'chat' : 'responses',
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
          instructions: COMMERCE_AGENT_SYSTEM_PROMPT,
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
