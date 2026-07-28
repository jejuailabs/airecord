import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { translateDocument } from '@sotong/shared/translate/document';
import { ocrImage, translateImage } from '@sotong/shared/translate/vision';
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
  const { kind, fileName, sourceLang, targetLang, pages, pageImages, dataUrl } = parsed.data;

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

    /**
     * 스캔본 — 브라우저가 그린 페이지 이미지를 OCR로 읽어 텍스트로 만든 뒤,
     * 글자 있는 PDF와 **완전히 같은 경로**(문단 번호 대응 번역)를 태운다.
     * 그래야 "원문과 합치기"가 스캔본에서도 그대로 된다.
     *
     * ⚠ 여기서 나온 원문은 원본이 아니라 읽어낸 것이다 — 화면에 그렇게 표시해야 한다.
     */
    if (kind === 'pdf-scan') {
      const imgs = pageImages ?? [];
      if (imgs.length === 0) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

      const ocrNotes = new Map<number, string[]>();
      const read: Array<{ page: number; text: string }> = [];
      for (const img of imgs) {
        const r = await ocrImage({ dataUrl: img.dataUrl, sourceLang });
        if (r.text.trim()) read.push({ page: img.page, text: r.text });
        if (r.notes?.length) ocrNotes.set(img.page, r.notes);
      }
      if (read.length === 0) {
        return NextResponse.json({ error: 'no_text_layer' }, { status: 422 });
      }

      const scanned = await translateDocument({ pages: read, sourceLang, targetLang });
      const body: TranslateFileResponse = {
        fileName,
        pages: scanned.map((p) => ({
          ...p,
          notes: [...(ocrNotes.get(p.page) ?? []), ...(p.notes ?? [])],
        })),
        totalChars: read.reduce((sum, p) => sum + p.text.length, 0),
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
