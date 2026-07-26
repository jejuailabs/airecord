import { NextResponse } from 'next/server';
import { sessionEndRequestSchema, type SessionEndResponse } from '@sotong/shared/schemas';
import { endSession } from '@/lib/server/session-store';

export const runtime = 'nodejs';

/** 세션 종료 → 최종 분 확정 (docs/01 §4.1 [7]) */
export async function POST(req: Request) {
  const parsed = sessionEndRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const result = endSession(parsed.data.sessionId, parsed.data.reason);
  if (!result) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const body: SessionEndResponse = result;
  return NextResponse.json(body);
}
