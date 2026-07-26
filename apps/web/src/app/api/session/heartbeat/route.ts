import { NextResponse } from 'next/server';
import {
  sessionHeartbeatRequestSchema,
  type SessionHeartbeatResponse,
} from '@sotong/shared/schemas';
import { heartbeat } from '@/lib/server/session-store';

export const runtime = 'nodejs';

/**
 * 10초 주기 하트비트 (docs/01 §4.1, docs/07 §5.1).
 * 서버 자체 시계로 누적하고, 캡 초과 시 terminate를 내려보낸다.
 * 확정 세그먼트 배치가 함께 온다 — Phase 1은 개수만 계수, Phase 2에서 Firestore 배치 기록.
 */
export async function POST(req: Request) {
  const parsed = sessionHeartbeatRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { sessionId, segments } = parsed.data;

  const result = heartbeat(sessionId, segments.length);
  if (!result) {
    // 세션이 없거나 이미 종료 — 클라이언트는 정리 수순으로
    const body: SessionHeartbeatResponse = { terminate: true, remainingSec: 0 };
    return NextResponse.json(body);
  }
  const body: SessionHeartbeatResponse = result;
  return NextResponse.json(body);
}
