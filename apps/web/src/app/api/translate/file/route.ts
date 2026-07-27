import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { translateDocument } from '@sotong/shared/translate/document';
import { translateImage } from '@sotong/shared/translate/vision';
import {
  translateFileRequestSchema,
  type TranslateFileResponse,
} from '@sotong/shared/schemas';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
/** 여러 페이지를 순차로 번역하므로 넉넉히 잡는다 */
export const maxDuration = 300;

/**
 * 파일 번역.
 * PDF는 클라이언트가 뽑은 페이지 텍스트를 받고, 이미지는 비전 모델이 직접 읽는다.
 * 파일은 서버에 저장하지 않는다 — 번역해서 돌려주고 끝낸다 (docs/08 §3 보관 최소화).
 */
export async function POST(req: Request) {
  const parsed = translateFileRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { kind, fileName, sourceLang, targetLang, pages, dataUrl } = parsed.data;

  // 파일 번역은 로그인 사용자 전용 — 분량이 커 비회원 한도로 감당되지 않는다
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie).catch(() => null);
  if (!user) {
    return NextResponse.json({ error: 'auth_required' }, { status: 401 });
  }

  try {
    if (kind === 'image') {
      if (!dataUrl) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
      const r = await translateImage({ dataUrl, sourceLang, targetLang });
      const body: TranslateFileResponse = {
        fileName,
        pages: [{ page: 1, source: r.source, translated: r.translated, notes: r.notes }],
        totalChars: r.source.length,
      };
      return NextResponse.json(body);
    }

    const usable = (pages ?? []).filter((p) => p.text.trim().length > 0);
    if (usable.length === 0) {
      // 텍스트 레이어가 없는 스캔 PDF — 이미지로 넣어야 한다
      return NextResponse.json({ error: 'no_text_layer' }, { status: 422 });
    }
    const result = await translateDocument({ pages: usable, sourceLang, targetLang });
    const body: TranslateFileResponse = {
      fileName,
      pages: result,
      totalChars: usable.reduce((sum, p) => sum + p.text.length, 0),
    };
    return NextResponse.json(body);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[translate/file]', message);
    const code = message.includes('OPENAI_API_KEY') ? 'key_missing' : 'translate_failed';
    return NextResponse.json({ error: code }, { status: 500 });
  }
}
