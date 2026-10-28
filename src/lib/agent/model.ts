import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

export type ModelTransport = 'responses' | 'chat';

export type ModelFactory = (
  modelId: string,
  apiKey: string,
  baseURL?: string,
  transport?: ModelTransport,
) => LanguageModel;

export const createProviderModel: ModelFactory = (
  modelId,
  apiKey,
  baseURL,
  transport = 'responses',
) => {
  const provider = createOpenAI({ apiKey, baseURL });
  return transport === 'chat' ? provider.chat(modelId) : provider(modelId);
};
