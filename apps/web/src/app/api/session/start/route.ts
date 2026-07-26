import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getEngine } from '@sotong/shared/engine';
import { sessionStartRequestSchema, type SessionStartResponse } from '@sotong/shared/schemas';
import { createSession, maxDurationSecFromEnv } from '@/lib/server/session-store';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { grantCharBudget, guestKey } from '@/lib/server/guest-quota';

export const runtime = 'nodejs';

/**
 * 모드 B 세션 시작 (docs/01 §4.1).
 * 분(minute)은 곧 돈이다 (core.md §3-6): 비로그인은 trial(짧은 캡)로만 세션을 열 수 있다.
 * Phase 3에서 워크스페이스 잔여 분 확인(부족 시 402)이 이 앞에 붙는다.
 */
export async function POST(req: Request) {
  const parsed = sessionStartRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { sourceLang, targetLang, audioOut, trial } = parsed.data;

  let charBudget: number | null = null;
  if (trial) {
    // 비회원: 이번 달 남은 글자수 안에서만 체험을 연다
    charBudget = grantCharBudget(guestKey(req));
    if (charBudget <= 0) {
      return NextResponse.json({ error: 'guest_quota_exhausted' }, { status: 429 });
    }
  } else {
    const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    const user = await verifySessionCookie(cookie).catch(() => null);
    if (!user) {
      return NextResponse.json({ error: 'auth_required' }, { status: 401 });
    }
  }

  const engine = getEngine();
  if (!engine.supports(sourceLang, targetLang)) {
    return NextResponse.json({ error: 'unsupported_pair' }, { status: 400 });
  }

  // 비회원 체험은 서버가 더 짧은 캡을 강제한다 — 클라이언트 제한만으로는 뚫린다 (docs/07 §5.1)
  const trialCapSec = Number(process.env.TRIAL_MAX_DURATION_SEC ?? 120);
  const baseCapSec = Math.min(maxDurationSecFromEnv(), engine.capabilities.maxSessionSec);
  const maxDurationSec = trial ? Math.min(trialCapSec, baseCapSec) : baseCapSec;
  const record = createSession('inperson', maxDurationSec);

  try {
    const grant = await engine.mintEphemeralKey({
      sourceLang,
      targetLang,
      audioOut,
      sessionId: record.id,
    });
    const body: SessionStartResponse = {
      sessionId: record.id,
      ephemeralKey: grant.key,
      model: grant.model,
      provider: grant.provider,
      callUrl: grant.callUrl,
      keyExpiresAt: grant.expiresAt,
      maxDurationSec,
      charBudget,
    };
    return NextResponse.json(body);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[session/start]', message);
    const code = message.includes('OPENAI_API_KEY') ? 'key_missing' : 'start_failed';
    return NextResponse.json({ error: code }, { status: 500 });
  }
}
