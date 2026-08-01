import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUid, getSessionDetail } from '@/lib/server/sessions-query';
import { signUploadUrl, signPlaybackUrl, RECORDING_CONTENT_TYPE } from '@/lib/server/recording';

export const runtime = 'nodejs';

/**
 * 세션 오디오(원본 발화) 저장·재생 서명 URL.
 *   POST → 브라우저가 녹음본을 올릴 업로드 URL (세션 종료 시 호출)
 *   GET  → 소유자에게 줄 재생 URL (세션 상세에서 호출)
 *
 * ⚠ 반드시 본인 세션만. 세션 소유자(startedByUid)와 로그인 uid가 같을 때만 발급한다.
 *   오디오는 민감정보라 남의 세션 오디오에 접근하는 길을 열지 않는다.
 */
const postSchema = z.object({ contentType: z.string().max(100).optional() });

async function requireOwnedSession(id: string): Promise<string | null> {
  const uid = await currentUid();
  if (!uid) return null;
  // getSessionDetail은 startedByUid !== uid면 null을 준다 — 그게 소유권 검사다
  const detail = await getSessionDetail(uid, id);
  return detail ? uid : null;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const uid = await requireOwnedSession(id);
  if (!uid) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  const contentType = parsed.success ? parsed.data.contentType : undefined;
  try {
    const { url, contentType: ct } = await signUploadUrl(
      uid,
      id,
      contentType || RECORDING_CONTENT_TYPE,
    );
    return NextResponse.json({ uploadUrl: url, contentType: ct });
  } catch (e) {
    console.error('[recording POST]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'sign_failed' }, { status: 500 });
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const uid = await requireOwnedSession(id);
  if (!uid) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  try {
    const url = await signPlaybackUrl(uid, id);
    // 녹음이 없을 수도 있다(옛 세션, 녹음 실패) — 404가 아니라 없음으로 알린다
    return NextResponse.json({ url }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[recording GET]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'sign_failed' }, { status: 500 });
  }
}
