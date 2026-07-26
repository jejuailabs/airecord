import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { getPlan } from '@sotong/shared/constants';

export const runtime = 'nodejs';

const bodySchema = z.object({ planId: z.enum(['starter', 'pro', 'business']) });

/**
 * 결제 유도 — PG는 미확정이다 (docs/02 §6: 토스페이먼츠/포트원 vs Stripe, Phase 3 전 결정).
 * 확정 전까지 하드코딩하지 않는다: 결제 의사(checkout intent)를 기록하고
 * PG 연동 시 이 엔드포인트가 실제 결제창 URL을 반환하도록 교체된다.
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
  const plan = getPlan(parsed.data.planId);
  if (!plan) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  try {
    await adminDb().collection('checkoutIntents').add({
      uid: user.uid,
      email: user.email ?? null,
      planId: plan.id,
      monthlyKrw: plan.monthlyKrw,
      status: 'pg_pending', // PG 연동 시 'created' → 결제창으로 교체
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error('[billing/checkout]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'store_failed' }, { status: 500 });
  }

  return NextResponse.json({ status: 'pg_pending' });
}
