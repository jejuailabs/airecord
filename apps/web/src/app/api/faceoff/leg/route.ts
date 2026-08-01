import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { getEngine, mintTranscriptionKey } from '@sotong/shared/engine';
import { langCodeSchema } from '@sotong/shared/schemas';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { getEntitlement } from '@/lib/server/entitlement';
import { getSession } from '@/lib/server/session-store';

export const runtime = 'nodejs';

/**
 * 마주 1세션(턴 방식)에서 **한 방향 키**를 그때그때 발급한다.
 *
 * 왜 별도 엔드포인트인가:
 *   1세션 모드는 항상 한 방향만 살아 있다. 차례가 바뀌면 이전 연결을 끊고 반대 방향을
 *   새로 연결하는데, 그때마다 신선한 임시 키가 필요하다(임시 키는 몇 분 만에 만료된다).
 *   /faceoff/start로 매번 새 세션을 여는 대신, 기존 세션에 방향 키만 다시 발급한다 —
 *   기록(세션 문서)은 하나로 유지된다.
 */
const bodySchema = z.object({
  sessionId: z.string().min(8),
  /** 'toB' = 말하는 사람의 언어 sourceLang → 상대 언어 targetLang */
  sourceLang: langCodeSchema,
  targetLang: langCodeSchema,
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { sessionId, sourceLang, targetLang } = parsed.data;
  if (sourceLang === targetLang) {
    return NextResponse.json({ error: 'same_language' }, { status: 400 });
  }

  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie).catch(() => null);
  if (!user) {
    return NextResponse.json({ error: 'auth_required' }, { status: 401 });
  }

  // 세션이 이 유저 것이고 아직 살아 있어야 새 방향 키를 준다
  const session = await getSession(sessionId);
  if (!session || session.uid !== user.uid) {
    return NextResponse.json({ error: 'session_not_found' }, { status: 404 });
  }
  if (session.status !== 'live') {
    return NextResponse.json({ error: 'session_ended' }, { status: 409 });
  }

  // 한도가 소진됐으면 다음 차례를 열어주지 않는다 (표시만 하고 막지 않으면 거짓말이 된다)
  const ent = await getEntitlement(user.uid, user.email);
  if (!ent.canStart) {
    return NextResponse.json({ error: 'quota_exhausted' }, { status: 402 });
  }

  const engine = getEngine();
  if (!engine.supports(sourceLang, targetLang)) {
    return NextResponse.json({ error: 'unsupported_pair' }, { status: 400 });
  }

  try {
    const [grant, transcribe] = await Promise.all([
      engine.mintEphemeralKey({ sourceLang, targetLang, audioOut: true, sessionId }),
      mintTranscriptionKey({ sourceLang }).catch(() => null),
    ]);
    return NextResponse.json({
      ephemeralKey: grant.key,
      model: grant.model,
      provider: grant.provider,
      callUrl: grant.callUrl,
      keyExpiresAt: grant.expiresAt,
      targetLang,
      transcribe,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[faceoff/leg]', message);
    const code = message.includes('OPENAI_API_KEY') ? 'key_missing' : 'leg_failed';
    return NextResponse.json({ error: code }, { status: 500 });
  }
}
