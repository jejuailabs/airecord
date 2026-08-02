import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { getTopupPack } from '@sotong/shared/constants';
import { getEntitlement } from '@/lib/server/entitlement';

export const runtime = 'nodejs';

const bodySchema = z.object({
  packId: z.enum(['small', 'medium', 'large']),
});

/**
 * 토큰 충전 — 구독과 별개의 단발 구매 (사용자 지시 2026-08-02).
 * PG는 미확정이다 (docs/02 §6). checkout과 같은 방식으로 결제 의사만 기록하고,
 * PG 연동 시 결제 성공 웹훅이 billing.topupTokens를 증분하도록 교체한다.
 * 충전 토큰은 주기 리셋과 무관하게 이월되며, 포함분 소진 후에 소비된다.
 */
export async function POST(req: Request) {
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie);
  if (!user) {
    return NextResponse.json({ error: 'auth_required' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const pack = getTopupPack(parsed.data.packId);
  if (!pack) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  try {
    const ent = await getEntitlement(user.uid, user.email);
    await adminDb().collection('checkoutIntents').add({
      uid: user.uid,
      email: user.email ?? null,
      workspaceId: ent.workspaceId ?? null,
      type: 'topup',
      packId: pack.id,
      tokens: pack.tokens,
      chargeKrw: pack.krw,
      status: 'pg_pending', // PG 연동 시 결제창 생성으로 교체
      createdAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ status: 'pg_pending' });
  } catch (e) {
    console.error('[billing/topup]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'store_failed' }, { status: 500 });
  }
}
