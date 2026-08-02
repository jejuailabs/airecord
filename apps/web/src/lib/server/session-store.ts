/**
 * 세션 상태 + 기록 저장 (docs/03).
 *
 * ⚠ 진행 중 상태는 **반드시 Firestore에 있어야 한다.**
 * 예전에는 globalThis 위의 Map에만 두었는데, Vercel에서는 start / heartbeat / end 요청이
 * 서로 다른 람다 인스턴스로 흩어진다. 그러면 heartbeat가 세션을 못 찾아 terminate를 내려보내고,
 * 통역이 시작하자마자 끊긴다(실제 사고 2026-07). 로컬에서는 한 프로세스라 절대 재현되지 않는다.
 *
 * 캐시도 두지 않는다. 인스턴스마다 캐시가 따로 늙어서, 다른 인스턴스가 하트비트를 받는 동안
 * 이쪽 캐시만 낡아 멀쩡한 세션을 orphaned로 오판한다. 10초에 문서 하나 읽는 값이 훨씬 싸다.
 *
 * core.md §3-6: 세션을 여는 코드는 반드시 하드 캡·하트비트·타임아웃을 함께 구현한다.
 * 서버는 클라이언트가 보고한 경과 시간을 믿지 않는다 — 자체 시계로만 센다 (docs/07 §5.1).
 */
import { FieldValue } from 'firebase-admin/firestore';
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_MISS_LIMIT,
  tokensForBilledSeconds,
  getPlan,
  postpaidEligible,
} from '@sotong/shared/constants';
import type { SessionMode, SessionStatus, SourceLangSetting, LangCode } from '@sotong/shared/types';
import { adminDb } from '@/lib/firebase/admin';

export interface LiveSessionRecord {
  id: string;
  mode: SessionMode;
  /**
   * 마주 1세션(턴 방식)인가. 마주지만 통역 연결이 한 번에 하나뿐이라
   * 원가·청구가 일반과 같은 1배다(2세션 마주만 2배). 청구 계산이 이 값을 본다.
   */
  single?: boolean;
  status: SessionStatus;
  startedAtMs: number;
  lastHeartbeatAtMs: number;
  maxDurationSec: number;
  billedSeconds: number;
  segmentCount: number;
  /** 로그인 세션이면 소유자 — 없으면 비회원 체험 */
  uid?: string;
  workspaceId?: string;
  sourceLang: SourceLangSetting;
  targetLang: LangCode;
  endedReason?: 'user' | 'cap' | 'error' | 'orphaned';
}

/**
 * 봇 id를 세션에 붙인다 (모드 A).
 *
 * ⚠ 반드시 저장해야 한다. Recall 웹훅은 botId만 주고 sessionId를 주지 않으므로,
 *   이 값이 없으면 워커가 어느 세션의 상태인지 찾을 수 없고 화면은 영원히 "입장 중"에 멈춘다.
 */
export async function attachBotId(sessionId: string, botId: string): Promise<void> {
  await liveRef(sessionId).set({ botId }, { merge: true });
}

/** 진행 중 세션의 제어 상태. 유저에게 보여주는 sessions/{id} 문서와 별개다. */
const LIVE_COL = 'liveSessions';

const ORPHAN_AFTER_MS = HEARTBEAT_INTERVAL_MS * HEARTBEAT_MISS_LIMIT;
/**
 * 회의는 웹 클라이언트(10초 하트비트)가 아니라 **워커가 30초 주기**로만 생존 신호를 찍는다.
 * 웹 기준(30초)을 그대로 쓰면 정상 진행 중인 회의도 읽는 타이밍에 따라 orphaned로 오판돼
 * 종료 시 상태·과금 초가 잘려 저장된다 (실사용 확인 2026-08-02 — 회의 기록 실종의 한 원인).
 */
const MEETING_ORPHAN_AFTER_MS = 90_000;

export function maxDurationSecFromEnv(): number {
  return Number(process.env.SESSION_MAX_DURATION_SEC ?? 7200);
}

/**
 * 청구에 쓰는 '실효 모드'.
 * 마주 1세션은 통역 연결이 하나뿐이라 원가가 일반과 같다 → 1배(inperson)로 청구한다.
 * 나머지는 저장된 mode 그대로. (usage 원장의 sec_/tok_ 버킷 라벨은 실제 mode를 쓴다)
 */
function billingMode(record: Pick<LiveSessionRecord, 'mode' | 'single'>): SessionMode {
  return record.mode === 'faceoff' && record.single ? 'inperson' : record.mode;
}

function liveRef(id: string) {
  return adminDb().collection(LIVE_COL).doc(id);
}

/**
 * 하트비트가 끊긴 세션은 읽는 시점에 orphaned로 본다.
 * 인스턴스마다 메모리가 다르므로 예전처럼 전체를 훑는 청소는 성립하지 않는다.
 */
function applyOrphan(rec: LiveSessionRecord, now: number): LiveSessionRecord {
  if (rec.status !== 'live') return rec;
  const limit = rec.mode === 'meeting' ? MEETING_ORPHAN_AFTER_MS : ORPHAN_AFTER_MS;
  if (now - rec.lastHeartbeatAtMs <= limit) return rec;
  return {
    ...rec,
    status: 'orphaned',
    endedReason: 'orphaned',
    billedSeconds: Math.min(
      Math.round((rec.lastHeartbeatAtMs - rec.startedAtMs) / 1000),
      rec.maxDurationSec,
    ),
  };
}

/**
 * 세션 제어 상태를 읽는다.
 * ⚠ Firestore 장애는 예외로 던진다 — "없음"과 구분되지 않으면 멀쩡한 통역을 끊게 된다.
 */
export async function getSession(id: string): Promise<LiveSessionRecord | undefined> {
  const snap = await liveRef(id).get();
  if (!snap.exists) return undefined;
  return applyOrphan(snap.data() as LiveSessionRecord, Date.now());
}

async function persist(rec: LiveSessionRecord): Promise<void> {
  await liveRef(rec.id).set(rec, { merge: true });
}

export interface CreateSessionInput {
  mode: SessionMode;
  /** 마주 1세션(턴 방식)이면 true — 청구를 1배로 잡는다 */
  single?: boolean;
  maxDurationSec: number;
  sourceLang: SourceLangSetting;
  targetLang: LangCode;
  uid?: string;
  workspaceId?: string;
  title?: string;
  /**
   * 회의 자막 공개 링크용 토큰 (모드 A).
   * 이걸 넘기면 viewerTokens/{token} 문서를 함께 만든다 — 로그인 없이 자막을 읽는 유일한 열쇠다.
   */
  viewerToken?: string;
  viewerTokenTtlSec?: number;
}

export async function createSession(input: CreateSessionInput): Promise<LiveSessionRecord> {
  const now = Date.now();
  const record: LiveSessionRecord = {
    id: crypto.randomUUID(),
    mode: input.mode,
    ...(input.single ? { single: true } : {}),
    status: 'live',
    startedAtMs: now,
    lastHeartbeatAtMs: now,
    maxDurationSec: input.maxDurationSec,
    billedSeconds: 0,
    segmentCount: 0,
    sourceLang: input.sourceLang,
    targetLang: input.targetLang,
    ...(input.uid ? { uid: input.uid } : {}),
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
  };

  // ⚠ 이 쓰기는 반드시 기다린다. 여기서 안 기다리면 첫 하트비트가 세션을 못 찾는다.
  await persist(record);

  /**
   * 뷰어 토큰도 반드시 기다린다.
   * 봇이 회의 채팅에 링크를 먼저 게시하는데 토큰 문서가 아직 없으면
   * 제일 먼저 누른 참가자가 "없는 링크"를 본다.
   */
  if (input.viewerToken) {
    const ttl = input.viewerTokenTtlSec ?? input.maxDurationSec + 3600;
    await adminDb()
      .collection('viewerTokens')
      .doc(input.viewerToken)
      .set({
        sessionId: record.id,
        createdAt: FieldValue.serverTimestamp(),
        expiresAtMs: now + ttl * 1000,
        revoked: false,
      });
  }

  // 로그인 세션만 유저에게 보이는 기록으로 남긴다 (비회원 체험은 저장하지 않는다)
  if (input.uid) {
    /**
     * ⚠ 이 쓰기도 기다린다. 예전엔 응답을 빨리 주려고 흘려보냈는데(void),
     * Vercel 람다는 응답 직후 얼어붙어 쓰기가 유실될 수 있다. 그러면 워커의
     * merge 쓰기가 **주인 없는 문서**를 만들어, 자막은 다 있는데 세션 기록
     * 조회(startedByUid)에 영영 안 걸린다 (실사용 확인 2026-08-02 — 회의 기록 실종).
     * 실패해도 세션 시작은 막지 않는다 — 종료 시 finalize가 메타를 복구한다.
     */
    await adminDb()
      .collection('sessions')
      .doc(record.id)
      .set({
        id: record.id,
        workspaceId: input.workspaceId ?? null,
        startedByUid: input.uid,
        mode: input.mode,
        status: 'live',
        sourceLang: input.sourceLang,
        targetLang: input.targetLang,
        title: input.title ?? null,
        engine: { provider: 'openai', model: process.env.TRANSLATION_MODEL_OPENAI ?? 'gpt-realtime-translate' },
        startedAt: FieldValue.serverTimestamp(),
        billedSeconds: 0,
        segmentCount: 0,
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch((e) => console.error('[session-store] create failed', e));
  }
  return record;
}

export interface IncomingSegment {
  seq: number;
  startMs: number;
  endMs?: number;
  sourceText: string;
  targetText: string;
  detectedLang?: string;
  /** 'paired'면 원문·번역이 짝지어진 줄. 기록·PDF가 배치를 정하는 데 쓴다. */
  kind?: 'target' | 'source' | 'paired';
  /** 마주통역 화자 (A=내 쪽, B=맞은편). 다른 모드는 없다. */
  speaker?: 'A' | 'B';
}

/**
 * 확정 세그먼트 배치 저장 (docs/03 §3 — 부분 전사는 저장하지 않는다).
 * 저장 실패가 통역을 멈추면 안 되므로 예외를 밖으로 던지지 않는다.
 * uid는 호출부가 넘긴다 — 여기서 세션을 다시 읽으면 읽기가 두 배가 된다.
 */
export async function saveSegments(
  sessionId: string,
  segments: IncomingSegment[],
): Promise<void> {
  if (segments.length === 0) return;
  try {
    const db = adminDb();
    const batch = db.batch();
    const col = db.collection('sessions').doc(sessionId).collection('segments');
    for (const seg of segments) {
      batch.set(
        col.doc(String(seg.seq).padStart(6, '0')),
        {
          seq: seg.seq,
          startMs: seg.startMs,
          endMs: seg.endMs ?? null,
          sourceText: seg.sourceText,
          targetText: seg.targetText,
          detectedLang: seg.detectedLang ?? null,
          kind: seg.kind ?? null,
          speaker: seg.speaker ?? null,
          isFinal: true,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    await batch.commit();
  } catch (e) {
    console.error('[session-store] segment batch failed', e);
  }
}

export interface HeartbeatResult {
  terminate: boolean;
  remainingSec: number;
  record: LiveSessionRecord;
}

/** 세션이 없거나 이미 끝났으면 null. Firestore 장애는 예외로 던진다. */
export async function heartbeat(
  id: string,
  segmentCountDelta: number,
): Promise<HeartbeatResult | null> {
  const now = Date.now();
  const s = await getSession(id);
  if (!s || s.status !== 'live') return null;

  const elapsedSec = Math.round((now - s.startedAtMs) / 1000);
  const remainingSec = Math.max(0, s.maxDurationSec - elapsedSec);
  const next: LiveSessionRecord = {
    ...s,
    lastHeartbeatAtMs: now,
    segmentCount: s.segmentCount + segmentCountDelta,
    billedSeconds: Math.min(elapsedSec, s.maxDurationSec),
    ...(remainingSec <= 0 ? { status: 'ended' as SessionStatus, endedReason: 'cap' as const } : {}),
  };
  await persist(next);
  return { terminate: remainingSec <= 0, remainingSec, record: next };
}

export async function endSession(
  id: string,
  reason: 'user' | 'cap' | 'error',
): Promise<{ billedSeconds: number; segmentCount: number; record: LiveSessionRecord } | null> {
  const now = Date.now();
  const s = await getSession(id);
  if (!s) return null;
  const next: LiveSessionRecord =
    s.status === 'live'
      ? {
          ...s,
          status: 'ended',
          endedReason: reason,
          billedSeconds: Math.min(Math.round((now - s.startedAtMs) / 1000), s.maxDurationSec),
        }
      : s;
  await persist(next);
  return { billedSeconds: next.billedSeconds, segmentCount: next.segmentCount, record: next };
}

/** 종료 시 세션 문서 마감 + 워크스페이스 사용 분 누적 */
export async function finalizeSessionDoc(record: LiveSessionRecord): Promise<void> {
  if (!record.uid) return;
  try {
    const db = adminDb();
    /**
     * 회의는 세그먼트를 **워커**가 쓰므로 웹의 liveSessions.segmentCount(워커 touch,
     * 30초 주기)가 실제보다 작거나 0일 수 있다. 저장된 줄 수를 직접 세서 큰 쪽을 쓴다 —
     * 목록의 "자막 N개"가 0으로 나오면 기록이 없는 것처럼 보인다 (실사용 확인 2026-08-02).
     */
    let segmentCount = record.segmentCount;
    if (record.mode === 'meeting') {
      try {
        const agg = await db
          .collection('sessions')
          .doc(record.id)
          .collection('segments')
          .count()
          .get();
        segmentCount = Math.max(segmentCount, agg.data().count);
      } catch {
        /* 집계 실패 — 있는 값으로 간다 */
      }
    }
    await db.collection('sessions').doc(record.id).set(
      {
        status: record.status,
        endedAt: FieldValue.serverTimestamp(),
        billedSeconds: record.billedSeconds,
        segmentCount,
        /**
         * 소유자 메타를 종료 시점에 한 번 더 못 박는다.
         * 시작 시 문서 쓰기가 유실됐어도 여기서 복구돼 기록 조회에 걸린다.
         */
        startedByUid: record.uid,
        workspaceId: record.workspaceId ?? null,
        mode: record.mode,
        sourceLang: record.sourceLang,
        targetLang: record.targetLang,
        startedAt: new Date(record.startedAtMs),
      },
      { merge: true },
    );
    if (record.workspaceId) {
      /**
       * 토큰 청구 (docs/07 §5.2, 사용자 지시 2026-08-01).
       * 분은 세션당 올림, 모드 배수를 곱한다 — 마주 10분이면 20토큰이 빠진다.
       * usedMinutes 필드명은 호환을 위해 유지하되 담기는 값은 '소비 토큰'이다.
       *
       * 정산 순서 (사용자 지시 2026-08-02) — 트랜잭션으로 읽고-계산하고-쓴다:
       *   1. 구독 포함분  2. 충전 잔액(topupTokens)  3. 후불(Pro 이상, 미결제 debtKrw로 적립)
       * 동시에 끝나는 세션 둘이 같은 충전 잔액을 겹쳐 쓰지 않으려면 증분만으로는 안 되고,
       * 잔액을 읽은 값 기준으로 나눠야 하므로 트랜잭션이 필요하다.
       */
      const tokens = tokensForBilledSeconds(billingMode(record), record.billedSeconds);
      const wsRef = db.collection('workspaces').doc(record.workspaceId);
      const overage = await db.runTransaction(async (tx) => {
        const ws = await tx.get(wsRef);
        const plan = getPlan((ws.get('plan') as string | undefined) ?? 'free');
        const b = (ws.get('billing') ?? {}) as {
          includedMinutes?: number;
          usedMinutes?: number;
          topupTokens?: number;
          unlimited?: boolean;
        };
        const included = plan?.includedMinutes ?? b.includedMinutes ?? 0;
        const used = b.usedMinutes ?? 0;
        const topup = Math.max(0, b.topupTokens ?? 0);

        // 이번 세션이 '포함분 너머'로 쓴 토큰 (이전 세션이 이미 넘긴 몫은 제외)
        const overflow = b.unlimited
          ? 0
          : Math.max(0, used + tokens - included) - Math.max(0, used - included);
        const topupUse = Math.min(topup, overflow);
        const rest = overflow - topupUse;
        // 후불 대상 플랜만 미결제로 적립. 그 외(캡 올림 오차 등)는 소액이라 그냥 흡수한다.
        const debtKrw =
          rest > 0 && postpaidEligible(plan) ? rest * (plan?.overageKrwPerMin ?? 0) : 0;

        tx.set(
          wsRef,
          {
            billing: {
              usedMinutes: FieldValue.increment(tokens),
              ...(topupUse > 0 ? { topupTokens: FieldValue.increment(-topupUse) } : {}),
              ...(debtKrw > 0
                ? {
                    debtKrw: FieldValue.increment(debtKrw),
                    debtTokens: FieldValue.increment(rest),
                  }
                : {}),
            },
          },
          { merge: true },
        );
        return debtKrw > 0 ? { tokens: rest, krw: debtKrw } : null;
      });

      // 후불이 발생했으면 세션 문서에도 남긴다 — 정산 화면·감사용
      if (overage) {
        await db
          .collection('sessions')
          .doc(record.id)
          .set({ overage: { ...overage, settled: false } }, { merge: true });
      }

      // 날짜별 사용 원장 — 대시보드·운영콘솔·예상비용의 단일 소스 (docs/03 §2)
      await recordUsage(record);
    }
  } catch (e) {
    console.error('[session-store] finalize failed', e);
  }
}

/**
 * 날짜 × 워크스페이스 × mode별 사용 원장.
 *
 * 왜 필요한가 — 예전엔 이게 없어서 화면마다 최근 세션을 즉석 집계했다.
 *   그 결과 "오늘 사용량(주기 누적)"과 "대면 67분(전체 합산)"이 서로 다른 걸 세어 어긋났다.
 *   여기 하나에만 적립하고, 모든 화면이 이걸 읽으면 숫자가 한 축에서 맞물린다.
 *
 * 문서 경로: usage/{workspaceId}/daily/{YYYY-MM-DD}
 *   · billedSeconds를 mode별로 누적(초). 분 환산은 읽는 쪽에서 세션당 올림이 아니라
 *     "그날 총초 → 분"으로 한다 (원장은 원자료를 담고, 표시 규칙은 표시하는 쪽이 정한다).
 *   · uid·email도 남긴다 — 계정별 조회용.
 */
export async function recordUsage(record: LiveSessionRecord): Promise<void> {
  if (!record.workspaceId || record.billedSeconds <= 0) return;
  const day = new Date(record.startedAtMs).toISOString().slice(0, 10);
  const mode = record.mode; // 'inperson' | 'meeting' | 'faceoff' (버킷 라벨은 실제 mode)
  // 토큰은 실효 모드로 계산한다 — 마주 1세션은 1배
  const tokens = tokensForBilledSeconds(billingMode(record), record.billedSeconds);
  try {
    await adminDb()
      .collection('usage')
      .doc(record.workspaceId)
      .collection('daily')
      .doc(day)
      .set(
        {
          day,
          workspaceId: record.workspaceId,
          uid: record.uid ?? null,
          totalSec: FieldValue.increment(record.billedSeconds),
          [`sec_${mode}`]: FieldValue.increment(record.billedSeconds),
          // 토큰도 모드 배수 반영해 누적 — 운영콘솔이 초→토큰 재계산 없이 바로 읽는다
          tokens: FieldValue.increment(tokens),
          [`tok_${mode}`]: FieldValue.increment(tokens),
          sessions: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  } catch (e) {
    // 원장 실패로 종료를 막지 않는다 — 청구(usedMinutes)는 위에서 이미 반영됐다
    console.error('[session-store] recordUsage failed', e);
  }
}
