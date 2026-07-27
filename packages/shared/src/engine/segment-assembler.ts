/**
 * gpt-realtime-translate 이벤트 스트림 → EngineSegment 조립.
 *
 * ⚠ 실측(2026-07)으로 확인한 사실:
 * 1. 서버 이벤트는 `session.input_transcript.delta` / `session.output_transcript.delta`
 *    / `session.output_audio.delta` 세 가지뿐이고, **종료(done/completed) 이벤트가 없다.**
 * 2. **원문 전사가 번역보다 1~2초 먼저 도착한다.**
 *
 * 그래서 이 조립기는 **원문을 기준으로 자막 덩어리를 만든다.**
 * 예전에는 번역을 기준으로 만들고 원문을 나중에 붙였는데, 그러면
 * 긴 번역이 여러 덩어리로 쪼개질 때 뒤쪽 덩어리의 원문이 구조적으로 비어 버렸다.
 * 먼저 오는 쪽(원문)으로 뼈대를 세우면 원문이 빌 수가 없다.
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
  /** 표시 언어 코드 — 원문이 같은 언어일 때 "번역 없음"으로 처리하는 데 쓴다 */
  targetLang?: string;
  /** 번역 델타가 이 시간 동안 없으면 현재 덩어리를 확정한다 */
  pauseMs?: number;
  /** 번역이 이 시간 동안 전혀 없으면 같은 언어로 보고 원문을 자막으로 내보낸다 */
  untranslatedIdleMs?: number;
  /** 원문 한 덩어리가 이 길이를 넘으면 문장 단위로 끊는다 */
  maxSourceChars?: number;
}

const SENTENCE_END = /[.!?。！？…]\s*$/;
const SENTENCE_SPLIT = /[^.!?。！？]+[.!?。！？]+\s*/g;
const HAS_WORD = /[\p{L}\p{N}]/u;

export function createSegmentAssembler(
  onSegment: (s: EngineSegment) => void,
  onError?: (code: string, message: string) => void,
  options: AssemblerOptions = {},
): SegmentAssembler {
  const pauseMs = options.pauseMs ?? 1_200;
  const untranslatedIdleMs = options.untranslatedIdleMs ?? 3_500;
  const maxSourceChars = options.maxSourceChars ?? 160;
  const targetLang = options.targetLang;

  const startedAt = Date.now();
  let nextSeq = 0;

  /** 원문으로 만들어졌고 아직 번역이 덜 붙은 덩어리들 (오래된 것부터) */
  const open: EngineSegment[] = [];
  /** 아직 문장이 끝나지 않은 원문 조각 */
  let sourcePartial = '';
  /**
   * 원문 덩어리가 만들어지기 전에 도착한 번역.
   * 빈 덩어리를 만들어 담으면 이후 모든 번역이 한 칸씩 밀린다.
   */
  let pendingTarget = '';
  let detectedLang: string | undefined;
  let lastOutputAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 원문 대비 번역 길이 비율 (누적 관측값).
   * 언어쌍마다 다르다 — 영어→한국어는 짧아지고, 한국어→영어는 길어진다.
   * 이 비율로 "이 덩어리가 가져갈 번역 분량"을 가늠해 한 덩어리가 전부 삼키는 것을 막는다.
   */
  let seenSource = 0;
  let seenTarget = 0;
  const targetPerSource = () => (seenSource < 60 ? 0.9 : seenTarget / seenSource);

  const emit = (s: EngineSegment) => onSegment({ ...s });

  function newSegment(sourceText: string): EngineSegment {
    const seg: EngineSegment = {
      seq: nextSeq++,
      startMs: Date.now() - startedAt,
      sourceText,
      // 먼저 도착해 대기하던 번역이 있으면 첫 덩어리가 이어받는다
      targetText: pendingTarget,
      isFinal: false,
      detectedLang,
    };
    pendingTarget = '';
    open.push(seg);
    emit(seg); // 원문을 먼저 화면에 띄운다 — 번역은 곧 따라 붙는다
    return seg;
  }

  /** 완성된 원문 문장이 나올 때마다 덩어리를 하나 만든다 */
  function drainSourceSentences() {
    const matches = sourcePartial.match(SENTENCE_SPLIT);
    if (matches) {
      sourcePartial = sourcePartial.slice(matches.join('').length);
      for (const raw of matches) {
        const s = raw.trim();
        if (s && HAS_WORD.test(s)) newSegment(s);
      }
    }
    // 구두점 없이 길게 이어지면 강제로 끊는다
    if (sourcePartial.length >= maxSourceChars) {
      const cut = sourcePartial.lastIndexOf(' ', maxSourceChars);
      const at = cut > maxSourceChars / 2 ? cut : maxSourceChars;
      const head = sourcePartial.slice(0, at).trim();
      sourcePartial = sourcePartial.slice(at);
      if (head && HAS_WORD.test(head)) newSegment(head);
    }
  }

  /** 가장 오래된, 아직 열려 있는 덩어리 */
  function currentOpen(): EngineSegment | undefined {
    return open[0];
  }

  function closeSegment(seg: EngineSegment, sameAsTarget = false) {
    const idx = open.indexOf(seg);
    if (idx >= 0) open.splice(idx, 1);
    seg.isFinal = true;
    seg.endMs = Date.now() - startedAt;
    if (sameAsTarget) {
      seg.sameAsTarget = true;
      // 표시 언어와 같은 말이라 번역이 없다 — 원문을 그대로 자막으로 쓴다
      if (!seg.targetText.trim()) seg.targetText = seg.sourceText;
    }
    seg.targetText = seg.targetText.replace(/^[\s.,!?。、！？]+/, '');
    emit(seg);
  }

  /**
   * 번역이 멈췄을 때 정리한다.
   * - 번역이 붙은 덩어리는 확정한다.
   * - 번역이 오래 안 온 덩어리는 같은 언어로 보고 원문을 자막으로 내보낸다.
   */
  function onPause() {
    const idle = lastOutputAt ? Date.now() - lastOutputAt : Infinity;
    for (const seg of [...open]) {
      if (seg.targetText.trim()) {
        closeSegment(seg);
        continue;
      }
      const sameScript =
        !targetLang || guessScript(seg.sourceText) === scriptOfLang(targetLang);
      if (idle >= untranslatedIdleMs && sameScript) closeSegment(seg, true);
    }
  }

  function armTimer() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onPause, pauseMs);
  }

  return {
    handle(evt) {
      switch (evt.type) {
        // ── 원문: 자막 덩어리의 뼈대 ─────────────────
        case 'session.input_transcript.delta':
        case 'conversation.item.input_audio_transcription.delta': {
          if (evt.language) detectedLang = evt.language;
          sourcePartial += evt.delta ?? '';
          seenSource += (evt.delta ?? '').length;
          drainSourceSentences();
          armTimer();
          break;
        }

        // ── 번역: 가장 오래된 덩어리부터 채운다 ──────
        case 'session.output_transcript.delta':
        case 'response.output_text.delta':
        case 'response.output_audio_transcript.delta': {
          lastOutputAt = Date.now();
          const delta = evt.delta ?? '';
          if (!delta) break;
          seenTarget += delta.length;

          // 아직 원문 덩어리가 없으면 빈 덩어리를 만들지 않고 잠시 들고 있는다
          const seg = currentOpen();
          if (!seg) {
            pendingTarget += delta;
            armTimer();
            break;
          }
          seg.targetText += delta;
          emit(seg);

          /**
           * 이 덩어리가 가져갈 번역 분량을 원문 길이에 비례해 정한다.
           * 문장부호만 기준으로 삼으면, 모델이 구두점을 늦게 붙일 때
           * 한 덩어리가 뒤 문장들의 번역까지 전부 삼켜 버린다(실측으로 확인).
           */
          const quota = Math.max(12, seg.sourceText.length * targetPerSource());
          const len = seg.targetText.length;
          if (
            (len >= quota * 0.8 && SENTENCE_END.test(seg.targetText)) ||
            len >= quota * 1.6
          ) {
            closeSegment(seg);
          }
          armTimer();
          break;
        }

        case 'error': {
          onError?.(evt.error?.code ?? 'engine_error', evt.error?.message ?? 'Unknown engine error');
          break;
        }

        default:
          break;
      }
    },

    dispose() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      // 남은 원문 조각도 덩어리로 만들어 유실을 막는다
      const tail = sourcePartial.trim();
      sourcePartial = '';
      if (tail && HAS_WORD.test(tail)) newSegment(tail);
      for (const seg of [...open]) {
        const sameScript =
          !targetLang || guessScript(seg.sourceText) === scriptOfLang(targetLang);
        closeSegment(seg, !seg.targetText.trim() && sameScript);
      }
    },
  };
}
