/**
 * gpt-realtime-translate 이벤트 스트림 → EngineSegment 조립.
 * 모드 B(브라우저 데이터 채널)와 모드 A(워커 WebSocket)가 같은 조립기를 쓴다
 * — 번역 코어는 하나 (core.md §3-3).
 *
 * ⚠ 실측(2026-07)으로 확인한 사실:
 * 1. 서버 이벤트는 `session.input_transcript.delta` / `session.output_transcript.delta`
 *    / `session.output_audio.delta` 세 가지뿐이고, **종료(done/completed) 이벤트가 없다.**
 *    턴 개념이 없는 연속 스트림이므로 자막 덩어리는 우리가 끊는다.
 * 2. **원문 전사가 번역보다 2~3문장 앞서 나간다.** 그래서 "현재 열린 세그먼트에 도착한 원문을
 *    그대로 담는" 방식은 원문·번역이 서로 다른 문장을 가리키게 만든다(빠른 발화에서 특히 심함).
 *    → 원문은 문장 단위로 큐에 쌓아 두고, 번역이 확정될 때 문장 수만큼 꺼내 짝지운다.
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
  /** 번역문이 이 길이를 넘고 문장부호로 끝나면 확정한다 */
  softMaxChars?: number;
  /** 문장부호가 없어도 이 길이를 넘으면 끊는다 (모델이 구두점을 안 붙이는 경우가 있다) */
  hardMaxChars?: number;
}

const SENTENCE_END = /[.!?。！？…]\s*$/;
/** 문장 분리 — 종료 부호 뒤에서 자른다 */
const SENTENCE_SPLIT = /[^.!?。！？…]+[.!?。！？…]+\s*/g;

export function createSegmentAssembler(
  onSegment: (s: EngineSegment) => void,
  onError?: (code: string, message: string) => void,
  options: AssemblerOptions = {},
): SegmentAssembler {
  const pauseMs = options.pauseMs ?? 900;
  const softMaxChars = options.softMaxChars ?? 24;
  const hardMaxChars = options.hardMaxChars ?? 52;

  const startedAt = Date.now();
  let nextSeq = 0;
  let current: EngineSegment | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /** 아직 열린 자막이 없을 때 완성된 원문 문장을 잠시 들고 있는다 */
  let pendingSentences: string[] = [];
  /** 아직 문장이 끝나지 않은 원문 조각 */
  let sourcePartial = '';
  let detectedLang: string | undefined;

  const emit = () => {
    if (current) onSegment({ ...current });
  };

  /**
   * 완성된 원문 문장을 "그 시점에 열려 있는 자막"에 바로 붙인다.
   * 전역 대기열에서 분량을 계산해 꺼내는 방식은 오차가 누적돼 원문이 한 칸씩 밀린다.
   * 문장 단위로 붙이므로 단어 중간에서 잘리지도 않는다.
   */
  function drainSentences() {
    const matches = sourcePartial.match(SENTENCE_SPLIT);
    if (!matches) return;
    sourcePartial = sourcePartial.slice(matches.join('').length);
    for (const raw of matches) {
      const s = raw.trim();
      if (!s) continue;
      if (current && !current.isFinal) {
        current.sourceText = current.sourceText ? `${current.sourceText} ${s}` : s;
      } else {
        pendingSentences.push(s);
      }
    }
  }

  function finalize() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!current) return;

    // 번역이 아직 없거나 구두점만 남았으면 확정하지 않는다.
    // (마침표 하나짜리 자막이 한 줄을 차지하는 것을 막는다. 원문은 큐에 그대로 남는다.)
    if (!/[\p{L}\p{N}]/u.test(current.targetText)) {
      current = null;
      return;
    }

    // 원문이 하나도 안 붙었으면 진행 중인 조각이라도 넣어 빈 칸을 만들지 않는다
    if (!current.sourceText.trim() && sourcePartial.trim()) {
      current.sourceText = sourcePartial.trim();
      sourcePartial = '';
    }
    // 앞 덩어리에서 밀려온 구두점이 문장 앞에 붙는 것을 정리한다
    current.targetText = current.targetText.replace(/^[\s.,!?。、！？]+/, '');
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
        // 자막이 닫혀 있는 사이에 끝난 원문 문장을 새 자막이 이어받는다
        sourceText: pendingSentences.join(' '),
        targetText: '',
        isFinal: false,
        detectedLang,
      };
      pendingSentences = [];
    }
    return current;
  }

  return {
    handle(evt) {
      switch (evt.type) {
        // ── 원문 (발화 언어 자동 감지) ──────────────
        case 'session.input_transcript.delta':
        case 'conversation.item.input_audio_transcription.delta': {
          sourcePartial += evt.delta ?? '';
          drainSentences();
          if (evt.language) detectedLang = evt.language;
          // drainSentences()가 완성 문장을 현재 자막에 이미 붙였다 — 갱신만 알린다
          if (current && !current.isFinal) {
            current.detectedLang = detectedLang;
            emit();
          }
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
          const long = seg.targetText.length;
          const endsSentence = SENTENCE_END.test(seg.targetText);
          // 구두점이 있으면 문장 끝에서, 없으면 하드 상한에서 끊는다
          if ((long >= softMaxChars && endsSentence) || long >= hardMaxChars) {
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
