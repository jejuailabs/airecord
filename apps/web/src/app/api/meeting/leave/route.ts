import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { leaveBot } from '@sotong/shared/meeting/recall';
import { endSession, getSession, finalizeSessionDoc } from '@/lib/server/session-store';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { revokeViewerToken } from '@/lib/server/viewer';

export const runtime = 'nodejs';

const bodySchema = z.object({ sessionId: z.string().min(1), botId: z.string().min(1) });

/**
 * 회의 봇 퇴장.
 *
 * ⚠ 봇을 먼저 내보낸다. 세션만 닫고 봇을 남기면 **회의에 계속 앉아 초당 과금된다**
 *   ($0.50/시간, docs/07 §1.2). 분은 곧 돈이다 (core.md §3-6).
 *
 * 뷰어 토큰도 함께 폐기한다 — 회의가 끝난 링크가 계속 열려 있으면 안 된다 (docs/08 §2.2).
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { sessionId, botId } = parsed.data;

  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie).catch(() => null);
  if (!user) {
    return NextResponse.json({ error: 'auth_required' }, { status: 401 });
  }

  // 남의 세션을 끊을 수는 없다
  const s = await getSession(sessionId);
  if (!s || s.uid !== user.uid) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // 봇 퇴장이 실패해도 세션 정리는 계속한다 — 실패를 그대로 두면 과금이 계속된다
  let botLeft = true;
  try {
    await leaveBot(botId);
  } catch (e) {
    botLeft = false;
    console.error('[meeting/leave] leaveBot failed', e instanceof Error ? e.message : e);
  }

  const result = await endSession(sessionId, 'user');
  if (result) await finalizeSessionDoc(result.record);
  await revokeViewerToken(sessionId).catch(() => null);

  return NextResponse.json({
    billedSeconds: result?.billedSeconds ?? 0,
    segmentCount: result?.segmentCount ?? 0,
    botLeft,
  });
}
