/**
 * 운영자 권한 (docs/03 §4).
 *
 * ⚠ 등급을 둘로 가른다. 하나로 두면 안 된다.
 *
 *   슈퍼관리자 — ADMIN_EMAILS 환경변수에 적힌 사람. 배포 권한이 있어야 바꿀 수 있다.
 *                회원에게 **무제한 사용을 부여**할 수 있다.
 *   일반 관리자 — users/{uid}.role === 'admin'. 콘솔에서 문서 하나만 고치면 된다.
 *                지표와 회원 목록을 **보기만** 한다.
 *
 * 이유: role 필드는 Firestore 문서 한 줄이다. 그걸 심을 수 있는 사람이
 * 곧바로 원가가 무제한으로 나가는 스위치까지 쥐면 안 된다.
 * 무제한은 곧 돈이다 (core.md §3-6).
 */
import { cookies } from 'next/headers';
import { adminDb, SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { isAdminEmail } from './entitlement';

export interface AdminIdentity {
  uid: string;
  email: string | null;
  /** 지표·목록 열람 가능 */
  isAdmin: boolean;
  /** 무제한 부여 등 돈이 나가는 설정 변경 가능 */
  isSuper: boolean;
}

/**
 * 지금 요청자가 운영자인가.
 * 아니면 null — 호출부는 404로 응답한다(403이면 관리자 화면의 존재가 드러난다).
 */
export async function currentAdmin(): Promise<AdminIdentity | null> {
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie).catch(() => null);
  if (!user) return null;

  const isSuper = isAdminEmail(user.email);
  let roleAdmin = false;
  if (!isSuper) {
    try {
      const snap = await adminDb().collection('users').doc(user.uid).get();
      roleAdmin = snap.get('role') === 'admin';
    } catch {
      roleAdmin = false;
    }
  }
  if (!isSuper && !roleAdmin) return null;

  return { uid: user.uid, email: user.email ?? null, isAdmin: true, isSuper };
}

/**
 * 운영 조치를 남긴다.
 *
 * 무제한 부여처럼 돈이 나가는 변경은 **누가 언제 왜** 했는지 남아야 한다.
 * 나중에 "이 계정 왜 무제한이지?"를 물을 사람이 반드시 생긴다.
 */
export async function writeAuditLog(entry: {
  actorUid: string;
  actorEmail: string | null;
  action: string;
  targetUid?: string;
  targetWorkspaceId?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await adminDb()
      .collection('adminAuditLogs')
      .add({ ...entry, atMs: Date.now() });
  } catch (e) {
    // 기록 실패로 조치를 막지는 않는다 — 다만 로그에는 반드시 남긴다
    console.error('[admin] audit log failed', entry.action, e);
  }
}
