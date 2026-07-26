/**
 * Phase 1 세션 저장소 — in-memory.
 * Phase 2에서 Firestore(sessions/{id})로 교체된다. 타입은 docs/03을 따른다.
 *
 * core.md §3-6: 세션을 여는 코드는 반드시 하드 캡·하트비트·타임아웃을 함께 구현한다.
 * 서버는 클라이언트가 보고한 경과 시간을 믿지 않는다 — 자체 시계로만 센다 (docs/07 §5.1).
 */
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_MISS_LIMIT } from '@sotong/shared/constants';
import type { SessionMode, SessionStatus } from '@sotong/shared/types';

export interface LiveSessionRecord {
  id: string;
  mode: SessionMode;
  status: SessionStatus;
  startedAtMs: number;
  lastHeartbeatAtMs: number;
  maxDurationSec: number;
  billedSeconds: number;
  segmentCount: number;
  endedReason?: 'user' | 'cap' | 'error' | 'orphaned';
}

// dev HMR에도 살아남도록 globalThis에 붙인다
const g = globalThis as typeof globalThis & {
  __sotongSessions?: Map<string, LiveSessionRecord>;
};
const sessions = (g.__sotongSessions ??= new Map<string, LiveSessionRecord>());

const ORPHAN_AFTER_MS = HEARTBEAT_INTERVAL_MS * HEARTBEAT_MISS_LIMIT;

export function maxDurationSecFromEnv(): number {
  return Number(process.env.SESSION_MAX_DURATION_SEC ?? 7200);
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

export function createSession(mode: SessionMode, maxDurationSec: number): LiveSessionRecord {
  const now = Date.now();
  sweepOrphans(now);
  const record: LiveSessionRecord = {
    id: crypto.randomUUID(),
    mode,
    status: 'live',
    startedAtMs: now,
    lastHeartbeatAtMs: now,
    maxDurationSec,
    billedSeconds: 0,
    segmentCount: 0,
  };
  sessions.set(record.id, record);
  return record;
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
): { billedSeconds: number; segmentCount: number } | null {
  const now = Date.now();
  const s = sessions.get(id);
  if (!s) return null;
  if (s.status === 'live') {
    s.status = 'ended';
    s.endedReason = reason;
    s.billedSeconds = Math.min(Math.round((now - s.startedAtMs) / 1000), s.maxDurationSec);
  }
  return { billedSeconds: s.billedSeconds, segmentCount: s.segmentCount };
}
