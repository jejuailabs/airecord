import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { cookies } from 'next/headers';
import { leaveBot } from '@sotong/shared/meeting/recall';
import { adminDb, SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { endSession, getSession, finalizeSessionDoc } from '@/lib/server/session-store';
import { resolveViewerToken, revokeViewerToken } from '@/lib/server/viewer';
import { generateAndStoreSummary } from '@/lib/server/summarize';

export const runtime = 'nodejs';

/**
 * 뷰어 화면에서의 통역 종료 (사용자 지시 2026-08-02).
 *
 * 뷰어 링크는 공개지만 종료는 **세션 주인만** 할 수 있다 — 참가자가 남의 회의를
 * 끊으면 안 된다. 로그인 쿠키로 소유자를 확인한 뒤에만 진행한다.
 *
 * 회의 세션이면 봇을 먼저 내보낸다 — 세션만 닫고 봇을 남기면 초당 과금이 계속된다
 * (meeting/leave와 같은 순서, docs/07 §1.2).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie).catch(() => null);
  if (!user) {
    return NextResponse.json({ error: 'auth_required' }, { status: 401 });
  }

  const grant = await resolveViewerToken(token).catch(() => null);
  if (!grant) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 404 });
  }

  const record = await getSession(grant.sessionId);
  if (!record || record.uid !== user.uid) {
    // 없는 세션과 남의 세션을 구분해 주지 않는다
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // 회의 봇 퇴장 — botId는 liveSessions 문서에만 있다 (attachBotId)
  let botLeft = true;
  if (record.mode === 'meeting') {
    const botId = (
      await adminDb().collection('liveSessions').doc(grant.sessionId).get()
    ).get('botId') as string | undefined;
    if (botId) {
      try {
        await leaveBot(botId);
      } catch (e) {
        botLeft = false;
        console.error('[viewer/end] leaveBot failed', e instanceof Error ? e.message : e);
      }
    }
  }

  const result = await endSession(grant.sessionId, 'user');
  if (result) {
    await finalizeSessionDoc(result.record);
    // 회의도 대면처럼 제목·요약을 만든다 — 없으면 기록이 "요약 대기 중"으로 영영 남는다
    after(() => generateAndStoreSummary(grant.sessionId, result.record.targetLang));
  }
  await revokeViewerToken(grant.sessionId).catch(() => null);

  return NextResponse.json({
    billedSeconds: result?.billedSeconds ?? 0,
    segmentCount: result?.segmentCount ?? 0,
    botLeft,
  });
}
