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
import { scriptOfLang } from './types';
import { guessScript } from '../constants';

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
  /**
   * 표시 언어 코드. 원문이 이 언어와 같은 문자일 때만 "번역 없음" 처리를 한다.
   * 없으면 번역이 늦게 오는 것과 번역이 아예 없는 것을 구분하지 못한다.
   */
  targetLang?: string;
  /** 문장이 끝난 상태에서 이 시간 동안 델타가 없으면 확정한다 */
  pauseMs?: number;
  /**
   * 문장 도중일 때 기다리는 시간.
   * 번역 델타 간격은 실측 p99 1.4초·최대 1.7초까지 벌어진다(2026-07 측정).
   * 짧게 잡으면 "아직 올 내용이 남았는데" 자막이 끊긴다.
   */
  midSentencePauseMs?: number;
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
  const pauseMs = options.pauseMs ?? 800;
  const midSentencePauseMs = options.midSentencePauseMs ?? 2_400;
  const targetLang = options.targetLang;
  /** 번역 델타가 이만큼 없어야 "번역이 아예 없는 발화"로 본다 */
  const untranslatedIdleMs = 3_000;
  /** 마지막 번역 델타 시각 */
  let lastOutputAt = 0;
  const softMaxChars = options.softMaxChars ?? 24;
  const hardMaxChars = options.hardMaxChars ?? 52;
  /** 어떤 경우에도 이 길이를 넘기지 않는다 (단어 경계를 못 만나도 강제로 끊는다) */
  const ceilingChars = hardMaxChars + 28;
  /** 마지막으로 확정된 자막 — 남은 원문을 여기에 채워 넣는다 */
  let lastFinal: EngineSegment | null = null;

  const startedAt = Date.now();
  let nextSeq = 0;
  let current: EngineSegment | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /** 아직 열린 자막이 없을 때 완성된 원문 문장을 잠시 들고 있는다 */
  let pendingSentences: string[] = [];
  /**
   * 원문 없이 확정돼 버린 자막들 — 원문이 늦게 도착하면 여기에 채워 넣고 다시 내보낸다.
   * 원문 전사는 번역보다 1~2초 늦으므로, 짧은 발화는 번역이 먼저 확정된다.
   */
  const awaitingSource: EngineSegment[] = [];
  const AWAITING_LIMIT = 6;
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

      // 1) 원문을 기다리는 확정 자막이 있으면 그쪽부터 채운다 (오래된 것 먼저)
      const waiting = awaitingSource.shift();
      if (waiting) {
        waiting.sourceText = s;
        onSegment({ ...waiting });
        continue;
      }
      // 2) 열려 있는 자막에 붙인다
      if (current && !current.isFinal) {
        current.sourceText = current.sourceText ? `${current.sourceText} ${s}` : s;
        continue;
      }
      // 3) 다음 자막이 이어받도록 들고 있는다
      pendingSentences.push(s);
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

    // 앞 덩어리에서 밀려온 구두점이 문장 앞에 붙는 것을 정리한다
    current.targetText = current.targetText.replace(/^[\s.,!?。、！？]+/, '');
    current.endMs = Date.now() - startedAt;
    current.isFinal = true;

    // 원문이 아직 안 왔으면 조각을 억지로 넣지 않는다.
    // ("meant was he's" 같은 문장 중간 조각이 원문 자리에 남는 것을 막는다.)
    // 대신 대기열에 넣어 두고, 원문 문장이 도착하면 채워서 다시 내보낸다.
    if (!current.sourceText.trim()) {
      awaitingSource.push(current);
      while (awaitingSource.length > AWAITING_LIMIT) awaitingSource.shift();
    }

    lastFinal = current;
    emit();
    current = null;
  }

  /**
   * 표시 언어와 같은 언어로 말하면 모델이 번역을 만들지 않는다(문서화된 동작).
   * 그 발화가 화면에서 사라지지 않도록 원문을 그대로 자막으로 내보낸다.
   *
   * ⚠ 단, "번역이 늦는 것"과 "번역이 없는 것"을 반드시 구분해야 한다.
   * 구분하지 않으면 번역이 도착하기 전에 원문을 먼저 소비해 버려서
   * 뒤이어 오는 번역 자막의 원문 칸이 통째로 비어 버린다(실측으로 확인한 사고).
   * 그래서 (1) 원문 문자가 표시 언어와 같고 (2) 번역 델타가 오래 없을 때만 내보낸다.
   */
  function flushUntranslated() {
    if (current) return;
    const text = [...pendingSentences, sourcePartial.trim()].filter(Boolean).join(' ').trim();
    if (!text || !/[\p{L}\p{N}]/u.test(text)) return;

    // 번역이 최근에 왔다면 아직 따라오는 중이다 — 기다린다
    if (lastOutputAt && Date.now() - lastOutputAt < untranslatedIdleMs) return;
    // 문자 종류가 표시 언어와 다르면 번역이 나올 발화다 — 기다린다
    if (targetLang && guessScript(text) !== scriptOfLang(targetLang)) return;
    pendingSentences = [];
    sourcePartial = '';
    const seg: EngineSegment = {
      seq: nextSeq++,
      startMs: Date.now() - startedAt,
      sourceText: '',
      targetText: text,
      isFinal: true,
      endMs: Date.now() - startedAt,
      detectedLang,
      sameAsTarget: true,
    };
    lastFinal = seg;
    onSegment({ ...seg });
  }

  function onPause() {
    if (current) finalize();
    else flushUntranslated();
  }

  function armPauseTimer() {
    if (timer) clearTimeout(timer);
    // 문장이 아직 안 끝났으면 더 기다린다 — 뒤에 올 내용을 잘라먹지 않기 위해서다.
    // 문장이 끝난 뒤에는 짧게 끊어 자막이 늦게 확정되지 않게 한다.
    const midSentence =
      !!current && current.targetText.length > 0 && !SENTENCE_END.test(current.targetText);
    timer = setTimeout(onPause, midSentence ? midSentencePauseMs : pauseMs);
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
          lastOutputAt = Date.now();
          const seg = ensureSegment();
          seg.targetText += evt.delta ?? '';
          emit();
          const long = seg.targetText.length;
          const endsSentence = SENTENCE_END.test(seg.targetText);
          // 단어 중간에서 끊으면 "르게" 같은 토막 자막이 생긴다 — 경계에서만 끊는다
          const atBoundary = /[\s.,!?。、！？]$/.test(seg.targetText);
          if (
            (long >= softMaxChars && endsSentence) ||
            (long >= hardMaxChars && atBoundary) ||
            long >= ceilingChars
          ) {
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

      // 세션이 끝날 때 아직 자막에 붙지 못한 원문을 정리한다.
      // 그냥 버리면 짧은 대화에서 뒷부분 원문이 통째로 사라진다.
      const leftovers = [...pendingSentences, sourcePartial.trim()].filter(Boolean);
      pendingSentences = [];
      sourcePartial = '';
      for (const text of leftovers) {
        const waiting = awaitingSource.shift();
        if (waiting) {
          waiting.sourceText = text;
          onSegment({ ...waiting });
        } else if (lastFinal) {
          lastFinal.sourceText = lastFinal.sourceText
            ? `${lastFinal.sourceText} ${text}`
            : text;
          onSegment({ ...lastFinal });
        }
      }
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
