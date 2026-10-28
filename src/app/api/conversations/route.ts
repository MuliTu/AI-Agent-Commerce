import { NextResponse } from 'next/server';
import { getConversationExecutionService, type ConversationExecutionService } from '@/lib/execution';
import { conversationListSchema, conversationMutationSchema, conversationSummarySchema } from '@/lib/orchestration/http';

type ConversationManager = Pick<ConversationExecutionService,
  'listConversations' | 'renameConversation' | 'archiveConversation' | 'restoreConversation'>;

export function createConversationsGetHandler(service: Pick<ConversationManager, 'listConversations'>) {
  return async function get() {
    return NextResponse.json(conversationListSchema.parse({ conversations: service.listConversations() }));
  };
}

export function createConversationsPatchHandler(service: ConversationManager) {
  return async function patch(request: Request) {
    const conversationId = new URL(request.url).searchParams.get('conversationId')?.trim();
    const mutation = conversationMutationSchema.safeParse(await request.json().catch(() => null));
    if (!conversationId || !mutation.success) {
      return NextResponse.json({ error: { code: 'invalid_request', message: 'A valid conversation mutation is required.' } }, { status: 400 });
    }
    try {
      const conversation = mutation.data.action === 'rename'
        ? service.renameConversation(conversationId, mutation.data.title)
        : mutation.data.action === 'archive'
          ? service.archiveConversation(conversationId)
          : service.restoreConversation(conversationId);
      return NextResponse.json({ conversation: conversationSummarySchema.parse(conversation) });
    } catch {
      return NextResponse.json({ error: { code: 'conversation_update_failed', message: 'The conversation could not be updated.' } }, { status: 409 });
    }
  };
}

const service = () => getConversationExecutionService();
export async function GET() { return createConversationsGetHandler(service())(); }
export async function PATCH(request: Request) { return createConversationsPatchHandler(service())(request); }
