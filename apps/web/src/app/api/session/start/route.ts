import { NextResponse } from 'next/server';
import { getEngine } from '@sotong/shared/engine';
import { sessionStartRequestSchema, type SessionStartResponse } from '@sotong/shared/schemas';
import { createSession, maxDurationSecFromEnv } from '@/lib/server/session-store';

export const runtime = 'nodejs';

/**
 * 모드 B 세션 시작 (docs/01 §4.1).
 * Phase 1: 로그인·잔여 분 확인 없음. 하드 캡은 환경변수로만 제한.
 * Phase 2에서 워크스페이스 잔여 분 확인(부족 시 402)이 이 앞에 붙는다.
 */
export async function POST(req: Request) {
  const parsed = sessionStartRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { sourceLang, targetLang, audioOut } = parsed.data;

  const engine = getEngine();
  if (!engine.supports(sourceLang, targetLang)) {
    return NextResponse.json({ error: 'unsupported_pair' }, { status: 400 });
  }

  const maxDurationSec = Math.min(maxDurationSecFromEnv(), engine.capabilities.maxSessionSec);
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
    };
    return NextResponse.json(body);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[session/start]', message);
    const code = message.includes('OPENAI_API_KEY') ? 'key_missing' : 'start_failed';
    return NextResponse.json({ error: code }, { status: 500 });
  }
}
