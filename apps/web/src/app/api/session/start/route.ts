import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getEngine, mintTranscriptionKey } from '@sotong/shared/engine';
import { sessionStartRequestSchema, type SessionStartResponse } from '@sotong/shared/schemas';
import { createSession, maxDurationSecFromEnv } from '@/lib/server/session-store';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { grantCharBudget, guestKey } from '@/lib/server/guest-quota';
import { getEntitlement, sessionCapSeconds } from '@/lib/server/entitlement';
import { secondsForTokens } from '@sotong/shared/constants';

export const runtime = 'nodejs';

/**
 * 모드 B 세션 시작 (docs/01 §4.1).
 * 분(minute)은 곧 돈이다 (core.md §3-6).
 * 비로그인은 trial(짧은 캡)로만, 로그인 사용자는 남은 분 안에서만 세션을 연다.
 */
export async function POST(req: Request) {
  const parsed = sessionStartRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { sourceLang, targetLang, audioOut, trial } = parsed.data;

  const engine = getEngine();
  if (!engine.supports(sourceLang, targetLang)) {
    return NextResponse.json({ error: 'unsupported_pair' }, { status: 400 });
  }

  const trialCapSec = Number(process.env.TRIAL_MAX_DURATION_SEC ?? 120);
  const baseCapSec = Math.min(maxDurationSecFromEnv(), engine.capabilities.maxSessionSec);

  let charBudget: number | null = null;
  let uid: string | undefined;
  let workspaceId: string | undefined;
  let maxDurationSec: number;
  let postpaidFromSec: number | null = null;

  if (trial) {
    // 비회원: 이번 달 남은 글자수 안에서만 체험을 연다
    charBudget = grantCharBudget(guestKey(req));
    if (charBudget <= 0) {
      return NextResponse.json({ error: 'guest_quota_exhausted' }, { status: 429 });
    }
    // 서버가 더 짧은 캡을 강제한다 — 클라이언트 제한만으로는 뚫린다 (docs/07 §5.1)
    maxDurationSec = Math.min(trialCapSec, baseCapSec);
  } else {
    const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    const user = await verifySessionCookie(cookie).catch(() => null);
    if (!user) {
      return NextResponse.json({ error: 'auth_required' }, { status: 401 });
    }
    uid = user.uid;

    // 남은 분을 실제로 검사한다. 표시만 하고 막지 않으면 화면이 거짓말이 된다.
    const ent = await getEntitlement(user.uid, user.email);
    if (!ent.canStart) {
      return NextResponse.json(
        {
          // 후불 미결제로 막힌 것과 토큰 소진은 안내가 달라야 한다
          error: ent.debtKrw > 0 ? 'debt_unpaid' : 'quota_exhausted',
          usedMinutes: ent.usedMinutes,
          includedMinutes: ent.includedMinutes,
          debtKrw: ent.debtKrw,
        },
        { status: 402 },
      );
    }
    workspaceId = ent.workspaceId;
    // 남은 분보다 긴 세션을 열지 않는다 (Pro 이상은 후불 크레딧만큼 더 열린다)
    maxDurationSec = sessionCapSeconds(ent, baseCapSec);
    /**
     * 잔액이 캡 안에서 먼저 바닥나는 경우에만 후불 진입 시점을 알려준다.
     * 화면은 이 시점부터 "후불 과금 중" 배너를 띄운다 — 몰래 청구하지 않는다.
     */
    if (ent.postpaidLimitTokens > 0 && Number.isFinite(ent.remainingMinutes)) {
      const balanceSec = secondsForTokens('inperson', ent.remainingMinutes);
      if (balanceSec < maxDurationSec) postpaidFromSec = balanceSec;
    }
  }
  const record = await createSession({
    mode: 'inperson',
    maxDurationSec,
    sourceLang,
    targetLang,
    uid,
    workspaceId,
    title: parsed.data.title,
  });

  try {
    /**
     * 통역 키와 원문 전사 키를 나란히 발급한다.
     * 전사는 실패해도 통역을 막지 않는다 — null이면 클라이언트가 부가 전사로 돌아간다.
     */
    const [grant, transcribe] = await Promise.all([
      engine.mintEphemeralKey({ sourceLang, targetLang, audioOut, sessionId: record.id }),
      // 원문 언어를 알면 넘긴다 — 짧은 발화에서 전사가 언어를 오판하는 것을 막는다
      mintTranscriptionKey({ sourceLang }).catch(() => null),
    ]);
    const body: SessionStartResponse = {
      sessionId: record.id,
      ephemeralKey: grant.key,
      model: grant.model,
      provider: grant.provider,
      callUrl: grant.callUrl,
      keyExpiresAt: grant.expiresAt,
      maxDurationSec,
      postpaidFromSec,
      charBudget,
      transcribe,
    };
    return NextResponse.json(body);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[session/start]', message);
    const code = message.includes('OPENAI_API_KEY') ? 'key_missing' : 'start_failed';
    return NextResponse.json({ error: code }, { status: 500 });
  }
}
