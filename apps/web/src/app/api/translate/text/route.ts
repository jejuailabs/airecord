import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { translateText } from '@sotong/shared/translate';
import {
  translateTextRequestSchema,
  type TranslateTextResponse,
} from '@sotong/shared/schemas';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { consumeChars, guestKey, remainingChars } from '@/lib/server/guest-quota';

export const runtime = 'nodejs';
/** 추론형 모델이라 응답이 길어질 수 있다 */
export const maxDuration = 60;

/**
 * 텍스트 번역 (실시간 통역과 별개 엔진).
 * 비회원은 글자수 한도 안에서만 사용한다 — 통역과 같은 예산을 공유한다.
 */
export async function POST(req: Request) {
  const parsed = translateTextRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { text, sourceLang, targetLang, tone } = parsed.data;
  if (!text.trim()) {
    const empty: TranslateTextResponse = { translated: '', remainingChars: null };
    return NextResponse.json(empty);
  }

  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie).catch(() => null);

  const key = guestKey(req);
  if (!user) {
    const left = remainingChars(key);
    if (left <= 0) {
      return NextResponse.json({ error: 'guest_quota_exhausted' }, { status: 429 });
    }
    if (text.length > left) {
      return NextResponse.json({ error: 'guest_quota_too_long', remaining: left }, { status: 429 });
    }
  }

  try {
    const result = await translateText({ text, sourceLang, targetLang, tone });
    if (!user) consumeChars(key, text.length);
    const body: TranslateTextResponse = {
      translated: result.translated,
      detectedLang: result.detectedLang,
      notes: result.notes,
      remainingChars: user ? null : remainingChars(key),
    };
    return NextResponse.json(body);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[translate/text]', message);
    const code = message.includes('OPENAI_API_KEY') ? 'key_missing' : 'translate_failed';
    return NextResponse.json({ error: code }, { status: 500 });
  }
}
