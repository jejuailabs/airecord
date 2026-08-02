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
import {
  cycleKey,
  getPlan,
  secondsForTokens,
  POSTPAID_LIMIT_TOKENS,
  postpaidEligible,
} from '@sotong/shared/constants';
import type { PlanId, SessionMode } from '@sotong/shared/types';

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
  /** 충전 팩으로 산 토큰 잔액 — 주기 리셋과 무관하게 이월. 포함분 소진 후에 소비된다 */
  topupTokens: number;
  /** 후불 사용 미결제 금액(원). 0보다 크면 새 세션을 열 수 없다 */
  debtKrw: number;
  /**
   * 이번 세션에서 잔액 소진 후 추가로 쓸 수 있는 후불 토큰.
   * Pro 이상만 > 0. 세션 길이 캡에 더해져 회의 중 끊김을 막는다 (사용자 지시 2026-08-02).
   */
  postpaidLimitTokens: number;
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
    topupTokens: 0,
    debtKrw: 0,
    postpaidLimitTokens: 0,
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
          topupTokens?: number;
          debtKrw?: number;
        }
      | undefined;

    const includedMinutes = planDef?.includedMinutes ?? billing?.includedMinutes ?? 10;
    const overageEnabled = Boolean(billing?.overageEnabled);
    // 운영자가 켜 준 무제한 — 한도 계산 자체를 건너뛴다
    const unlimited = Boolean(billing?.unlimited);
    // 충전 잔액은 주기 리셋의 영향을 받지 않는다 — 산 토큰을 날리면 환불 분쟁이 된다
    const topupTokens = Math.max(0, billing?.topupTokens ?? 0);
    const debtKrw = Math.max(0, billing?.debtKrw ?? 0);

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
    // 남은 토큰 = 포함분 잔여 + 충전 잔액 (충전분은 포함분 소진 후 소비된다)
    const remainingMinutes =
      isAdmin || unlimited
        ? Number.POSITIVE_INFINITY
        : Math.max(0, includedMinutes - usedMinutes) + topupTokens;

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
      topupTokens,
      debtKrw,
      postpaidLimitTokens: postpaidEligible(planDef) ? POSTPAID_LIMIT_TOKENS : 0,
      remainingMinutes,
      /**
       * 시작 가능 판정.
       * 후불 미결제가 남아 있으면 잔액이 있어도 막는다 (사용자 지시 2026-08-02:
       * "종료되면 그걸 결제하지 않으면 진행이 되지 않게"). 운영자·무제한만 예외.
       */
      canStart:
        isAdmin ||
        unlimited ||
        (debtKrw <= 0 && (remainingMinutes > 0 || overageEnabled)),
    };
  } catch (e) {
    console.error('[entitlement] lookup failed', e);
    return fallback;
  }
});

/**
 * 이번 세션에 허용할 최대 길이(초).
 * 남은 토큰보다 오래 세션을 열면 한도를 넘겨 쓰게 된다 (docs/07 §5.1).
 *
 * mode를 넘기면 모드 배수로 나눠 캡을 정한다 — 마주(2배)는 남은 토큰으로 절반 시간만 열린다.
 * 안 넘기면 일반(1배)으로 본다(하위호환).
 */
export function sessionCapSeconds(
  ent: Entitlement,
  baseCapSec: number,
  mode: SessionMode = 'inperson',
): number {
  /**
   * 무제한 권한(운영자·무제한 부여)은 세션 길이도 제한하지 않는다.
   * 예전엔 baseCapSec(개발 안전용 5분)을 그대로 돌려줘, 무제한인데도 5분에 세션이 끊겼다.
   * 총 시간이 무제한이면 세션 길이도 무제한이어야 앞뒤가 맞는다.
   */
  if (ent.isAdmin || ent.unlimited) return UNLIMITED_SESSION_SEC;
  // 초과 사용 허용은 "청구하며 계속"이라 세션 길이 캡은 그대로 둔다 (폭주 방지)
  if (ent.overageEnabled) return baseCapSec;
  /**
   * 남은 토큰 + 후불 크레딧(Pro 이상 60토큰) → 이 모드로 열 수 있는 초.
   * 크레딧 덕에 회의 중 토큰이 소진돼도 일반 60분·회의 40분·마주 30분은 이어진다.
   * 초과분은 종료 시 미결제로 쌓이고, 결제 전까지 새 세션이 막힌다 (finalizeSessionDoc).
   * 마주는 rate=2라 같은 토큰으로 절반만 열린다.
   */
  return Math.max(
    60,
    Math.min(baseCapSec, secondsForTokens(mode, ent.remainingMinutes + ent.postpaidLimitTokens)),
  );
}

/**
 * 무제한 세션의 상한.
 * Infinity를 쓰면 JSON 직렬화·클라이언트 setInterval 계산이 깨지므로 큰 유한값을 쓴다.
 * 24시간 — 실사용에서 한 세션이 이보다 길 일은 없고, 방치된 세션의 안전망은 남긴다.
 */
export const UNLIMITED_SESSION_SEC = 24 * 60 * 60;
