/**
 * 운영 지표 집계.
 *
 * ⚠ 전체 문서를 읽어 세지 않는다. Firestore 집계 쿼리(count/sum)는 문서를 내려받지 않고
 *   서버에서 세므로, 세션이 수만 건이 돼도 요금과 지연이 폭발하지 않는다.
 *   목록만 실제로 읽고, 그것도 상한을 둔다.
 *
 * 원가는 docs/07 환경변수로 주입한다 — 코드에 단가를 박지 않는다.
 */
import { AggregateField, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getPlan, cycleKey } from '@sotong/shared/constants';
import type { PlanId } from '@sotong/shared/types';

/** 목록에 한 번에 실어 보낼 최대 인원 — 화면이 감당할 수 있는 양을 넘기지 않는다 */
export const USER_PAGE_SIZE = 50;

export interface AdminOverview {
  users: number;
  workspaces: number;
  /** 무제한이 켜진 워크스페이스 수 — 돈이 새는 곳이라 항상 보여야 한다 */
  unlimitedWorkspaces: number;
  sessions: { total: number; meeting: number; inperson: number };
  /** 누적 통역 시간(분) */
  billedMinutes: number;
  /** 최근 30일 통역 시간(분) */
  billedMinutes30d: number;
  /** 지금 진행 중인 세션 */
  liveSessions: number;
  /** 누적 추정 원가 (KRW) */
  estCostKrw: number;
  /** 일별 사용 분 — 최근 14일 */
  daily: Array<{ day: string; minutes: number }>;
}

export interface AdminUserRow {
  uid: string;
  email: string | null;
  name: string | null;
  role: string | null;
  createdAtMs: number | null;
  workspaceId: string | null;
  workspaceName: string | null;
  plan: PlanId;
  includedMinutes: number;
  usedMinutes: number;
  unlimited: boolean;
  overageEnabled: boolean;
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** 분당 원가(원) — docs/07 §2. 환경변수가 없으면 0으로 두고 화면에서 "미설정"으로 보인다. */
function costKrwPerMin(): number {
  const usdPerMin =
    Number(process.env.COST_TRANSLATE_USD_PER_MIN ?? 0) +
    Number(process.env.COST_BOT_USD_PER_MIN ?? 0);
  const overhead = 1 + Number(process.env.COST_INFRA_OVERHEAD_PCT ?? 0) / 100;
  const krw = Number(process.env.USD_KRW_RATE ?? 0);
  return usdPerMin * overhead * krw;
}

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function getAdminOverview(): Promise<AdminOverview> {
  const db = adminDb();
  const now = Date.now();
  const since30d = Timestamp.fromMillis(now - 30 * 86_400_000);

  const sessions = db.collection('sessions');

  // 집계는 병렬로 — 하나씩 기다리면 화면이 느려진다
  const [
    usersCount,
    wsCount,
    unlimitedCount,
    totalCount,
    meetingCount,
    inpersonCount,
    billedAll,
    liveCount,
    recent,
  ] = await Promise.all([
    db.collection('users').count().get(),
    db.collection('workspaces').count().get(),
    db.collection('workspaces').where('billing.unlimited', '==', true).count().get(),
    sessions.count().get(),
    sessions.where('mode', '==', 'meeting').count().get(),
    sessions.where('mode', '==', 'inperson').count().get(),
    sessions.aggregate({ s: AggregateField.sum('billedSeconds') }).get(),
    db.collection('liveSessions').where('status', '==', 'live').count().get(),
    /**
     * ⚠ where + sum 을 함께 쓰면 복합 인덱스를 요구한다(실측: FAILED_PRECONDITION).
     *   콘솔에서 인덱스를 만들 수도 있지만, 그러면 이 화면이 배포 환경마다 인덱스에 묶인다.
     *   최근 30일치를 한 번만 읽어 코드에서 합한다 — 30일 합계와 일별 추이를 이 한 번으로 다 만든다.
     */
    sessions
      .where('startedAt', '>=', since30d)
      .select('startedAt', 'billedSeconds')
      .limit(5_000)
      .get(),
  ]);

  const bucket = new Map<string, number>();
  for (let i = 13; i >= 0; i--) bucket.set(dayKey(now - i * 86_400_000), 0);
  let billed30sec = 0;
  for (const doc of recent.docs) {
    const started = doc.get('startedAt') as Timestamp | undefined;
    if (!started) continue;
    const sec = num(doc.get('billedSeconds'));
    billed30sec += sec; // 30일 합계 (읽어온 범위 자체가 30일이다)
    const key = dayKey(started.toMillis()); // 버킷은 14일만 있으므로 그 밖은 자동으로 무시된다
    if (bucket.has(key)) bucket.set(key, bucket.get(key)! + sec / 60);
  }

  const billedMinutes = num(billedAll.data().s) / 60;

  return {
    users: usersCount.data().count,
    workspaces: wsCount.data().count,
    unlimitedWorkspaces: unlimitedCount.data().count,
    sessions: {
      total: totalCount.data().count,
      meeting: meetingCount.data().count,
      inperson: inpersonCount.data().count,
    },
    billedMinutes: Math.round(billedMinutes),
    billedMinutes30d: Math.round(billed30sec / 60),
    liveSessions: liveCount.data().count,
    estCostKrw: Math.round(billedMinutes * costKrwPerMin()),
    daily: [...bucket.entries()].map(([day, minutes]) => ({ day, minutes: Math.round(minutes) })),
  };
}

/**
 * 회원 목록.
 * 워크스페이스를 회원마다 따로 읽지 않는다 — 한 번에 모아 읽어 왕복을 줄인다.
 */
export async function listAdminUsers(limit = USER_PAGE_SIZE): Promise<AdminUserRow[]> {
  const db = adminDb();
  const snap = await db
    .collection('users')
    .orderBy('createdAt', 'desc')
    .limit(Math.min(limit, 200))
    .get();
  if (snap.empty) return [];

  const wsIds = [
    ...new Set(
      snap.docs.map((d) => d.get('lastWorkspaceId') as string | undefined).filter(Boolean) as string[],
    ),
  ];
  const wsDocs = wsIds.length
    ? await db.getAll(...wsIds.map((id) => db.collection('workspaces').doc(id)))
    : [];
  const wsById = new Map(wsDocs.filter((d) => d.exists).map((d) => [d.id, d]));

  return snap.docs.map((d) => {
    const wsId = (d.get('lastWorkspaceId') as string | undefined) ?? null;
    const ws = wsId ? wsById.get(wsId) : undefined;
    const plan = ((ws?.get('plan') as PlanId | undefined) ?? 'free') as PlanId;
    const billing = (ws?.get('billing') ?? {}) as Record<string, unknown>;
    const created = d.get('createdAt') as Timestamp | undefined;

    return {
      uid: d.id,
      email: (d.get('email') as string | undefined) ?? null,
      name: (d.get('name') as string | undefined) ?? null,
      role: (d.get('role') as string | undefined) ?? null,
      createdAtMs: created?.toMillis() ?? null,
      workspaceId: wsId,
      workspaceName: (ws?.get('name') as string | undefined) ?? null,
      plan,
      includedMinutes: getPlan(plan)?.includedMinutes ?? num(billing.includedMinutes, 10),
      // 주기가 지났으면 실제로는 0이다 — 화면이 낡은 수치를 보여주지 않게 여기서 맞춘다
      usedMinutes:
        billing.cycleKey === cycleKey(getPlan(plan)?.cycle ?? 'monthly')
          ? num(billing.usedMinutes)
          : 0,
      unlimited: billing.unlimited === true,
      overageEnabled: billing.overageEnabled === true,
    };
  });
}
