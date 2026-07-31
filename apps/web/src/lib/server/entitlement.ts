/**
 * 사용 권한 판정 — "이 사람이 지금 세션을 열 수 있는가".
 *
 * core.md §3-6: 분(minute)은 곧 돈이다.
 * 화면에 남은 시간을 표시하면서 실제로 막지 않으면 표시가 거짓말이 된다.
 * 세션을 여는 모든 경로는 반드시 이 파일을 거친다.
 */
import { cache } from 'react';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { cycleKey, getPlan } from '@sotong/shared/constants';
import type { PlanId } from '@sotong/shared/types';

export interface Entitlement {
  uid: string;
  workspaceId?: string;
  /** 워크스페이스 이름 — 사이드바가 이걸 또 읽지 않도록 여기서 같이 준다 */
  workspaceName?: string;
  /** 이 워크스페이스의 주인인가 */
  isOwner: boolean;
  plan: PlanId;
  /** 운영자 계정 — 한도 없이 사용 */
  isAdmin: boolean;
  includedMinutes: number;
  usedMinutes: number;
  /** 남은 분. 운영자는 Infinity */
  remainingMinutes: number;
  /** 포함 분 소진 후 초과 사용 허용 여부 */
  overageEnabled: boolean;
  /**
   * 운영자가 부여한 무제한 사용.
   *
   * overageEnabled와 다르다 — 저건 "초과분을 청구한다"이고 이건 "한도를 안 본다"이다.
   * 둘을 한 필드로 합치면 나중에 청구서를 만들 때 누가 공짜였는지 구분할 수 없다.
   */
  unlimited: boolean;
  /** 지금 세션을 열 수 있는가 */
  canStart: boolean;
}

/**
 * 운영자 이메일 목록.
 * 환경변수로 주입한다 — 코드에 사람 이메일을 박아두지 않는다.
 */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}

/**
 * 사용자의 현재 사용 권한을 읽는다. 실패해도 서비스가 멈추지 않도록 보수적으로 판정한다.
 *
 * ⚠ React cache로 감싸 **요청당 한 번만** 조회한다.
 * 레이아웃과 페이지가 각각 부르면 Firestore 왕복이 두 배가 된다 (실측 왕복 32~46ms).
 */
export const getEntitlement = cache(async function getEntitlement(
  uid: string,
  email?: string | null,
): Promise<Entitlement> {
  const admin = isAdminEmail(email);
  const free = getPlan('free');
  const fallback: Entitlement = {
    uid,
    plan: 'free',
    isAdmin: admin,
    isOwner: true,
    includedMinutes: free?.includedMinutes ?? 10,
    usedMinutes: 0,
    remainingMinutes: admin ? Number.POSITIVE_INFINITY : (free?.includedMinutes ?? 10),
    overageEnabled: false,
    unlimited: false,
    canStart: true,
  };

  try {
    const db = adminDb();
    const userSnap = await db.collection('users').doc(uid).get();
    // users 문서에 role이 박혀 있으면 그것도 인정한다 (콘솔에서 직접 부여 가능)
    const roleAdmin = userSnap.get('role') === 'admin';
    const isAdmin = admin || roleAdmin;

    const workspaceId = userSnap.get('lastWorkspaceId') as string | undefined;
    if (!workspaceId) {
      return {
        ...fallback,
        isAdmin,
        remainingMinutes: isAdmin ? Infinity : fallback.remainingMinutes,
      };
    }

    const wsRef = db.collection('workspaces').doc(workspaceId);
    const ws = await wsRef.get();
    const plan = (ws.get('plan') as PlanId | undefined) ?? 'free';
    const planDef = getPlan(plan);
    const billing = ws.get('billing') as
      | {
          includedMinutes?: number;
          usedMinutes?: number;
          overageEnabled?: boolean;
          unlimited?: boolean;
          cycleKey?: string;
        }
      | undefined;

    const includedMinutes = planDef?.includedMinutes ?? billing?.includedMinutes ?? 10;
    const overageEnabled = Boolean(billing?.overageEnabled);
    // 운영자가 켜 준 무제한 — 한도 계산 자체를 건너뛴다
    const unlimited = Boolean(billing?.unlimited);

    /**
     * 주기가 바뀌었으면 사용량을 되돌린다.
     * 배치가 아니라 '읽는 시점'에 갱신한다 — 배치가 멈춰도 유저가 막히지 않는다.
     */
    const nowKey = cycleKey(planDef?.cycle ?? 'monthly');
    let usedMinutes = billing?.usedMinutes ?? 0;
    if (billing?.cycleKey !== nowKey) {
      usedMinutes = 0;
      // 화면을 이 쓰기 때문에 기다리게 하지 않는다 — 다음 요청에서 반영돼도 무방하다
      void wsRef
        .set(
          {
            billing: {
              cycleKey: nowKey,
              usedMinutes: 0,
              includedMinutes,
              cycleStartedAt: FieldValue.serverTimestamp(),
            },
          },
          { merge: true },
        )
        .catch((e) => console.error('[entitlement] cycle reset failed', e));
    }
    const remainingMinutes =
      isAdmin || unlimited
        ? Number.POSITIVE_INFINITY
        : Math.max(0, includedMinutes - usedMinutes);

    return {
      uid,
      workspaceId,
      workspaceName: (ws.get('name') as string | undefined) ?? undefined,
      isOwner: (ws.get('ownerUid') as string | undefined) === uid,
      plan,
      isAdmin,
      includedMinutes,
      usedMinutes,
      overageEnabled,
      unlimited,
      remainingMinutes,
      // 운영자·무제한이거나, 남은 분이 있거나, 초과 사용을 켠 경우에만 시작할 수 있다
      canStart: isAdmin || unlimited || remainingMinutes > 0 || overageEnabled,
    };
  } catch (e) {
    console.error('[entitlement] lookup failed', e);
    return fallback;
  }
});

/**
 * 이번 세션에 허용할 최대 길이(초).
 * 남은 분보다 긴 세션을 열면 한도를 넘겨 쓰게 된다 (docs/07 §5.1).
 */
export function sessionCapSeconds(ent: Entitlement, baseCapSec: number): number {
  if (ent.isAdmin || ent.unlimited || ent.overageEnabled) return baseCapSec;
  return Math.max(60, Math.min(baseCapSec, Math.floor(ent.remainingMinutes * 60)));
}
