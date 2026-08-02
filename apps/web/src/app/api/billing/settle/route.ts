import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { getEntitlement } from '@/lib/server/entitlement';

export const runtime = 'nodejs';

/**
 * 후불 사용 미결제 정산 (사용자 지시 2026-08-02).
 * 미결제(billing.debtKrw)가 남아 있으면 새 세션이 막히므로, 여기서 결제해야 풀린다.
 * PG 미연동 상태라 checkout과 같은 방식으로 결제 의사만 기록한다 —
 * PG 연동 시 결제 성공 웹훅이 debtKrw·debtTokens를 0으로 되돌리도록 교체한다.
 */
export async function POST() {
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie);
  if (!user) {
    return NextResponse.json({ error: 'auth_required' }, { status: 401 });
  }

  try {
    const ent = await getEntitlement(user.uid, user.email);
    if (ent.debtKrw <= 0) {
      return NextResponse.json({ error: 'no_debt' }, { status: 400 });
    }
    await adminDb().collection('checkoutIntents').add({
      uid: user.uid,
      email: user.email ?? null,
      workspaceId: ent.workspaceId ?? null,
      type: 'debt_settlement',
      chargeKrw: ent.debtKrw,
      status: 'pg_pending', // PG 연동 시 결제창 생성으로 교체
      createdAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ status: 'pg_pending', chargeKrw: ent.debtKrw });
  } catch (e) {
    console.error('[billing/settle]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'store_failed' }, { status: 500 });
  }
}
