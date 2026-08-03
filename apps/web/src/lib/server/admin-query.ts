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
  /** 최근 30일 추정 원가 (KRW) — mode별 단가 반영 */
  estCostKrw: number;
  /** 일별 사용 분 — 최근 14일 */
  daily: Array<{ day: string; minutes: number }>;
  /** 마주 1세션(실험) 소비 — 이 테스트가 얼마나 돌았는지만 가볍게 본다 */
  singleTest: { sessions: number; minutes: number };
}

/** 사용 원장 한 줄 (날짜 × 계정) */
export interface UsageLogRow {
  day: string;
  workspaceId: string;
  uid: string | null;
  email: string | null;
  workspaceName: string | null;
  inpersonMin: number;
  meetingMin: number;
  faceoffMin: number;
  totalMin: number;
  /** 이 줄의 mode 구성으로 계산한 추정 원가 (KRW) */
  estCostKrw: number;
}

/** 번역 로그 한 줄 — 파일·텍스트·원본형 번역 1건 (관리자용, translationRecords 교차 조회) */
export interface TranslationLogRow {
  id: string;
  createdAtMs: number | null;
  /** 'text' | 'file' | 'layout' — 카테고리(셀 색·필터의 축) */
  kind: string;
  title: string;
  sourceLang: string;
  targetLang: string;
  uid: string | null;
  email: string | null;
  workspaceName: string | null;
  pageCount: number | null;
  charCount: number | null;
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

/**
 * mode별 분당 원가(원) — docs/07 §2. 환경변수가 없으면 0(화면에서 "미설정").
 *
 * 모드마다 실제 구성이 다르다:
 *   inperson — 번역 1세션
 *   meeting  — 번역 1세션 + 회의 봇
 *   faceoff  — 번역 **2세션** (양방향 동시, gpt-realtime-translate가 출력 언어를 하나만 내므로)
 * 예전 함수는 전부 번역+봇으로 계산해 대면 원가를 과대평가했다.
 */
export function costKrwPerMinByMode(mode: 'inperson' | 'meeting' | 'faceoff'): number {
  const translate = Number(process.env.COST_TRANSLATE_USD_PER_MIN ?? 0);
  const bot = Number(process.env.COST_BOT_USD_PER_MIN ?? 0);
  const overhead = 1 + Number(process.env.COST_INFRA_OVERHEAD_PCT ?? 0) / 100;
  const krw = Number(process.env.USD_KRW_RATE ?? 0);
  const usd =
    mode === 'meeting' ? translate + bot : mode === 'faceoff' ? translate * 2 : translate;
  return usd * overhead * krw;
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
    singleTestSnap,
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
      .select('startedAt', 'billedSeconds', 'mode')
      .limit(5_000)
      .get(),
    /**
     * 마주 1세션(실험) 소비량 — single==true 는 단일 필드라 자동 인덱스로 충분하다(복합 인덱스 불필요).
     * 테스트 세션은 소수라 문서를 직접 읽어 코드에서 합해도 싸다.
     */
    sessions.where('single', '==', true).select('billedSeconds').limit(2_000).get(),
  ]);

  const bucket = new Map<string, number>();
  for (let i = 13; i >= 0; i--) bucket.set(dayKey(now - i * 86_400_000), 0);
  let billed30sec = 0;
  let cost30 = 0; // mode별 단가로 30일 추정 원가를 쌓는다
  for (const doc of recent.docs) {
    const started = doc.get('startedAt') as Timestamp | undefined;
    if (!started) continue;
    const sec = num(doc.get('billedSeconds'));
    const mode = (doc.get('mode') as 'inperson' | 'meeting' | 'faceoff') ?? 'inperson';
    billed30sec += sec; // 30일 합계 (읽어온 범위 자체가 30일이다)
    cost30 += (sec / 60) * costKrwPerMinByMode(mode);
    const key = dayKey(started.toMillis()); // 버킷은 14일만 있으므로 그 밖은 자동으로 무시된다
    if (bucket.has(key)) bucket.set(key, bucket.get(key)! + sec / 60);
  }

  const billedMinutes = num(billedAll.data().s) / 60;

  // 마주 1세션(실험) 소비 — 횟수와 총 분만 가볍게 센다
  const singleTestSec = singleTestSnap.docs.reduce((sum, d) => sum + num(d.get('billedSeconds')), 0);

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
    // 최근 30일 추정 원가 — mode별 단가로 계산(대면·회의·마주 구성이 다름)
    estCostKrw: Math.round(cost30),
    daily: [...bucket.entries()].map(([day, minutes]) => ({ day, minutes: Math.round(minutes) })),
    singleTest: {
      sessions: singleTestSnap.size,
      minutes: Math.round(singleTestSec / 60),
    },
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

/**
 * 사용 원장 조회 — 날짜 × 계정.
 *
 * usage/{workspaceId}/daily/{day} 를 collectionGroup으로 가로질러 읽는다.
 * ⚠ 필터는 'day'(문자열) 한 개만 건다 — ISO 날짜는 사전순=시간순이라 정렬 겸용이고,
 *   단일 필드라 복합 인덱스를 요구하지 않는다(where+정렬 조합이 인덱스를 부르는 걸 이미 겪었다).
 *
 * 워크스페이스 이름은 한 번에 모아 붙인다(줄마다 따로 읽지 않는다).
 */
export async function getUsageLog(days = 30, limit = 500): Promise<UsageLogRow[]> {
  const db = adminDb();
  const since = dayKey(Date.now() - days * 86_400_000);

  /**
   * ⚠ collectionGroup에 where('day')나 orderBy를 걸면 COLLECTION_GROUP 인덱스를 요구한다(실측).
   *   인덱스는 배포 환경마다 따로 만들어야 해서 이 화면을 거기 묶는다.
   *   그래서 **필터 없이** 끌어와(이건 인덱스 불필요, 실측 확인) 코드에서 날짜로 거르고 정렬한다.
   *   원장 문서 수 = 워크스페이스 × 활동일이라 지금 규모에선 넉넉하다.
   *   상한에 닿으면 조용히 자르지 않고 로그를 남긴다 — 절단이 "다 봤다"로 읽히면 안 된다.
   */
  const RAW_CAP = 3_000;
  const snap = await db.collectionGroup('daily').limit(RAW_CAP).get();
  if (snap.size >= RAW_CAP) {
    console.warn(`[admin] usage ledger hit raw cap ${RAW_CAP} — 일부 날짜가 누락될 수 있음`);
  }
  const docs = snap.docs
    .filter((d) => ((d.get('day') as string | undefined) ?? '') >= since)
    .sort((a, b) => ((b.get('day') as string) ?? '').localeCompare((a.get('day') as string) ?? ''))
    .slice(0, limit);
  if (docs.length === 0) return [];

  const wsIds = [
    ...new Set(docs.map((d) => d.get('workspaceId') as string | undefined).filter(Boolean) as string[]),
  ];
  const wsDocs = wsIds.length
    ? await db.getAll(...wsIds.map((id) => db.collection('workspaces').doc(id)))
    : [];
  const wsById = new Map(wsDocs.filter((d) => d.exists).map((d) => [d.id, d]));

  return docs.map((d) => {
    const wsId = (d.get('workspaceId') as string | undefined) ?? '';
    const ws = wsById.get(wsId);
    const inSec = num(d.get('sec_inperson'));
    const meSec = num(d.get('sec_meeting'));
    const faSec = num(d.get('sec_faceoff'));
    const cost =
      (inSec / 60) * costKrwPerMinByMode('inperson') +
      (meSec / 60) * costKrwPerMinByMode('meeting') +
      (faSec / 60) * costKrwPerMinByMode('faceoff');
    return {
      day: (d.get('day') as string | undefined) ?? '',
      workspaceId: wsId,
      uid: (d.get('uid') as string | undefined) ?? null,
      email: (ws?.get('name') as string | undefined) ?? null,
      workspaceName: (ws?.get('name') as string | undefined) ?? null,
      inpersonMin: Math.round(inSec / 60),
      meetingMin: Math.round(meSec / 60),
      faceoffMin: Math.round(faSec / 60),
      totalMin: Math.round((inSec + meSec + faSec) / 60),
      estCostKrw: Math.round(cost),
    };
  });
}

/**
 * 번역 로그 — 파일·텍스트·원본형 번역 기록(translationRecords)을 교차 조회한다.
 *
 * translationRecords는 최상위 평면 컬렉션이라 collectionGroup이 필요 없다.
 * ⚠ 다만 orderBy('createdAt')를 걸면 인덱스를 요구할 수 있어(usage 원장에서 겪음),
 *   **필터·정렬 없이** 상한만큼 끌어와 코드에서 최신순으로 정렬한다.
 * 계정 이름·이메일은 한 번에 모아 붙인다(줄마다 따로 읽지 않는다).
 */
export async function getTranslationLog(limit = 500): Promise<TranslationLogRow[]> {
  const db = adminDb();
  const RAW_CAP = 3_000;
  const snap = await db.collection('translationRecords').limit(RAW_CAP).get();
  if (snap.size >= RAW_CAP) {
    console.warn(`[admin] translation log hit raw cap ${RAW_CAP} — 일부 기록이 누락될 수 있음`);
  }
  const toMs = (v: unknown): number | null => {
    const t = v as { toMillis?: () => number } | undefined;
    return typeof t?.toMillis === 'function' ? t.toMillis() : null;
  };
  const docs = snap.docs
    .sort((a, b) => (toMs(b.get('createdAt')) ?? 0) - (toMs(a.get('createdAt')) ?? 0))
    .slice(0, limit);
  if (docs.length === 0) return [];

  const uids = [
    ...new Set(docs.map((d) => d.get('uid') as string | undefined).filter(Boolean) as string[]),
  ];
  const wsIds = [
    ...new Set(
      docs.map((d) => d.get('workspaceId') as string | undefined).filter(Boolean) as string[],
    ),
  ];
  const [userDocs, wsDocs] = await Promise.all([
    uids.length ? db.getAll(...uids.map((id) => db.collection('users').doc(id))) : [],
    wsIds.length ? db.getAll(...wsIds.map((id) => db.collection('workspaces').doc(id))) : [],
  ]);
  const userById = new Map(userDocs.filter((d) => d.exists).map((d) => [d.id, d]));
  const wsById = new Map(wsDocs.filter((d) => d.exists).map((d) => [d.id, d]));

  return docs.map((d) => {
    const uid = (d.get('uid') as string | undefined) ?? null;
    const wsId = (d.get('workspaceId') as string | undefined) ?? '';
    return {
      id: d.id,
      createdAtMs: toMs(d.get('createdAt')),
      kind: (d.get('kind') as string | undefined) ?? 'file',
      title: (d.get('title') as string | undefined) ?? '',
      sourceLang: (d.get('sourceLang') as string | undefined) ?? 'auto',
      targetLang: (d.get('targetLang') as string | undefined) ?? 'en',
      uid,
      email: uid ? ((userById.get(uid)?.get('email') as string | undefined) ?? null) : null,
      workspaceName: (wsById.get(wsId)?.get('name') as string | undefined) ?? null,
      pageCount: num(d.get('pageCount'), 0) || null,
      charCount: num(d.get('charCount'), 0) || null,
    };
  });
}
