/**
 * gpt-realtime-translate 이벤트 스트림 → EngineSegment 조립.
 * 모드 B(브라우저 데이터 채널)와 모드 A(워커 WebSocket)가 같은 조립기를 쓴다
 * — 번역 코어는 하나 (core.md §3-3).
 *
 * ⚠ 실측(2026-07-26)으로 확인한 사실:
 *   서버 이벤트는 `session.input_transcript.delta` / `session.output_transcript.delta`
 *   / `session.output_audio.delta` 세 가지뿐이고, **종료(done/completed) 이벤트가 없다.**
 *   턴 개념이 없는 연속 스트림이므로, 자막 덩어리는 "발화 사이 공백"으로 우리가 끊는다.
 */
import type { EngineSegment } from './types';

interface RealtimeEvent {
  type: string;
  delta?: string;
  transcript?: string;
  language?: string;
  error?: { code?: string; message?: string };
  [key: string]: unknown;
}

export interface SegmentAssembler {
  handle(evt: RealtimeEvent): void;
  /** 타이머 정리 — 세션 종료 시 반드시 호출 */
  dispose(): void;
}

export interface AssemblerOptions {
  /** 이 시간 동안 델타가 없으면 현재 세그먼트를 확정한다 */
  pauseMs?: number;
  /** 번역문이 이 길이를 넘고 문장부호로 끝나면 확정한다 (한 덩어리가 너무 길어지지 않게) */
  softMaxChars?: number;
}

const SENTENCE_END = /[.!?。！？…]\s*$/;

export function createSegmentAssembler(
  onSegment: (s: EngineSegment) => void,
  onError?: (code: string, message: string) => void,
  options: AssemblerOptions = {},
): SegmentAssembler {
  const pauseMs = options.pauseMs ?? 1_200;
  const softMaxChars = options.softMaxChars ?? 24;

  const startedAt = Date.now();
  let nextSeq = 0;
  let current: EngineSegment | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** 번역이 아직 안 온 원문 — 다음 세그먼트로 넘긴다 (번역은 원문보다 늦게 온다) */
  let carriedSource = '';

  const emit = () => {
    if (current) onSegment({ ...current });
  };

  function finalize() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!current) return;
    // 아무 내용 없이 열린 세그먼트는 버린다
    if (!current.sourceText && !current.targetText) {
      current = null;
      return;
    }
    // 번역이 아직 도착하지 않았으면 확정하지 않고 원문을 다음으로 넘긴다.
    // 빈 번역칸이 화면에 남는 것을 막는다.
    if (!current.targetText.trim()) {
      carriedSource = `${carriedSource}${current.sourceText}`;
      current = null;
      return;
    }
    current.endMs = Date.now() - startedAt;
    current.isFinal = true;
    emit();
    current = null;
  }

  function armPauseTimer() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(finalize, pauseMs);
  }

  function ensureSegment(): EngineSegment {
    if (!current) {
      current = {
        seq: nextSeq++,
        startMs: Date.now() - startedAt,
        sourceText: carriedSource,
        targetText: '',
        isFinal: false,
      };
      carriedSource = '';
    }
    return current;
  }

  return {
    handle(evt) {
      switch (evt.type) {
        // ── 원문 (발화 언어 자동 감지) ──────────────
        case 'session.input_transcript.delta':
        case 'conversation.item.input_audio_transcription.delta': {
          const seg = ensureSegment();
          seg.sourceText += evt.delta ?? '';
          if (evt.language) seg.detectedLang = evt.language;
          emit();
          armPauseTimer();
          break;
        }

        // ── 번역문 ──────────────────────────────────
        case 'session.output_transcript.delta':
        case 'response.output_text.delta':
        case 'response.output_audio_transcript.delta': {
          const seg = ensureSegment();
          seg.targetText += evt.delta ?? '';
          emit();
          if (seg.targetText.length >= softMaxChars && SENTENCE_END.test(seg.targetText)) {
            finalize();
          } else {
            armPauseTimer();
          }
          break;
        }

        case 'error': {
          onError?.(evt.error?.code ?? 'engine_error', evt.error?.message ?? 'Unknown engine error');
          break;
        }

        default:
          break; // 오디오 델타 등 나머지는 여기서 다루지 않는다
      }
    },
    dispose() {
      finalize();
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
