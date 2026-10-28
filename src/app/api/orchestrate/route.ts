import { NextResponse } from 'next/server';
import { AgentBoundaryError } from '@/lib/agent';
import { conversationStateSchema, orchestrationRequestSchema, orchestrationResponseSchema } from '@/lib/orchestration/http';
import { OrchestrationError } from '@/lib/orchestration/orchestrator';
import {
  ConversationNotFoundError,
  getConversationExecutionService,
  PersistedExecutionError,
  type ConversationExecutionService,
} from '@/lib/execution';

export function createPostHandler(service: Pick<ConversationExecutionService, 'execute'>) {
  return async function post(request: Request) {
    const parsed = orchestrationRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: { code: 'invalid_request', message: 'A valid shopper prompt is required.' } }, { status: 400 });
    }
    try {
      const result = await service.execute(parsed.data);
      return NextResponse.json(orchestrationResponseSchema.parse({ result }));
    } catch (error) {
      if (error instanceof AgentBoundaryError) {
        const status = error.code === 'provider_authentication' ? 503 : error.retryable ? 502 : 400;
        return NextResponse.json({ error: { code: error.code, message: error.message, retryable: error.retryable } }, { status });
      }
      if (error instanceof OrchestrationError) {
        return NextResponse.json({ error: { code: error.code, message: error.message, retryable: false } }, { status: 400 });
      }
      if (error instanceof PersistedExecutionError) {
        const status = error.code === 'provider_authentication' ? 503 : error.retryable ? 502 : 500;
        return NextResponse.json({ error: { code: error.code, message: error.message, retryable: error.retryable } }, { status });
      }
      return NextResponse.json({ error: { code: 'orchestration_failed', message: 'The shopping turn could not be completed.', retryable: false } }, { status: 500 });
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
      return NextResponse.json({ error: { code: 'invalid_request', message: 'A conversation ID is required.' } }, { status: 400 });
    }
    try {
      return NextResponse.json(conversationStateSchema.parse(service.readConversation(conversationId)));
    } catch (error) {
      if (error instanceof ConversationNotFoundError) {
        return NextResponse.json({ error: { code: 'conversation_not_found', message: 'Conversation not found.' } }, { status: 404 });
      }
      return NextResponse.json({ error: { code: 'conversation_read_failed', message: 'The conversation could not be loaded.' } }, { status: 500 });
    }
  };
}

export async function GET(request: Request) {
  return createGetHandler(getConversationExecutionService())(request);
}
