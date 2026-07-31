import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { getEngine, mintTranscriptionKey } from '@sotong/shared/engine';
import { langCodeSchema } from '@sotong/shared/schemas';
import { createSession, maxDurationSecFromEnv } from '@/lib/server/session-store';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { getEntitlement, sessionCapSeconds } from '@/lib/server/entitlement';

export const runtime = 'nodejs';

/**
 * 마주통역 세션 시작 (모드 D — 한 기기, 양방향 동시).
 *
 * ⚠ 다른 모드와 근본적으로 다르다: **번역 키를 두 개** 발급한다.
 *   gpt-realtime-translate는 출력 언어가 세션당 하나로 고정이라(실측 2026-08-01),
 *   "한국어 발화→영어" 와 "영어 발화→한국어"를 한 세션으로 동시에 낼 수 없다.
 *   그래서 방향마다 세션을 하나씩 열고, 같은 마이크를 둘 다에 물린다.
 *
 * 결과적으로 이 모드의 번역 원가는 대략 2배다 — 두 세션이 상시 돌기 때문이다.
 * (한 세션으로 언어감지 후 출력을 뒤집는 대안도 있지만, 방향 전환 첫 0.2초가
 *  이전 언어로 번역되는 품질 문제가 있어 v1은 정확한 쪽인 2세션으로 간다.)
 */
const bodySchema = z.object({
  /** 한쪽 사람이 말하는 언어 */
  langA: langCodeSchema,
  /** 맞은편 사람이 말하는 언어 */
  langB: langCodeSchema,
  audioOut: z.boolean().default(true),
  title: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { langA, langB, audioOut, title } = parsed.data;
  if (langA === langB) {
    return NextResponse.json({ error: 'same_language' }, { status: 400 });
  }

  const engine = getEngine();
  if (!engine.supports(langA, langB) || !engine.supports(langB, langA)) {
    return NextResponse.json({ error: 'unsupported_pair' }, { status: 400 });
  }

  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie).catch(() => null);
  if (!user) {
    return NextResponse.json({ error: 'auth_required' }, { status: 401 });
  }

  const ent = await getEntitlement(user.uid, user.email);
  if (!ent.canStart) {
    return NextResponse.json(
      { error: 'quota_exhausted', usedMinutes: ent.usedMinutes, includedMinutes: ent.includedMinutes },
      { status: 402 },
    );
  }

  const baseCapSec = Math.min(maxDurationSecFromEnv(), engine.capabilities.maxSessionSec);
  const maxDurationSec = sessionCapSeconds(ent, baseCapSec);

  const record = await createSession({
    mode: 'faceoff',
    maxDurationSec,
    // 기록에는 A를 원문 언어, B를 표시 언어로 남긴다 (양방향이라 대표값일 뿐)
    sourceLang: langA,
    targetLang: langB,
    uid: user.uid,
    workspaceId: ent.workspaceId,
    title,
  });

  try {
    /**
     * 두 방향 키 + 각 방향의 전용 전사 키를 나란히 발급한다.
     *   toB: langA 발화를 langB로 (전사 힌트 = langA)
     *   toA: langB 발화를 langA로 (전사 힌트 = langB)
     * 전사는 실패해도 통역을 막지 않는다 — null이면 부가 전사로 돈다.
     */
    const [grantToB, grantToA, transcribeA, transcribeB] = await Promise.all([
      engine.mintEphemeralKey({ sourceLang: langA, targetLang: langB, audioOut, sessionId: record.id }),
      engine.mintEphemeralKey({ sourceLang: langB, targetLang: langA, audioOut, sessionId: record.id }),
      mintTranscriptionKey({ sourceLang: langA }).catch(() => null),
      mintTranscriptionKey({ sourceLang: langB }).catch(() => null),
    ]);

    return NextResponse.json({
      sessionId: record.id,
      maxDurationSec,
      langA,
      langB,
      /** langA 발화 → langB 출력 */
      toB: {
        ephemeralKey: grantToB.key,
        model: grantToB.model,
        provider: grantToB.provider,
        callUrl: grantToB.callUrl,
        keyExpiresAt: grantToB.expiresAt,
        targetLang: langB,
        transcribe: transcribeA,
      },
      /** langB 발화 → langA 출력 */
      toA: {
        ephemeralKey: grantToA.key,
        model: grantToA.model,
        provider: grantToA.provider,
        callUrl: grantToA.callUrl,
        keyExpiresAt: grantToA.expiresAt,
        targetLang: langA,
        transcribe: transcribeB,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[faceoff/start]', message);
    const { endSession } = await import('@/lib/server/session-store');
    await endSession(record.id, 'error').catch(() => null);
    const code = message.includes('OPENAI_API_KEY') ? 'key_missing' : 'start_failed';
    return NextResponse.json({ error: code }, { status: 500 });
  }
}
