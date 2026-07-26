/**
 * 봇 오디오 ↔ 번역 모델 릴레이 (docs/04 §4).
 * 번역 코어는 하나 — 모드 B와 같은 getEngine()을 쓴다 (core.md §3-3).
 */
import type { WebSocket } from 'ws';
import { getEngine } from '@sotong/shared/engine';
import { SEGMENT_BATCH_MAX_COUNT, SEGMENT_BATCH_MAX_MS } from '@sotong/shared/constants';
import type { EngineSegment } from '@sotong/shared/engine';
import { writeSegmentBatch, touchSession } from '../firestore.js';

const HARD_CAP_CHECK_MS = 30_000; // 30초마다 세션 상태·경과 갱신 + 하드 캡 검사 (docs/04 §4)

export async function runRelay(sessionId: string, botWs: WebSocket): Promise<void> {
  console.log(`[relay] session ${sessionId} connected`);

  // TODO(Phase 4): 세션 문서에서 sourceLang/targetLang을 읽는다. 지금은 자동 감지 → 영어.
  const engine = getEngine();
  const session = await engine.openServerSession({
    sourceLang: 'auto',
    targetLang: 'en',
    audioOut: false, // 모드 A는 자막 링크가 출력 채널 — 스트림 수를 명시적으로 센다 (docs/07 §1.1)
    sessionId,
  });

  // 확정 세그먼트만 배치 저장: 10건 또는 5초 (docs/08 §1)
  let batch: EngineSegment[] = [];
  let batchTimer: NodeJS.Timeout | null = null;
  const flush = () => {
    if (batch.length === 0) return;
    const toWrite = batch;
    batch = [];
    // 저장 실패가 통역을 멈추면 안 된다 (docs/01 §6) — writeSegmentBatch가 내부 재시도
    void writeSegmentBatch(sessionId, toWrite);
  };

  session.onSegment((seg) => {
    if (!seg.isFinal) return; // 부분 전사는 저장하지 않는다 (docs/03 §3)
    batch.push(seg);
    if (batch.length >= SEGMENT_BATCH_MAX_COUNT) {
      flush();
    } else if (!batchTimer) {
      batchTimer = setTimeout(() => {
        batchTimer = null;
        flush();
      }, SEGMENT_BATCH_MAX_MS);
    }
  });
  session.onError((e) => {
    console.error(`[relay] engine error (${sessionId}):`, e.code, e.message);
    if (e.fatal) botWs.close();
  });

  const startedAt = Date.now();
  const maxSec = Number(process.env.SESSION_MAX_DURATION_SEC ?? 7200);
  const capTimer = setInterval(() => {
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    void touchSession(sessionId, elapsedSec);
    if (elapsedSec >= maxSec) {
      console.log(`[relay] session ${sessionId} hit hard cap — closing`);
      botWs.close();
    }
  }, HARD_CAP_CHECK_MS);

  botWs.on('message', (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      // Recall.ai 실시간 오디오 프레임 (PCM16) → 모델. 복사해 ArrayBuffer로 고정한다.
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      session.pushAudio(copy.buffer);
    }
    // TODO(Phase 4): JSON 프레임(화자 이벤트 등) 처리 — speaker를 세그먼트에 붙인다
  });

  botWs.on('close', async () => {
    clearInterval(capTimer);
    if (batchTimer) clearTimeout(batchTimer);
    flush();
    await session.close();
    console.log(`[relay] session ${sessionId} closed`);
  });
}
