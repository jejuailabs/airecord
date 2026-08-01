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
import { SEGMENT_BATCH_MAX_COUNT } from '@sotong/shared/constants';
import { alignTranscripts } from '@sotong/shared/translate/align';
import type { EngineSegment } from '@sotong/shared/engine';
import type { LangCode, SourceLangSetting } from '@sotong/shared/types';
import {
  writeSegmentBatch,
  touchSession,
  finishSession,
  readSessionConfig,
  writeLivePartial,
  writeAlignedPairs,
} from '../firestore.js';

const HARD_CAP_CHECK_MS = 30_000; // 30초마다 상태·경과 갱신 + 하드 캡 검사 (docs/04 §4)

/**
 * 회의 자막 저장 주기.
 * 공용 SEGMENT_BATCH_MAX_MS(5초)는 대량 기록엔 알맞지만 회의 자막엔 너무 늦다 —
 * 확정 문장이 최대 5초 묶여 있다가 나가면 뷰어가 그만큼 뒤처진다(실측 체감 지연의 주범).
 * 회의는 초당 몇 줄이라 자주 써도 부담이 없다. 1초 안으로 흘려보낸다.
 */
const MEETING_FLUSH_MS = 900;

/**
 * 원문↔번역 정렬 주기 — 기록을 대면처럼 "짝지어진 줄"로 만든다.
 * 회의 중 20초마다 밀린 줄을 짝짓고, 종료 때 남은 꼬리를 한 번 더 맞춘다.
 * (종료 후에만 몰아서 하면 Cloud Run이 요청 밖 CPU를 죄어 다 못 끝낼 수 있다)
 */
const ALIGN_INTERVAL_MS = 20_000;
/** 이 나이(ms)보다 어린 줄은 정렬하지 않는다 — raw 문서 쓰기(0.9초 배치+재시도)가 끝난 뒤라야
 *  paired 덮어쓰기·삭제가 어긋나지 않는다. */
const ALIGN_MIN_AGE_MS = 10_000;
/** 한 번에 정렬기에 보내는 최대 줄 수 (대면과 동일) */
const ALIGN_WINDOW = 40;

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

  /**
   * 라이브 부분자막 — 대면처럼 "쌓이는 번역 줄"을 흘린다.
   * 델타마다 쓰면 쓰기가 폭발하니 ~400ms로 스로틀한다(최신값만 반영).
   */
  const PARTIAL_THROTTLE_MS = 400;
  let pendingPartial: { text: string; seq: number } | null = null;
  let partialTimer: NodeJS.Timeout | null = null;
  const scheduleFlushPartial = () => {
    if (partialTimer || !pendingPartial) return;
    partialTimer = setTimeout(() => {
      partialTimer = null;
      if (pendingPartial) {
        void writeLivePartial(sessionId, pendingPartial.text, pendingPartial.seq);
        pendingPartial = null;
      }
    }, PARTIAL_THROTTLE_MS);
  };

  /**
   * 원문↔번역 정렬(대면과 동일한 2층) — 확정 줄을 모아뒀다가 주기적으로 짝짓고,
   * Firestore 기록을 paired 문서로 고쳐 쓴다. 짝지어진 줄은 목록에서 빠진다.
   */
  const unaligned = new Map<number, { seg: EngineSegment; addedAtMs: number }>();
  let alignBusy = false;
  const alignPass = async (minAgeMs = ALIGN_MIN_AGE_MS) => {
    if (alignBusy) return;
    const cutoff = Date.now() - minAgeMs;
    const rows = [...unaligned.values()]
      .filter((r) => r.addedAtMs <= cutoff)
      .map((r) => r.seg)
      .sort((a, b) => a.seq - b.seq);
    const src = rows.filter((s) => s.kind === 'source' && s.sourceText.trim());
    const tgt = rows.filter((s) => s.kind !== 'source' && s.targetText.trim());
    if (src.length === 0 || tgt.length === 0) return;
    alignBusy = true;
    try {
      const res = await alignTranscripts(
        src.slice(0, ALIGN_WINDOW).map((s) => ({ seq: s.seq, text: s.sourceText.slice(0, 600) })),
        tgt.slice(0, ALIGN_WINDOW).map((s) => ({ seq: s.seq, text: s.targetText.slice(0, 600) })),
      );
      if (!res || res.pairs.length === 0) return;
      const bySeq = new Map(rows.map((s) => [s.seq, s]));
      const consumed = await writeAlignedPairs(sessionId, res.pairs, bySeq);
      for (const n of consumed) unaligned.delete(n);
      if (consumed.length > 0) {
        console.log(`[relay] ${sessionId}: aligned ${res.pairs.length} pairs (${consumed.length} rows)`);
      }
    } catch (e) {
      console.error(`[relay] ${sessionId}: align pass failed`, e);
    } finally {
      alignBusy = false;
    }
  };
  const alignTimer = setInterval(() => void alignPass(), ALIGN_INTERVAL_MS);

  session.onSegment((seg) => {
    if (!seg.isFinal) {
      // 부분 번역(target)만 라이브 라인으로 흘린다. 원문 스트림·빈 줄은 무시.
      if (seg.kind !== 'source' && seg.targetText.trim()) {
        pendingPartial = { text: seg.targetText, seq: seg.seq };
        scheduleFlushPartial();
      }
      return; // 부분은 segments에 저장하지 않는다 (docs/03 §3) — 라이브 라인으로만 보여준다
    }
    segmentCount++;
    batch.push(seg);
    // 정렬 후보로 적립 (paired로 소비되면 빠진다)
    if ((seg.kind === 'source' ? seg.sourceText : seg.targetText).trim()) {
      unaligned.set(seg.seq, { seg, addedAtMs: Date.now() });
    }
    /**
     * 이 번역 줄이 확정됐으면 라이브 라인을 비운다 — 확정 줄로 편입되므로 중복 표시 방지.
     * (원문 확정은 라이브 라인과 무관하니 target일 때만)
     */
    if (seg.kind !== 'source') {
      pendingPartial = null;
      if (partialTimer) {
        clearTimeout(partialTimer);
        partialTimer = null;
      }
      void writeLivePartial(sessionId, '', seg.seq);
    }
    if (batch.length >= SEGMENT_BATCH_MAX_COUNT) {
      flush();
    } else if (!batchTimer) {
      batchTimer = setTimeout(() => {
        batchTimer = null;
        flush();
      }, MEETING_FLUSH_MS);
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
    clearInterval(alignTimer);
    if (partialTimer) clearTimeout(partialTimer);
    void writeLivePartial(sessionId, '', -1); // 라이브 라인 비우기 — 끝난 회의에 부분자막이 남지 않게
    flush();
    await session.close();
    /**
     * 마지막 정렬 — 끝자락 줄들을 한 번 더 짝짓는다 (대면의 finalAlign과 같은 역할).
     * raw 문서 쓰기(0.9초 배치)가 끝나길 잠깐 기다린 뒤 나이 제한 없이 돈다.
     * Cloud Run이 연결 종료 후 CPU를 죄면 못 끝낼 수 있다 — 실패해도 기록은 raw로 남는다(최선노력).
     */
    await new Promise((r) => setTimeout(r, 2_500));
    await alignPass(0).catch(() => undefined);
    if (audioFrames === 0) {
      console.error(`[relay] ${sessionId}: closed without receiving any audio frame`);
    }
    await finishSession(sessionId, elapsed(), cappedOut ? 'cap' : 'user', segmentCount);
    console.log(`[relay] session ${sessionId} closed (frames=${audioFrames}, segments=${segmentCount})`);
  });
}
