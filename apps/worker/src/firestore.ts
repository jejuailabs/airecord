/**
 * Firestore 기록 (docs/01 §3.3).
 * Phase 4에서 firebase-admin으로 교체한다. 지금은 구조(배치·재시도·비차단)만 유지하는 스텁.
 *
 * 규칙:
 * - 확정 세그먼트만 sessions/{id}/segments 에 배치 기록
 * - Firestore를 실시간 오디오 버퍼로 쓰지 않는다 — 자막 텍스트만
 * - 저장 실패가 통역을 멈추면 안 된다: 로컬 버퍼 재시도, 최종 실패 시 logIncomplete 플래그
 */
import type { EngineSegment } from '@sotong/shared/engine';

const RETRY_DELAYS_MS = [1_000, 5_000, 15_000];

export async function writeSegmentBatch(
  sessionId: string,
  segments: EngineSegment[],
  attempt = 0,
): Promise<void> {
  try {
    // TODO(Phase 4): admin.firestore().batch() 로 sessions/{sessionId}/segments 기록
    console.log(`[firestore-stub] ${sessionId}: would write ${segments.length} segments`);
  } catch (e) {
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) {
      setTimeout(() => void writeSegmentBatch(sessionId, segments, attempt + 1), delay);
    } else {
      // TODO(Phase 4): sessions/{sessionId}.logIncomplete = true
      console.error(`[firestore-stub] ${sessionId}: batch dropped after retries`, e);
    }
  }
}

export async function touchSession(sessionId: string, elapsedSec: number): Promise<void> {
  // TODO(Phase 4): sessions/{sessionId}.lastHeartbeatAt·billedSeconds 갱신
  console.log(`[firestore-stub] ${sessionId}: elapsed ${elapsedSec}s`);
}
