import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { translateParagraphs } from '@sotong/shared/translate';
import {
  translateDocxRequestSchema,
  type TranslateDocxResponse,
} from '@sotong/shared/schemas';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * 워드 문서 번역 — 문단 번호 대응.
 *
 * ⚠ 파일은 오지 않는다. 브라우저가 .docx를 풀어 문단 글자만 보내고,
 *   받은 번역을 제자리에 되써서 다시 압축한다(lib/docx/transform.ts).
 *   그래야 표·머리말·글머리표·이미지 같은 서식이 하나도 안 상한다.
 *
 * 한 번에 다 보내면 모델이 뒤쪽 문단을 흘리므로 클라이언트가 잘라서 여러 번 부른다.
 * 여기서는 받은 묶음 하나만 번역한다.
 */
export async function POST(req: Request) {
  const parsed = translateDocxRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { items, sourceLang, targetLang, tone } = parsed.data;

  // 파일 번역은 로그인 사용자 전용 — PDF 경로와 같은 기준이다
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie).catch(() => null);
  if (!user) {
    return NextResponse.json({ error: 'auth_required' }, { status: 401 });
  }

  try {
    const map = await translateParagraphs({ paragraphs: items, sourceLang, targetLang, tone });
    /**
     * 번역이 안 온 문단은 **빼고 돌려준다.**
     * 빈 문자열로 채워 보내면 클라이언트가 원문을 빈 칸으로 덮어써 글자를 잃는다.
     */
    const out = items
      .map((it) => ({ n: it.n, text: map.get(it.n) ?? '' }))
      .filter((it) => it.text.trim().length > 0);

    const body: TranslateDocxResponse = { items: out, missing: items.length - out.length };
    return NextResponse.json(body);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[translate/docx]', message);
    const code = message.includes('OPENAI_API_KEY') ? 'key_missing' : 'translate_failed';
    return NextResponse.json({ error: code }, { status: 500 });
  }
}
