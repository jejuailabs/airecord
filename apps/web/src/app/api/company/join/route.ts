import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { checkJoinLock, recordJoinFail, resetJoinFails } from '@/lib/server/company';

export const runtime = 'nodejs';

const bodySchema = z.object({
  workspaceId: z.string().min(8),
  code: z.string().min(6).max(20),
});

/**
 * 회사 합류 — 회사 선택 + 코드 입력 (docs/07 팀 과금 단순화안).
 *
 * 성공 = users/{uid}.lastWorkspaceId를 회사 워크스페이스로 전환 + members 등재.
 * 이후 토큰 소비·세션은 기존 구조 그대로 회사 지갑에서 이루어진다.
 *
 * ⚠ 코드가 짧은 만큼(6자~) 연속 실패 잠금이 필수다 — 5회 실패 시 10분 잠금.
 */
export async function POST(req: Request) {
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie).catch(() => null);
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { workspaceId, code } = parsed.data;

  try {
    const lock = await checkJoinLock(user.uid);
    if (lock.locked) {
      return NextResponse.json(
        { error: 'too_many_attempts', retryAfterSec: Math.ceil(lock.remainMs / 1000) },
        { status: 429 },
      );
    }

    const db = adminDb();
    const wsRef = db.collection('workspaces').doc(workspaceId);
    const ws = await wsRef.get();
    const company = ws.get('company') as { name?: string } | undefined;
    const joinCode = ws.get('joinCode') as string | undefined;
    // 회사 지갑이 아니거나 코드 불일치 — 같은 응답으로 뭉갠다(어느 쪽인지 알려주면 탐색을 돕는다)
    if (!ws.exists || !company?.name || !joinCode || joinCode.toUpperCase() !== code.toUpperCase()) {
      await recordJoinFail(user.uid);
      return NextResponse.json({ error: 'invalid_code' }, { status: 403 });
    }

    // 이미 멤버면 지갑 전환만 다시 해 준다 (중복 등재 없음 — doc id가 uid)
    const batch = db.batch();
    batch.set(
      wsRef.collection('members').doc(user.uid),
      {
        uid: user.uid,
        email: user.email ?? '',
        displayName: (user as { name?: string }).name ?? '',
        role: ws.get('ownerUid') === user.uid ? 'owner' : 'member',
        joinedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    batch.set(
      db.collection('users').doc(user.uid),
      { lastWorkspaceId: workspaceId, workspaceIds: FieldValue.arrayUnion(workspaceId) },
      { merge: true },
    );
    await batch.commit();
    await resetJoinFails(user.uid);

    return NextResponse.json({ ok: true, companyName: company.name });
  } catch (e) {
    console.error('[company/join]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'join_failed' }, { status: 500 });
  }
}
