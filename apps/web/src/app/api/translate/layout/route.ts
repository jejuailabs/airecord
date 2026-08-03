import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { cookies } from 'next/headers';
import { reproduceLayout } from '@sotong/shared/translate/layout';
import {
  translateLayoutRequestSchema,
  type TranslateLayoutResponse,
} from '@sotong/shared/schemas';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { getEntitlement } from '@/lib/server/entitlement';
import { saveRecord } from '@/lib/server/records';
import { saveRecordObject } from '@/lib/server/records-storage';
import { layoutArtifact } from '@/lib/server/record-artifact';

export const runtime = 'nodejs';
/** 페이지마다 비전 호출이라 넉넉히 잡는다 */
export const maxDuration = 300;

/**
 * 레이아웃 재구성 번역 (사용자 지시 2026-08-03).
 * 페이지 이미지를 비전 모델에 보여주고 원본형 HTML로 다시 그린다 — 표·셀 색·구획을 재현하면서 번역.
 * 파일은 서버에 저장하지 않는다 (docs/08 §3 보관 최소화).
 */
export async function POST(req: Request) {
  const parsed = translateLayoutRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { fileName, sourceLang, targetLang, mode, pageImages } = parsed.data;

  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie).catch(() => null);
  if (!user) {
    return NextResponse.json({ error: 'auth_required' }, { status: 401 });
  }

  try {
    // 페이지 순서대로 재구성 — 한 장이 실패해도 나머지는 살린다
    const pages: TranslateLayoutResponse['pages'] = [];
    for (const img of pageImages) {
      try {
        const r = await reproduceLayout({ dataUrl: img.dataUrl, sourceLang, targetLang, mode });
        pages.push({ page: img.page, html: r.html, notes: r.notes });
      } catch (e) {
        console.error('[translate/layout] page failed', img.page, e instanceof Error ? e.message : e);
        pages.push({
          page: img.page,
          html: '',
          notes: ['이 페이지는 재구성에 실패했습니다.'],
        });
      }
    }
    const body: TranslateLayoutResponse = { fileName, pages };

    /**
     * 마이페이지 기록으로 남긴다 (사용자 지시 2026-08-03) — 응답을 늦추지 않게 after로.
     * 저장 실패가 번역 응답을 막지 않는다.
     */
    after(async () => {
      try {
        const ent = await getEntitlement(user.uid, user.email);
        const art = layoutArtifact(fileName, pages);
        const id = crypto.randomUUID();
        const path = await saveRecordObject(user.uid, id, art.body, art.contentType, art.ext);
        await saveRecord({
          uid: user.uid,
          workspaceId: ent.workspaceId,
          plan: ent.plan,
          kind: 'layout',
          title: fileName,
          sourceLang,
          targetLang,
          preview: `원본형 재구성 · ${pages.length}쪽`,
          storagePath: path,
          downloadName: art.downloadName,
          contentType: art.contentType,
          pageCount: pages.length,
        });
      } catch (e) {
        console.error('[translate/layout] save record failed', e instanceof Error ? e.message : e);
      }
    });

    return NextResponse.json(body);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[translate/layout]', message);
    const code = message.includes('OPENAI_API_KEY') ? 'key_missing' : 'translate_failed';
    return NextResponse.json({ error: code }, { status: 500 });
  }
}
