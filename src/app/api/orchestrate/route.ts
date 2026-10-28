import { NextResponse } from 'next/server';
import { AgentBoundaryError } from '@/lib/agent';
import { conversationStateSchema, orchestrationRequestSchema, orchestrationResponseSchema } from '@/lib/orchestration/http';
import { OrchestrationError } from '@/lib/orchestration/orchestrator';
import { createSafeDiagnostic, normalizeSafeDiagnostic, type DiagnosticStage, type SafeDiagnostic } from '@/lib/diagnostics/provider-diagnostic';
import { PersistenceConflictError } from '@/lib/persistence';
import {
  ConversationNotFoundError,
  getConversationExecutionService,
  PersistedExecutionError,
  type ConversationExecutionService,
} from '@/lib/execution';

function errorResponse(
  error: { code: string; message: string; retryable?: boolean },
  status: number,
  cause: unknown,
  stage: DiagnosticStage,
  diagnostic?: SafeDiagnostic,
) {
  return NextResponse.json({
    error,
    ...(process.env.NODE_ENV === 'development'
      ? { diagnostic: normalizeSafeDiagnostic(diagnostic) ?? createSafeDiagnostic(cause, stage) }
      : {}),
  }, { status });
}

export function createPostHandler(service: Pick<ConversationExecutionService, 'execute'>) {
  return async function post(request: Request) {
    const parsed = orchestrationRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(
        { code: 'invalid_request', message: 'A valid shopper prompt is required.' },
        400,
        parsed.error,
        'request_validation',
      );
    }
    try {
      const result = await service.execute(parsed.data);
      try {
        return NextResponse.json(orchestrationResponseSchema.parse({ result }));
      } catch (error) {
        return errorResponse(
          { code: 'orchestration_failed', message: 'The shopping turn could not be completed.', retryable: false },
          500,
          error,
          'response_serialization',
        );
      }
    } catch (error) {
      if (AgentBoundaryError.isInstance(error)) {
        const status = error.code === 'provider_authentication'
          ? 503
          : error.code === 'provider_unavailable' || error.code === 'provider_rate_limit' || error.retryable
            ? 502
            : 400;
        const stage: DiagnosticStage = error.code === 'invalid_tool_output' ? 'provider_output_validation' : 'provider_request';
        return errorResponse(
          { code: error.code, message: error.message, retryable: error.retryable },
          status,
          error,
          stage,
          error.diagnostic,
        );
      }
      if (error instanceof OrchestrationError) {
        return errorResponse({ code: error.code, message: error.message, retryable: false }, 400, error, 'execution');
      }
      if (PersistedExecutionError.isInstance(error)) {
        const status = error.code === 'provider_authentication'
          ? 503
          : error.code === 'provider_unavailable' || error.code === 'provider_rate_limit' || error.retryable
            ? 502
            : 500;
        return errorResponse({ code: error.code, message: error.message, retryable: error.retryable }, status, error, 'persistence');
      }
      return errorResponse(
        { code: 'orchestration_failed', message: 'The shopping turn could not be completed.', retryable: false },
        500,
        error,
        error instanceof PersistenceConflictError ? 'persistence' : 'execution',
      );
    }
  };
}

export async function POST(request: Request) {
  return createPostHandler(getConversationExecutionService())(request);
}

export function createGetHandler(service: Pick<ConversationExecutionService, 'readConversation'>) {
  return async function get(request: Request) {
    const conversationId = new URL(request.url).searchParams.get('conversationId')?.trim();
    if (!conversationId) {
      return errorResponse({ code: 'invalid_request', message: 'A conversation ID is required.' }, 400, undefined, 'request_validation');
    }
    try {
      const state = service.readConversation(conversationId);
      try {
        return NextResponse.json(conversationStateSchema.parse(state));
      } catch (error) {
        return errorResponse({ code: 'conversation_read_failed', message: 'The conversation could not be loaded.' }, 500, error, 'response_serialization');
      }
    } catch (error) {
      if (error instanceof ConversationNotFoundError) {
        return errorResponse({ code: 'conversation_not_found', message: 'Conversation not found.' }, 404, error, 'persistence');
      }
      return errorResponse({ code: 'conversation_read_failed', message: 'The conversation could not be loaded.' }, 500, error, 'persistence');
    }
  };
}

export async function GET(request: Request) {
  return createGetHandler(getConversationExecutionService())(request);
}
