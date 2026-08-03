import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { signRecordUpload } from '@/lib/server/records-storage';

export const runtime = 'nodejs';

const bodySchema = z.object({
  ext: z.enum(['docx', 'hwpx', 'html', 'pdf', 'txt']),
  contentType: z.string().min(3).max(120),
});

/**
 * 브라우저에서 만든 번역 결과물(docx·hwpx 등)을 마이페이지에 저장하기 위한 서명 업로드 URL 발급.
 * 브라우저는 이 URL로 파일을 직접 Storage에 올린 뒤, POST /api/records로 메타를 커밋한다.
 */
export async function POST(req: Request) {
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie).catch(() => null);
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const { uploadUrl, storagePath } = await signRecordUpload(
    user.uid,
    parsed.data.ext,
    parsed.data.contentType,
  );
  return NextResponse.json({ uploadUrl, storagePath });
}
