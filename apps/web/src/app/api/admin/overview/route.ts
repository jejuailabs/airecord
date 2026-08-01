import { NextResponse } from 'next/server';
import { currentAdmin } from '@/lib/server/admin';
import { getAdminOverview, listAdminUsers, getUsageLog } from '@/lib/server/admin-query';
import { getAppFlags } from '@/lib/server/app-flags';

export const runtime = 'nodejs';

/**
 * 운영 지표 + 회원 목록.
 *
 * ⚠ 권한이 없으면 403이 아니라 **404**를 준다.
 *   403은 "여기 관리자 화면이 있다"를 알려주는 셈이다.
 */
export async function GET() {
  const admin = await currentAdmin();
  if (!admin) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  try {
    const [overview, users, usageLog, flags] = await Promise.all([
      getAdminOverview(),
      listAdminUsers(),
      getUsageLog().catch(() => []), // 원장이 아직 비어도 화면은 떠야 한다
      getAppFlags(),
    ]);
    return NextResponse.json(
      { overview, users, usageLog, isSuper: admin.isSuper, flags },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    console.error('[admin/overview]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'query_failed' }, { status: 500 });
  }
}
