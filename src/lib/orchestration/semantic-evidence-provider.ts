import { generateText, Output, type LanguageModel } from 'ai';
import { AgentBoundaryError } from '../agent';
import { toProviderAgentError } from '../agent/errors';
import { createProviderModel, type ModelFactory } from '../agent/model';
import { isProviderConfigured, type Environment } from '../config/environment';
import { SEMANTIC_EVIDENCE_SYSTEM_PROMPT } from '../ai/prompts';
import {
  semanticEvidenceBatchSchema,
  type SemanticEvidenceEvaluator,
  type SemanticEvidenceInput,
} from './semantic-evidence';

type SemanticEvidenceGenerationOptions = {
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

export type SemanticEvidenceGenerator = (options: SemanticEvidenceGenerationOptions) => Promise<unknown>;

export type ProviderSemanticEvidenceEvaluatorOptions = {
  environment: Environment;
  generate?: SemanticEvidenceGenerator;
  modelFactory?: ModelFactory;
};

async function defaultGenerate({ model, ...options }: SemanticEvidenceGenerationOptions): Promise<unknown> {
  const result = await generateText({
    model,
    output: Output.object({
      schema: semanticEvidenceBatchSchema,
      name: 'catalog_semantic_evidence',
      description: 'Conservative evidence verdicts grounded in exact trusted catalog spans.',
    }),
    ...options,
  });
  return result.output;
}

function providerPrompt(input: SemanticEvidenceInput): string {
  return JSON.stringify({
    requirements: input.requirements.map(({ label }) => label),
    products: input.products.map(({ id, title, description, tags }) => ({ id, title, description, tags })),
  });
}

export function createProviderSemanticEvidenceEvaluator(
  options: ProviderSemanticEvidenceEvaluatorOptions,
): SemanticEvidenceEvaluator {
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

  return async (input) => {
    try {
      return await generator({
        model,
        instructions: SEMANTIC_EVIDENCE_SYSTEM_PROMPT,
        prompt: providerPrompt(input),
        maxRetries: 0,
        providerOptions: {
          openai: {
            strictJsonSchema: options.environment.LLM_PROVIDER !== 'litellm',
            ...(options.environment.LLM_PROVIDER === 'litellm' ? { reasoningEffort: 'none' as const } : {}),
          },
        },
        ...(options.environment.LLM_PROVIDER === 'litellm' ? { maxOutputTokens: 1600 } : {}),
      });
    } catch (error) {
      if (AgentBoundaryError.isInstance(error)) throw error;
      throw toProviderAgentError(error);
    }
  };
}
