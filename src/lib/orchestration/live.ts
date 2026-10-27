import { DummyJsonCatalogClient } from '../catalog';
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
  const environment = parseEnvironment(process.env);
  const extractIntents = createProviderIntentExtractor({ environment });
  const catalog = new DummyJsonCatalogClient();
  return createIntentOrchestrator({ catalog, extractIntents }).run(input);
}
