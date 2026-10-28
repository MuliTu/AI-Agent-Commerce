import { beforeEach, describe, expect, it, vi } from 'vitest';

const providerMocks = vi.hoisted(() => {
  const responsesModel = { transport: 'responses' };
  const chatModel = { transport: 'chat' };
  const responses = vi.fn(() => responsesModel);
  const chat = vi.fn(() => chatModel);
  Object.assign(responses, { chat });
  const createOpenAI = vi.fn(() => responses);

  return { chat, chatModel, createOpenAI, responses, responsesModel };
});

vi.mock('@ai-sdk/openai', () => ({ createOpenAI: providerMocks.createOpenAI }));

import { createProviderModel } from '../../src/lib/agent/model';

describe('createProviderModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the Responses transport by default for OpenAI', () => {
    const model = createProviderModel('gpt-5.4-mini', 'openai-test-key');

    expect(providerMocks.createOpenAI).toHaveBeenCalledWith({
      apiKey: 'openai-test-key',
      baseURL: undefined,
    });
    expect(providerMocks.responses).toHaveBeenCalledWith('gpt-5.4-mini');
    expect(providerMocks.chat).not.toHaveBeenCalled();
    expect(model).toBe(providerMocks.responsesModel);
  });

  it('uses the Chat Completions transport only when explicitly selected', () => {
    const model = createProviderModel(
      'qwen3.5-9b',
      'litellm-test-key',
      'http://127.0.0.1:4001/v1',
      'chat',
    );

    expect(providerMocks.createOpenAI).toHaveBeenCalledWith({
      apiKey: 'litellm-test-key',
      baseURL: 'http://127.0.0.1:4001/v1',
    });
    expect(providerMocks.chat).toHaveBeenCalledWith('qwen3.5-9b');
    expect(providerMocks.responses).not.toHaveBeenCalled();
    expect(model).toBe(providerMocks.chatModel);
  });
});
