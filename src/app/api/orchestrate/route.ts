import { NextResponse } from 'next/server';
import { AgentBoundaryError } from '@/lib/agent';
import { orchestrationRequestSchema, orchestrationResponseSchema } from '@/lib/orchestration/http';
import { OrchestrationError } from '@/lib/orchestration/orchestrator';
import { runLiveOrchestration } from '@/lib/orchestration/live';

export async function POST(request: Request) {
  const parsed = orchestrationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'invalid_request', message: 'A valid shopper prompt is required.' } }, { status: 400 });
  }
  try {
    const result = await runLiveOrchestration(parsed.data);
    return NextResponse.json(orchestrationResponseSchema.parse({ result }));
  } catch (error) {
    if (error instanceof AgentBoundaryError) {
      const status = error.code === 'provider_authentication' ? 503 : error.retryable ? 502 : 400;
      return NextResponse.json({ error: { code: error.code, message: error.message, retryable: error.retryable } }, { status });
    }
    if (error instanceof OrchestrationError) {
      return NextResponse.json({ error: { code: error.code, message: error.message, retryable: false } }, { status: 400 });
    }
    return NextResponse.json({ error: { code: 'orchestration_failed', message: 'The shopping turn could not be completed.', retryable: false } }, { status: 500 });
  }
}
