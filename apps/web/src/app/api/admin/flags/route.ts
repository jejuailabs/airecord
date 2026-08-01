import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentAdmin, writeAuditLog } from '@/lib/server/admin';
import { getAppFlags, setAppFlags } from '@/lib/server/app-flags';

export const runtime = 'nodejs';

const bodySchema = z.object({
  /** 마주 1세션(턴 방식) 실험 모드 */
  faceoffSingle: z.boolean().optional(),
});

/** 현재 전역 플래그 (열람은 일반 관리자도 가능). */
export async function GET() {
  const admin = await currentAdmin();
  if (!admin) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(await getAppFlags(), { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * 전역 플래그 변경 — **슈퍼관리자만**.
 * 실험 기능을 켜는 스위치라 돈·품질에 영향이 갈 수 있어, 무제한 토글과 같은 등급으로 막는다.
 */
export async function PATCH(req: Request) {
  const admin = await currentAdmin();
  if (!admin) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!admin.isSuper) {
    return NextResponse.json({ error: 'super_admin_required' }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const flags = await setAppFlags(parsed.data);

  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'update_app_flags',
    detail: parsed.data,
  });

  return NextResponse.json({ ok: true, flags });
}
