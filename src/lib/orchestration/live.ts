import { AsyncLocalStorage } from 'node:async_hooks';
import { DummyJsonCatalogClient } from '../catalog';
import { AgentBoundaryError } from '../agent';
import { parseEnvironment } from '../config/environment';
import { createIntentOrchestrator } from './orchestrator';
import { createProviderIntentExtractor } from './provider';
import { createProviderSemanticEvidenceEvaluator } from './semantic-evidence-provider';
import type { SemanticEvidenceReport } from './semantic-evidence';
import type { OrchestrationResult } from './contracts';
import type { ClarificationAnswer } from './contracts';
import { createServerDiagnosticReporter } from '../diagnostics/server-trace';
import type { OrchestrationDecisionDiagnostic } from '../diagnostics/server-trace';

export async function runLiveOrchestration(input: {
  turnId: string;
  conversationId: string;
  prompt: string;
  previous?: OrchestrationResult;
  pausedOutcomes?: OrchestrationResult['outcomes'];
  displayedProductReference?: import('./contracts').IntentExtractionContext['displayedProductReference'];
  clarification?: ClarificationAnswer;
  observeDecision?: (event: OrchestrationDecisionDiagnostic) => void;
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
  const serverDiagnostics = createServerDiagnosticReporter({
    conversationId: input.conversationId,
    turnId: input.turnId,
  });
  serverDiagnostics.context({
    previous: input.previous,
    pausedOutcomes: input.pausedOutcomes,
    hasDisplayedReference: input.displayedProductReference !== undefined,
  });
  const extractIntents = createProviderIntentExtractor({
    environment,
    observePlan: (summary) => serverDiagnostics.providerPlan({
      provider: environment.LLM_PROVIDER,
      model: environment.LLM_MODEL ?? 'unknown',
      summary,
    }),
  });
  const semanticEvidenceEvaluator = createProviderSemanticEvidenceEvaluator({ environment });
  const observeDecision = (event: OrchestrationDecisionDiagnostic) => {
    serverDiagnostics.decision(event);
    input.observeDecision?.(event);
  };
  const catalogAttempt = new AsyncLocalStorage<number>();
  const catalog = new DummyJsonCatalogClient({
    boundaryAttempt: () => catalogAttempt.getStore() ?? 1,
    observeBoundary: (event) => observeDecision({ stage: 'catalog_boundary', ...event }),
  });
  return createIntentOrchestrator({
    catalog,
    extractIntents,
    semanticEvidenceEvaluator,
    observeDecision,
    runCatalogAttempt: (attempt, operation) => catalogAttempt.run(attempt, operation),
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
