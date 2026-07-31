import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { detectMeetingPlatform, meetingJoinRequestSchema } from '@sotong/shared/schemas';
import { relayWsUrl } from '@sotong/shared/meeting/relay-auth';
import { createBot } from '@sotong/shared/meeting/recall';
import { attachBotId, createSession, maxDurationSecFromEnv } from '@/lib/server/session-store';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { getEntitlement, sessionCapSeconds } from '@/lib/server/entitlement';
import { getEngine } from '@sotong/shared/engine';

export const runtime = 'nodejs';

/**
 * 모드 A — 회의 봇 입장 (docs/01 §4.2, docs/04 §4).
 *
 * 흐름:
 *   1. URL → platform 판별 (지원 안 하는 플랫폼이면 여기서 끝)
 *   2. 로그인·잔여 분 확인 (부족하면 402 — 분은 곧 돈이다, core.md §3-6)
 *   3. liveSessions/{id} 생성 + viewerTokens/{token} 생성
 *   4. Recall.ai 봇 생성 — 오디오 목적지 = wss://<worker>/relay/{id}?sig=...
 *   5. 봇이 입장 직후 회의 채팅에 자막 링크를 1회 게시
 *
 * ⚠ 봇 생성이 실패하면 세션을 즉시 닫는다. 안 닫으면 유령 세션이 하드 캡까지 살아 있다.
 * 자체 봇 개발은 금지 (core.md §3-4) — Recall.ai를 산다.
 */
export async function POST(req: Request) {
  const parsed = meetingJoinRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { url, sourceLang, targetLang } = parsed.data;

  const platform = detectMeetingPlatform(url);
  if (!platform) {
    return NextResponse.json({ error: 'unsupported_platform' }, { status: 400 });
  }

  const engine = getEngine();
  if (!engine.supports(sourceLang, targetLang)) {
    return NextResponse.json({ error: 'unsupported_pair' }, { status: 400 });
  }

  /**
   * 인프라가 안 붙었으면 정직하게 말한다.
   * RECALL_API_KEY는 유료 계정 키이고 WORKER_BASE_URL은 배포된 워커 주소다 — 둘 다 사람이 넣어야 한다.
   */
  const workerBase = process.env.WORKER_BASE_URL;
  const missing: string[] = [];
  if (!process.env.RECALL_API_KEY) missing.push('RECALL_API_KEY');
  if (!workerBase) missing.push('WORKER_BASE_URL');
  if (!process.env.WORKER_SHARED_SECRET) missing.push('WORKER_SHARED_SECRET');
  if (missing.length > 0) {
    return NextResponse.json({ error: 'infra_not_configured', missing, platform }, { status: 503 });
  }

  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie).catch(() => null);
  if (!user) {
    return NextResponse.json({ error: 'auth_required' }, { status: 401 });
  }

  // 남은 분을 실제로 검사한다 — 표시만 하고 막지 않으면 화면이 거짓말이 된다
  const ent = await getEntitlement(user.uid, user.email);
  if (!ent.canStart) {
    return NextResponse.json(
      { error: 'quota_exhausted', usedMinutes: ent.usedMinutes, includedMinutes: ent.includedMinutes },
      { status: 402 },
    );
  }

  const baseCapSec = Math.min(maxDurationSecFromEnv(), engine.capabilities.maxSessionSec);
  const maxDurationSec = sessionCapSeconds(ent, baseCapSec);
  const viewerToken = crypto.randomUUID().replace(/-/g, '');

  const record = await createSession({
    mode: 'meeting',
    maxDurationSec,
    sourceLang,
    targetLang,
    uid: user.uid,
    workspaceId: ent.workspaceId,
    viewerToken,
  });

  const origin = new URL(req.url).origin;
  const viewerUrl = `${origin}/v/${viewerToken}`;

  try {
    const { botId } = await createBot({
      meetingUrl: url,
      audioDestinationWs: relayWsUrl(workerBase!, record.id),
      // 참가자 목록에서 봇의 존재가 드러나야 한다 (docs/08 §2.2)
      botName: process.env.MEETING_BOT_NAME ?? 'InterLive 통역',
      // 입장 직후 1회만 게시 — 재전송 금지 (docs/04 §4)
      chatMessage: `[InterLive] 이 회의는 실시간 통역·기록이 진행됩니다. 자막 보기: ${viewerUrl}`,
    });

    // 웹훅이 이 세션을 찾을 수 있게 반드시 붙인다 (session-store.attachBotId 주석 참고)
    await attachBotId(record.id, botId);

    return NextResponse.json({
      sessionId: record.id,
      platform,
      botId,
      viewerToken,
      viewerUrl,
      maxDurationSec,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[meeting/join] bot create failed', message);
    // 유령 세션을 남기지 않는다
    const { endSession } = await import('@/lib/server/session-store');
    await endSession(record.id, 'error').catch(() => null);
    return NextResponse.json({ error: 'bot_create_failed' }, { status: 502 });
  }
}
