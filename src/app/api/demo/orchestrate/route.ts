import { NextResponse } from 'next/server';
import { runDemoOrchestration } from '@/lib/demo/orchestration';
import { orchestrationRequestSchema, orchestrationResponseSchema } from '@/lib/orchestration/http';

export async function POST(request: Request) {
  const parsed = orchestrationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'invalid_request', message: 'A valid shopper prompt is required.' } }, { status: 400 });
  }
  try {
    const result = await runDemoOrchestration(parsed.data);
    return NextResponse.json(orchestrationResponseSchema.parse({ mode: 'demo', result }));
  } catch {
    return NextResponse.json({ error: { code: 'demo_failed', message: 'The deterministic demo could not complete this turn.' } }, { status: 500 });
  }
}
