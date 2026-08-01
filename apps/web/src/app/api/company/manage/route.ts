import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { findOwnedCompanyWorkspace, generateJoinCode, JOIN_CODE_RE } from '@/lib/server/company';

export const runtime = 'nodejs';

/**
 * 회사 관리 — Business 결제자(대표) 전용.
 * GET: 회사 정보 + 합류 코드 + 멤버 목록. 대표가 아니면 404(관리 화면의 존재를 숨긴다).
 * PATCH: 코드 재발급(body 없음) 또는 직접 수정({ code }) — 영문+숫자 6~20자.
 * DELETE: 멤버 제거({ memberUid }) — 그 유저의 지갑을 본인 개인 워크스페이스로 되돌린다.
 */
async function ownerWorkspace() {
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie).catch(() => null);
  if (!user) return { user: null, ws: null } as const;
  const ws = await findOwnedCompanyWorkspace(user.uid);
  return { user, ws } as const;
}

export async function GET() {
  const { user, ws } = await ownerWorkspace();
  if (!user || !ws) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const members = await ws.ref.collection('members').get();
  return NextResponse.json(
    {
      workspaceId: ws.id,
      company: ws.get('company'),
      joinCode: ws.get('joinCode') ?? null,
      members: members.docs.map((d) => ({
        uid: d.id,
        email: (d.get('email') as string | undefined) ?? '',
        displayName: (d.get('displayName') as string | undefined) ?? '',
        role: (d.get('role') as string | undefined) ?? 'member',
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

const patchSchema = z.object({ code: z.string().optional() });

export async function PATCH(req: Request) {
  const { user, ws } = await ownerWorkspace();
  if (!user || !ws) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  let next: string;
  if (parsed.data.code !== undefined) {
    // 직접 수정 — 형식만 강제한다 (영문+숫자 6~20자, 저장은 대문자)
    if (!JOIN_CODE_RE.test(parsed.data.code)) {
      return NextResponse.json({ error: 'invalid_format' }, { status: 400 });
    }
    next = parsed.data.code.toUpperCase();
  } else {
    next = generateJoinCode(); // 재발급 — 이전 코드는 그 즉시 무효 (퇴사자 유입 차단)
  }
  await ws.ref.set({ joinCode: next }, { merge: true });
  return NextResponse.json({ ok: true, joinCode: next });
}

const deleteSchema = z.object({ memberUid: z.string().min(8) });

export async function DELETE(req: Request) {
  const { user, ws } = await ownerWorkspace();
  if (!user || !ws) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const { memberUid } = parsed.data;
  if (memberUid === user.uid) {
    // 대표 자신은 제거 불가 — 회사 지갑의 주인이 사라지면 아무도 관리 못 한다
    return NextResponse.json({ error: 'cannot_remove_owner' }, { status: 400 });
  }

  try {
    const db = adminDb();
    const memberUserRef = db.collection('users').doc(memberUid);
    const memberUser = await memberUserRef.get();
    // 제거된 유저의 지갑을 본인 소유(개인) 워크스페이스로 되돌린다 — 첫 번째가 가입 시 만든 개인 지갑
    const ids = (memberUser.get('workspaceIds') as string[] | undefined) ?? [];
    const personal = ids.find((id) => id !== ws.id) ?? null;

    const batch = db.batch();
    batch.delete(ws.ref.collection('members').doc(memberUid));
    batch.set(
      memberUserRef,
      {
        workspaceIds: FieldValue.arrayRemove(ws.id),
        ...(personal ? { lastWorkspaceId: personal } : {}),
      },
      { merge: true },
    );
    await batch.commit();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[company/manage] remove', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'remove_failed' }, { status: 500 });
  }
}
