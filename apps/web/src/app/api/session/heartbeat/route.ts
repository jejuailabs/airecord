import { NextResponse } from 'next/server';
import {
  sessionHeartbeatRequestSchema,
  type SessionHeartbeatResponse,
} from '@sotong/shared/schemas';
import { heartbeat, saveSegments } from '@/lib/server/session-store';
import { consumeChars, guestKey } from '@/lib/server/guest-quota';

export const runtime = 'nodejs';

/**
 * 10초 주기 하트비트 (docs/01 §4.1, docs/07 §5.1).
 * 서버 자체 시계로 누적하고, 캡 초과 시 terminate를 내려보낸다.
 * 확정 세그먼트 배치를 함께 저장한다 (개별 쓰기 금지 — docs/03 §3).
 */
export async function POST(req: Request) {
  const parsed = sessionHeartbeatRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { sessionId, segments, trial } = parsed.data;

  if (trial) {
    // 비회원 월 한도에 번역 글자수를 누적한다 (클라이언트 카운터만 믿지 않는다)
    const chars = segments.reduce((sum, s) => sum + s.targetText.length, 0);
    consumeChars(guestKey(req), chars);
  } else {
    // 저장 실패가 통역을 멈추면 안 된다 — 내부에서 삼킨다 (docs/01 §6)
    await saveSegments(sessionId, segments);
  }

  const result = heartbeat(sessionId, segments.length);
  if (!result) {
    // 세션이 없거나 이미 종료 — 클라이언트는 정리 수순으로
    const body: SessionHeartbeatResponse = { terminate: true, remainingSec: 0 };
    return NextResponse.json(body);
  }
  const body: SessionHeartbeatResponse = result;
  return NextResponse.json(body);
}
