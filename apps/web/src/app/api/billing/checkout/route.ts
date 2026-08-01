import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { getPlan, yearlyKrw } from '@sotong/shared/constants';
import { attachCompanyToWorkspace } from '@/lib/server/company';

export const runtime = 'nodejs';

const bodySchema = z.object({
  planId: z.enum(['starter', 'pro', 'business']),
  cycle: z.enum(['monthly', 'yearly']).default('monthly'),
  /** Business 전용 — 회사 지갑 지정용. 결제자(대표) 워크스페이스가 회사 지갑이 된다. */
  companyName: z.string().trim().min(2).max(60).optional(),
  bizNo: z.string().trim().min(10).max(12).optional(),
});

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

  // Business는 회사 지갑 지정을 위해 회사명·사업자번호가 필수다
  const { companyName, bizNo } = parsed.data;
  if (plan.id === 'business' && (!companyName || !bizNo)) {
    return NextResponse.json({ error: 'company_required' }, { status: 400 });
  }

  try {
    const cycle = parsed.data.cycle;
    await adminDb().collection('checkoutIntents').add({
      uid: user.uid,
      email: user.email ?? null,
      planId: plan.id,
      cycle, // 'monthly' | 'yearly'
      monthlyKrw: plan.monthlyKrw,
      // 실제 청구 예정액 — 연 결제는 10% 할인가
      chargeKrw: cycle === 'yearly' ? yearlyKrw(plan.monthlyKrw) : plan.monthlyKrw,
      ...(companyName ? { companyName, bizNo: bizNo ?? null } : {}),
      status: 'pg_pending', // PG 연동 시 'created' → 결제창으로 교체
      createdAt: FieldValue.serverTimestamp(),
    });

    /**
     * Business 신청 즉시 회사 지갑을 만든다 — 합류 코드가 이때 발급된다.
     * PG 미연동 상태라 '결제 완료'가 아직 없으므로 신청 접수를 기준으로 지갑을 준비해 두고,
     * PG가 붙으면 플랜 활성(plan='business')만 결제 성공 시점으로 옮기면 된다.
     */
    let joinCode: string | undefined;
    if (plan.id === 'business' && companyName && bizNo) {
      const attached = await attachCompanyToWorkspace(user.uid, { name: companyName, bizNo });
      joinCode = attached?.joinCode;
    }

    return NextResponse.json({ status: 'pg_pending', ...(joinCode ? { joinCode } : {}) });
  } catch (e) {
    console.error('[billing/checkout]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'store_failed' }, { status: 500 });
  }
}
