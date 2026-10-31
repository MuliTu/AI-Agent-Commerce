import { DummyJsonCatalogClient } from '../catalog';
import { AgentBoundaryError } from '../agent';
import { parseEnvironment } from '../config/environment';
import { createIntentOrchestrator } from './orchestrator';
import { createProviderIntentExtractor } from './provider';
import { createProviderSemanticEvidenceEvaluator } from './semantic-evidence-provider';
import type { SemanticEvidenceReport } from './semantic-evidence';
import type { OrchestrationResult } from './contracts';
import type { ClarificationAnswer } from './contracts';

export async function runLiveOrchestration(input: {
  turnId: string;
  conversationId: string;
  prompt: string;
  previous?: OrchestrationResult;
  clarification?: ClarificationAnswer;
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
  const semanticEvidenceEvaluator = createProviderSemanticEvidenceEvaluator({ environment });
  const catalog = new DummyJsonCatalogClient();
  return createIntentOrchestrator({
    catalog,
    extractIntents,
    semanticEvidenceEvaluator,
    observeSemanticEvidence: (report: SemanticEvidenceReport) => {
      if (process.env.NODE_ENV === 'test') return;
      const summary = report.status === 'completed'
        ? {
            status: report.status,
            assessmentCount: report.assessments.length,
            verdicts: report.assessments.reduce<Record<string, number>>((counts, assessment) => ({
              ...counts,
              [assessment.verdict]: (counts[assessment.verdict] ?? 0) + 1,
            }), {}),
          }
        : report;
      console.info('semantic_evidence_rerank', JSON.stringify(summary));
    },
  }).run(input);
}
