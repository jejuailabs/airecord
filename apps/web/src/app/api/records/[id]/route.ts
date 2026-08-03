import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { getRecord, deleteRecord } from '@/lib/server/records';
import { signRecordDownload } from '@/lib/server/records-storage';

export const runtime = 'nodejs';

/**
 * 기록 결과물 다운로드 — 소유자 확인 후 짧은 만료의 서명 URL로 리다이렉트.
 * Storage는 잠겨 있고 서버만 접근하므로, 브라우저는 이 서명 URL로만 파일을 받는다.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie).catch(() => null);
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const rec = await getRecord(user.uid, id);
  if (!rec || !rec.storagePath) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const url = await signRecordDownload(rec.storagePath, rec.downloadName);
  if (!url) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.redirect(url);
}

/** 기록 삭제 — 소유자만. 메타 + Storage 파일을 함께 지운다. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie).catch(() => null);
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const ok = await deleteRecord(user.uid, id);
  return NextResponse.json({ ok });
}
