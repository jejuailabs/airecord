import { NextResponse } from 'next/server';
import { resolveViewerToken, readSegmentsAfter } from '@/lib/server/viewer';

export const runtime = 'nodejs';

/**
 * 자막 뷰어 폴링 (docs/06 §2.4).
 *
 * 회의 참가자가 링크만으로 자막을 본다 — 로그인 없다.
 * 토큰 검증은 서버에서만 한다(lib/server/viewer.ts 주석 참고).
 *
 * 왜 폴링인가: 자막은 확정된 줄만 저장하므로 초 단위로 새 줄이 생긴다.
 * 2초 폴링이면 체감상 실시간이고, 클라이언트에 DB 접근권을 주지 않아도 된다.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const grant = await resolveViewerToken(token).catch(() => null);
  if (!grant) {
    // 없는 토큰과 만료된 토큰을 구분해 주지 않는다
    return NextResponse.json({ error: 'invalid_token' }, { status: 404 });
  }

  const after = Number(new URL(req.url).searchParams.get('after') ?? '-1');
  const segments = await readSegmentsAfter(grant.sessionId, Number.isFinite(after) ? after : -1);

  return NextResponse.json(
    {
      status: grant.status,
      sourceLang: grant.sourceLang,
      targetLang: grant.targetLang,
      segments,
      // 대면처럼 "쌓이는 중" 번역 줄 — 확정되면 segments로 넘어가고 여기선 사라진다
      livePartial: grant.livePartial,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
