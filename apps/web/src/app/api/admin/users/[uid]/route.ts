import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { currentAdmin, writeAuditLog } from '@/lib/server/admin';

export const runtime = 'nodejs';

const bodySchema = z.object({
  /** 무제한 사용 허용 여부 */
  unlimited: z.boolean().optional(),
  /** 초과 사용 허용 여부 (청구 대상) */
  overageEnabled: z.boolean().optional(),
});

/**
 * 회원 설정 변경.
 *
 * ⚠ 무제한은 **슈퍼관리자만** 켤 수 있다 (lib/server/admin.ts 주석 참고).
 *   users/{uid}.role='admin'은 Firestore 문서 한 줄이라, 그것만으로
 *   원가가 무제한으로 나가는 스위치를 쥐게 하면 안 된다.
 *
 * 무제한은 워크스페이스 단위로 저장한다 — 사용량 판정(entitlement)이 거기서 읽는다.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const admin = await currentAdmin();
  if (!admin) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!admin.isSuper) {
    return NextResponse.json({ error: 'super_admin_required' }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { uid } = await params;

  const db = adminDb();
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) return NextResponse.json({ error: 'user_not_found' }, { status: 404 });

  const workspaceId = userSnap.get('lastWorkspaceId') as string | undefined;
  if (!workspaceId) {
    // 워크스페이스가 없으면 저장할 곳이 없다 — 첫 로그인에서 만들어진다
    return NextResponse.json({ error: 'workspace_missing' }, { status: 409 });
  }

  const billing: Record<string, boolean> = {};
  if (parsed.data.unlimited !== undefined) billing.unlimited = parsed.data.unlimited;
  if (parsed.data.overageEnabled !== undefined) {
    billing.overageEnabled = parsed.data.overageEnabled;
  }

  await db.collection('workspaces').doc(workspaceId).set({ billing }, { merge: true });

  // 누가 언제 왜 켰는지 남긴다 — 나중에 반드시 묻게 된다
  await writeAuditLog({
    actorUid: admin.uid,
    actorEmail: admin.email,
    action: 'update_billing_flags',
    targetUid: uid,
    targetWorkspaceId: workspaceId,
    detail: billing,
  });

  return NextResponse.json({ ok: true, workspaceId, ...billing });
}
