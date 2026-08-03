import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { getEntitlement } from '@/lib/server/entitlement';
import { saveRecord } from '@/lib/server/records';
import { isOwnedRecordPath } from '@/lib/server/records-storage';

export const runtime = 'nodejs';

const bodySchema = z.object({
  kind: z.enum(['text', 'file', 'layout']),
  title: z.string().min(1).max(200),
  sourceLang: z.string().max(20),
  targetLang: z.string().max(20),
  preview: z.string().max(300).default(''),
  /** 브라우저가 업로드한 결과물 경로 (upload-url이 발급한 그 경로) */
  storagePath: z.string().max(300),
  downloadName: z.string().max(200).optional(),
  contentType: z.string().max(120).optional(),
  pageCount: z.number().int().nonnegative().optional(),
});

/**
 * 브라우저에서 올린 결과물의 메타를 커밋한다 (docx·hwpx "마이페이지에 저장").
 * storagePath가 이 사용자 소유 경로인지 확인해 위조를 막는다.
 */
export async function POST(req: Request) {
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie).catch(() => null);
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const d = parsed.data;

  // 남의 경로로 메타만 심는 위조를 막는다
  if (!isOwnedRecordPath(user.uid, d.storagePath)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const ent = await getEntitlement(user.uid, user.email);
    const id = await saveRecord({
      uid: user.uid,
      workspaceId: ent.workspaceId,
      plan: ent.plan,
      kind: d.kind,
      title: d.title,
      sourceLang: d.sourceLang,
      targetLang: d.targetLang,
      preview: d.preview,
      storagePath: d.storagePath,
      downloadName: d.downloadName,
      contentType: d.contentType,
      pageCount: d.pageCount,
    });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    console.error('[records] commit failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'store_failed' }, { status: 500 });
  }
}
