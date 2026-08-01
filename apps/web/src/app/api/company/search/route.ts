import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminDb, SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';

export const runtime = 'nodejs';

/**
 * 회사명 검색 — 합류 화면의 펼침목록용. **앞글자 매칭**, 2자 이상, 최대 5개.
 *
 * ⚠ 결제 고객사 목록이 새는 창구가 될 수 있다:
 *   로그인 필수 + 최소 2자 + 5개 제한 + 회사명만 노출(사업자번호·잔액 등은 절대 안 준다).
 */
export async function GET(req: Request) {
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie).catch(() => null);
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().toLowerCase();
  if (q.length < 2) return NextResponse.json({ companies: [] });

  try {
    // 앞글자(prefix) 매칭 — Firestore 사전순 범위 쿼리 (단일 필드라 별도 인덱스 불필요)
    const snap = await adminDb()
      .collection('workspaces')
      .orderBy('company.nameLower')
      .startAt(q)
      .endAt(`${q}`)
      .limit(5)
      .get();
    const companies = snap.docs.map((d) => ({
      workspaceId: d.id,
      name: (d.get('company.name') as string | undefined) ?? '',
    }));
    return NextResponse.json({ companies }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[company/search]', e instanceof Error ? e.message : e);
    return NextResponse.json({ companies: [] });
  }
}
