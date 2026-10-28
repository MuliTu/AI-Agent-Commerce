import { DummyJsonCatalogClient } from '../catalog';
import { AgentBoundaryError } from '../agent';
import { parseEnvironment } from '../config/environment';
import { createIntentOrchestrator } from './orchestrator';
import { createProviderIntentExtractor } from './provider';
import type { OrchestrationResult } from './contracts';

export async function runLiveOrchestration(input: {
  turnId: string;
  conversationId: string;
  prompt: string;
  previous?: OrchestrationResult;
}): Promise<OrchestrationResult> {
  let environment;
  try {
    environment = parseEnvironment(process.env);
  } catch {
    throw new AgentBoundaryError(
      'provider_authentication',
      'The model provider is not configured correctly.',
      false,
    );
  }
  const extractIntents = createProviderIntentExtractor({ environment });
  const catalog = new DummyJsonCatalogClient();
  return createIntentOrchestrator({ catalog, extractIntents }).run(input);
}
