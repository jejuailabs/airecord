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
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_MISS_LIMIT } from '@sotong/shared/constants';
import type { SessionMode, SessionStatus, SourceLangSetting, LangCode } from '@sotong/shared/types';
import { adminDb } from '@/lib/firebase/admin';

export interface LiveSessionRecord {
  id: string;
  mode: SessionMode;
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

/** 진행 중 세션의 제어 상태. 유저에게 보여주는 sessions/{id} 문서와 별개다. */
const LIVE_COL = 'liveSessions';

const ORPHAN_AFTER_MS = HEARTBEAT_INTERVAL_MS * HEARTBEAT_MISS_LIMIT;

export function maxDurationSecFromEnv(): number {
  return Number(process.env.SESSION_MAX_DURATION_SEC ?? 7200);
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
  if (now - rec.lastHeartbeatAtMs <= ORPHAN_AFTER_MS) return rec;
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
  maxDurationSec: number;
  sourceLang: SourceLangSetting;
  targetLang: LangCode;
  uid?: string;
  workspaceId?: string;
  title?: string;
}

export async function createSession(input: CreateSessionInput): Promise<LiveSessionRecord> {
  const now = Date.now();
  const record: LiveSessionRecord = {
    id: crypto.randomUUID(),
    mode: input.mode,
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

  // 로그인 세션만 유저에게 보이는 기록으로 남긴다 (비회원 체험은 저장하지 않는다)
  if (input.uid) {
    void adminDb()
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
    await db.collection('sessions').doc(record.id).set(
      {
        status: record.status,
        endedAt: FieldValue.serverTimestamp(),
        billedSeconds: record.billedSeconds,
        segmentCount: record.segmentCount,
      },
      { merge: true },
    );
    if (record.workspaceId) {
      // 초 단위로 세고 세션당 올림하여 분 단위 청구 (docs/07 §5.2)
      const minutes = Math.ceil(record.billedSeconds / 60);
      await db
        .collection('workspaces')
        .doc(record.workspaceId)
        .set({ billing: { usedMinutes: FieldValue.increment(minutes) } }, { merge: true });
    }
  } catch (e) {
    console.error('[session-store] finalize failed', e);
  }
}
