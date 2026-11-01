import { createHash } from 'node:crypto';
import type { OrchestrationResult } from '../orchestration/contracts';

export type ServerDiagnosticLevel = 'off' | 'summary' | 'verbose';

export type OrchestrationDecisionDiagnostic =
  | {
      stage: 'semantic_action_plan';
      operations: Array<{ index: number; op: string; targetKind: 'intent' | 'reference' | 'draft' | 'none' }>;
      priceSemantics: string[];
    }
  | {
      stage: 'catalog_boundary';
      operation: string;
      attempt: number;
      method: 'GET';
      pathname: string;
      query: Record<string, string>;
      status: number | null;
      durationMs: number;
      products: Array<{ id: number; price: number }>;
      errorCode?: string;
    }
  | {
      stage: 'intent_interpretation';
      intents: Array<{
        intentId: string;
        status: string;
        category?: string;
        constraintKeys: string[];
      }>;
    }
  | {
      stage: 'follow_up_target';
      previousIntentCount: number;
      previousCategories: string[];
      constraintOnly: boolean;
      additiveNamedRequest: boolean;
      decision: 'not_refinement' | 'single' | 'all' | 'clarify';
      targetCount: number;
    }
  | {
      stage: 'catalog_search';
      intentId: string;
      category?: string;
      filters: {
        maxPrice?: number;
        minRating?: number;
        inStock?: boolean;
        brands?: string[];
        sort?: 'price_asc';
      };
    };

type DiagnosticEnvironment = Record<string, string | undefined>;
type DiagnosticWriter = (line: string) => void;

function hash(value: string, length = 12): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}

function language(value: string): 'en' | 'he' | 'unknown' {
  if (/[\u0590-\u05ff]/u.test(value)) return 'he';
  if (/[a-z]/iu.test(value)) return 'en';
  return 'unknown';
}

function redact(value: string): string {
  return value
    .replace(/\bBearer\s+\S+/giu, 'Bearer [REDACTED]')
    .replace(/\bsk-[a-z0-9_-]{8,}\b/giu, '[REDACTED]')
    .replace(/\b(api[ _-]?key|password|secret|token)\s*[:=]\s*\S+/giu, '$1=[REDACTED]')
    .replace(/\s+/gu, ' ')
    .trim();
}

function bounded(value: string, limit: number): string {
  return redact(value).slice(0, limit);
}

function diagnosticCatalogQuery(query: Record<string, string>, level: ServerDiagnosticLevel): Record<string, unknown> {
  const safeExactKeys = new Set(['limit', 'skip', 'sortBy', 'order', 'select']);
  return Object.fromEntries(Object.entries(query).map(([key, value]) => {
    if (safeExactKeys.has(key)) return [key, value];
    return [key, {
      length: value.length,
      hash: hash(value),
      ...(level === 'verbose' ? { text: bounded(value, 200) } : {}),
    }];
  }));
}

export function serverDiagnosticLevel(environment: DiagnosticEnvironment): ServerDiagnosticLevel {
  if (environment.NODE_ENV === 'production') return 'off';
  const configured = environment.BAZAK_SERVER_DIAGNOSTICS?.trim().toLocaleLowerCase('en-US');
  return configured === 'summary' || configured === 'verbose' ? configured : 'off';
}

export function createServerDiagnosticReporter(input: {
  conversationId: string;
  turnId: string;
  environment?: DiagnosticEnvironment;
  write?: DiagnosticWriter;
}) {
  const environment = input.environment ?? process.env;
  const level = serverDiagnosticLevel(environment);
  const traceId = hash(`${input.conversationId}\u0000${input.turnId}`);
  const write = input.write ?? ((line: string) => console.info(line));
  const emit = (event: Record<string, unknown>) => {
    if (level === 'off') return;
    write(`bazak_server_diagnostic ${JSON.stringify({ traceId, ...event })}`);
  };
  return {
    level,
    traceId,
    request(prompt: string, metadata: { retryIntentId?: string; hasClarification: boolean }) {
      emit({
        stage: 'request_received',
        prompt: {
          length: prompt.length,
          language: language(prompt),
          hash: hash(prompt),
          ...(level === 'verbose' ? { text: bounded(prompt, 500) } : {}),
        },
        retry: metadata.retryIntentId !== undefined,
        clarification: metadata.hasClarification,
      });
    },
    decision(event: OrchestrationDecisionDiagnostic) {
      if (event.stage === 'intent_interpretation') {
        emit({
          ...event,
          intents: event.intents.map((intent) => ({ ...intent, intentId: hash(intent.intentId, 10) })),
        });
        return;
      }
      if (event.stage === 'catalog_search') {
        emit({ ...event, intentId: hash(event.intentId, 10) });
        return;
      }
      if (event.stage === 'catalog_boundary') {
        emit({ ...event, query: diagnosticCatalogQuery(event.query, level) });
        return;
      }
      emit(event);
    },
    result(result: OrchestrationResult) {
      emit({
        stage: 'result_completed',
        status: result.status,
        outcomeCount: result.outcomes.length,
        outcomes: result.outcomes.map((outcome) => ({
          intentId: hash(outcome.intent.id, 10),
          status: outcome.intent.status,
          category: outcome.intent.constraints.category,
          filters: {
            maxPrice: outcome.intent.constraints.maxPrice,
            minRating: outcome.intent.constraints.minRating,
            inStock: outcome.intent.constraints.inStock,
            brands: outcome.intent.constraints.brands,
            sort: outcome.intent.constraints.sort,
          },
          productCount: outcome.products.length,
          productIds: outcome.products.map(({ product }) => product.id),
          ...(level === 'verbose' ? {
            products: outcome.products.map(({ product, semanticRelevance }) => ({
              id: product.id,
              title: bounded(product.title, 120),
              price: product.price,
              tier: semanticRelevance?.tier,
            })),
          } : {}),
          clarification: outcome.clarification?.field,
          errorCode: outcome.error?.code,
        })),
      });
    },
    error(stage: string, error: { code?: string; name?: string }) {
      emit({
        stage: 'request_failed',
        decisionStage: bounded(stage, 64),
        error: { code: error.code, name: error.name },
      });
    },
  };
}
