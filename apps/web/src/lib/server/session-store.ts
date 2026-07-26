/**
 * 세션 상태 + 기록 저장 (docs/03).
 *
 * 진행 중 상태(경과·하드 캡)는 in-memory로 빠르게 다루고,
 * 기록(세그먼트 원본·요약)은 Firestore에 남긴다 — 저장 실패가 통역을 멈추면 안 된다 (docs/01 §6).
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

// dev HMR에도 살아남도록 globalThis에 붙인다
const g = globalThis as typeof globalThis & {
  __interliveSessions?: Map<string, LiveSessionRecord>;
};
const sessions = (g.__interliveSessions ??= new Map<string, LiveSessionRecord>());

const ORPHAN_AFTER_MS = HEARTBEAT_INTERVAL_MS * HEARTBEAT_MISS_LIMIT;

export function maxDurationSecFromEnv(): number {
  return Number(process.env.SESSION_MAX_DURATION_SEC ?? 7200);
}

export function getSession(id: string): LiveSessionRecord | undefined {
  return sessions.get(id);
}

/** 하트비트 3회 유실 세션 → orphaned, 마지막 하트비트까지만 과금 (docs/01 §6) */
function sweepOrphans(now: number) {
  for (const s of sessions.values()) {
    if (s.status === 'live' && now - s.lastHeartbeatAtMs > ORPHAN_AFTER_MS) {
      s.status = 'orphaned';
      s.endedReason = 'orphaned';
      s.billedSeconds = Math.min(
        Math.round((s.lastHeartbeatAtMs - s.startedAtMs) / 1000),
        s.maxDurationSec,
      );
    }
  }
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

export function createSession(input: CreateSessionInput): LiveSessionRecord {
  const now = Date.now();
  sweepOrphans(now);
  const record: LiveSessionRecord = {
    id: crypto.randomUUID(),
    mode: input.mode,
    status: 'live',
    startedAtMs: now,
    lastHeartbeatAtMs: now,
    maxDurationSec: input.maxDurationSec,
    billedSeconds: 0,
    segmentCount: 0,
    uid: input.uid,
    workspaceId: input.workspaceId,
    sourceLang: input.sourceLang,
    targetLang: input.targetLang,
  };
  sessions.set(record.id, record);

  // 로그인 세션만 기록으로 남긴다 (비회원 체험은 저장하지 않는다)
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
}

/**
 * 확정 세그먼트 배치 저장 (docs/03 §3 — 부분 전사는 저장하지 않는다).
 * 저장 실패가 통역을 멈추면 안 되므로 예외를 밖으로 던지지 않는다.
 */
export async function saveSegments(
  sessionId: string,
  segments: IncomingSegment[],
): Promise<void> {
  if (segments.length === 0) return;
  const s = sessions.get(sessionId);
  if (!s?.uid) return; // 비회원 체험은 저장하지 않는다
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

export function heartbeat(
  id: string,
  segmentCountDelta: number,
): { terminate: boolean; remainingSec: number } | null {
  const now = Date.now();
  sweepOrphans(now);
  const s = sessions.get(id);
  if (!s || s.status !== 'live') return null;

  s.lastHeartbeatAtMs = now;
  s.segmentCount += segmentCountDelta;
  const elapsedSec = Math.round((now - s.startedAtMs) / 1000);
  s.billedSeconds = Math.min(elapsedSec, s.maxDurationSec);

  const remainingSec = Math.max(0, s.maxDurationSec - elapsedSec);
  if (remainingSec <= 0) {
    s.status = 'ended';
    s.endedReason = 'cap';
    return { terminate: true, remainingSec: 0 };
  }
  return { terminate: false, remainingSec };
}

export function endSession(
  id: string,
  reason: 'user' | 'cap' | 'error',
): { billedSeconds: number; segmentCount: number; record?: LiveSessionRecord } | null {
  const now = Date.now();
  const s = sessions.get(id);
  if (!s) return null;
  if (s.status === 'live') {
    s.status = 'ended';
    s.endedReason = reason;
    s.billedSeconds = Math.min(Math.round((now - s.startedAtMs) / 1000), s.maxDurationSec);
  }
  return { billedSeconds: s.billedSeconds, segmentCount: s.segmentCount, record: s };
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
