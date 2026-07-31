/**
 * 봇 오디오 ↔ 번역 모델 릴레이 (docs/04 §4).
 * 번역 코어는 하나 — 모드 B와 같은 getEngine()을 쓴다 (core.md §3-3).
 *
 * ⚠ Recall.ai는 **바이너리 프레임을 보내지 않는다.**
 *   `audio_mixed_raw.data` 이벤트를 JSON으로 보내고, 오디오는 그 안에 base64로 들어 있다
 *   (공식 스키마: 16kHz · 16bit · mono · PCM little-endian).
 *   예전 구현은 `isBinary`일 때만 처리해서 오디오를 전부 버렸다.
 *
 * ⚠ 그리고 레이트를 맞춰야 한다. 번역 엔드포인트는 24kHz를 기대하는데
 *   `session.audio.input.format`으로 알려줄 방법이 없다(실측: unknown_parameter).
 *   변환 없이 넣으면 어순이 뒤집히고 숫자가 바뀐다 — 실측에서 "3분기"가 "2분기"가 됐다.
 */
import type { WebSocket } from 'ws';
import { getEngine, meetingAudioToEngine } from '@sotong/shared/engine';
import { SEGMENT_BATCH_MAX_COUNT, SEGMENT_BATCH_MAX_MS } from '@sotong/shared/constants';
import type { EngineSegment } from '@sotong/shared/engine';
import type { LangCode, SourceLangSetting } from '@sotong/shared/types';
import { writeSegmentBatch, touchSession, finishSession, readSessionConfig } from '../firestore.js';

const HARD_CAP_CHECK_MS = 30_000; // 30초마다 상태·경과 갱신 + 하드 캡 검사 (docs/04 §4)

/** Recall.ai 실시간 이벤트 프레임 (공식 스키마의 우리가 쓰는 부분만) */
interface RecallFrame {
  event?: string;
  data?: {
    data?: { buffer?: string; timestamp?: { relative?: number } };
    participant?: { id?: number | string; name?: string | null };
  };
}

export async function runRelay(sessionId: string, botWs: WebSocket): Promise<void> {
  console.log(`[relay] session ${sessionId} connected`);

  /**
   * 언어는 세션 문서에서 읽는다 — 하드코딩하면 유저가 고른 값이 무시된다.
   * 못 읽으면 시작하지 않고 끊는다: 엉뚱한 언어로 회의를 통째로 날리는 게 더 나쁘다.
   */
  const cfg = await readSessionConfig(sessionId);
  if (!cfg) {
    console.error(`[relay] session ${sessionId}: config not found — refusing to start`);
    botWs.close(1011, 'session config not found');
    return;
  }

  const engine = getEngine();
  const session = await engine.openServerSession({
    sourceLang: cfg.sourceLang as SourceLangSetting,
    targetLang: cfg.targetLang as LangCode,
    audioOut: false, // 모드 A는 자막 링크가 출력 채널 — 스트림 수를 명시적으로 센다 (docs/07 §1.1)
    sessionId,
  });

  // 확정 세그먼트만 배치 저장: 10건 또는 5초 (docs/08 §1)
  let batch: EngineSegment[] = [];
  let batchTimer: NodeJS.Timeout | null = null;
  let segmentCount = 0;
  const flush = () => {
    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = null;
    }
    if (batch.length === 0) return;
    const toWrite = batch;
    batch = [];
    // 저장 실패가 통역을 멈추면 안 된다 (docs/01 §6) — writeSegmentBatch가 내부 재시도
    void writeSegmentBatch(sessionId, toWrite);
  };

  session.onSegment((seg) => {
    if (!seg.isFinal) return; // 부분 전사는 저장하지 않는다 (docs/03 §3)
    segmentCount++;
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

  /** 경과는 세션 시작 시각 기준 — 봇이 늦게 붙어도 과금이 어긋나지 않는다 */
  const elapsed = () => Math.round((Date.now() - cfg.startedAtMs) / 1000);
  let cappedOut = false;
  const capTimer = setInterval(() => {
    void touchSession(sessionId, elapsed(), segmentCount);
    if (elapsed() >= cfg.maxDurationSec) {
      console.log(`[relay] session ${sessionId} hit hard cap — closing`);
      cappedOut = true;
      botWs.close();
    }
  }, HARD_CAP_CHECK_MS);

  /** 오디오가 한 번도 안 들어오면 배관이 끊긴 것이다 — 조용히 실패하지 않게 남긴다 */
  let audioFrames = 0;
  let loggedFirstAudio = false;

  botWs.on('message', (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      // 규격상 오지 않지만, 온다면 이미 PCM이므로 레이트만 맞춰 넘긴다
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      session.pushAudio(copy.buffer);
      audioFrames++;
      return;
    }

    let frame: RecallFrame;
    try {
      frame = JSON.parse(data.toString('utf8')) as RecallFrame;
    } catch {
      return; // 비JSON 프레임 무시
    }

    if (frame.event === 'audio_mixed_raw.data') {
      const b64 = frame.data?.data?.buffer;
      if (!b64) return;
      session.pushAudio(meetingAudioToEngine(b64));
      audioFrames++;
      if (!loggedFirstAudio) {
        loggedFirstAudio = true;
        console.log(`[relay] ${sessionId}: first audio frame received`);
      }
      return;
    }

    // 화자 이벤트 등 — 지금은 기록만 한다. 자막에 화자를 붙이는 건 별개 작업이다.
    if (frame.event) console.log(`[relay] ${sessionId}: event ${frame.event}`);
  });

  botWs.on('close', async () => {
    clearInterval(capTimer);
    flush();
    await session.close();
    if (audioFrames === 0) {
      console.error(`[relay] ${sessionId}: closed without receiving any audio frame`);
    }
    await finishSession(sessionId, elapsed(), cappedOut ? 'cap' : 'user', segmentCount);
    console.log(`[relay] session ${sessionId} closed (frames=${audioFrames}, segments=${segmentCount})`);
  });
}
