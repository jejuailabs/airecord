/**
 * gpt-realtime-translate 이벤트 스트림 → EngineSegment 조립.
 *
 * ── 이 조립기는 두 스트림을 **묶지 않는다.** ────────────────────────────
 *
 * 번역 자막(target)과 원문 자막(source)은 출처도 신뢰도도 다르다:
 *   - 번역: 통역 모델이 음성과 **같은 생성에서** 함께 보낸다. 안정적이고 음성과 100% 일치.
 *   - 원문: 전사 레그가 따로 듣고 받아적는다. 자주 굶는다
 *           (실측 2026-07-28 모바일: 138초에 180자, 최대공백 57초).
 *
 * 이 둘을 실시간으로 한 줄에 묶으려는 시도를 다섯 번 했고 다섯 번 어긋났다.
 * 원인은 구조적이다 — 문장 경계도 지연도 다른데, 번역 쪽에는 시각 정보조차 없다.
 * 그래서 실시간에는 **각자 흐르게 두고**, 짝짓기는 나중에 양쪽 전문을 놓고 하는
 * 별도 정렬 단계로 넘긴다(2층). 그쪽은 어림짐작이 필요 없다.
 *
 * ⚠ 번역 문자열은 자르기만 하고 **내용을 절대 바꾸지 않는다.**
 *    다른 모델로 채우거나 다시 쓰면 귀에 들리는 말과 다른 글이 된다.
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
  /** 통역 중 표시 언어가 바뀌면 알려준다 */
  setTargetLang(lang: string): void;
  /** 타이머 정리 — 세션 종료 시 반드시 호출 */
  dispose(): void;
}

export interface AssemblerOptions {
  targetLang?: string;
  /** 번역 델타가 이 시간 동안 없으면 열린 줄을 확정한다 */
  pauseMs?: number;
  /** 자막 한 줄 목표 길이 (유저 요청: 30~50자 수준) */
  minRowChars?: number;
  maxRowChars?: number;
}

const SENTENCE_MARK = '.!?。！？…';
const CLAUSE_MARK = ',、，;；';
const HAS_WORD = /[\p{L}\p{N}]/u;

/** from 이후 첫 문장 끝 위치. 없으면 -1 */
function sentenceEndAtOrAfter(s: string, from: number): number {
  for (let i = Math.max(0, from); i < s.length; i++) {
    if (SENTENCE_MARK.includes(s.charAt(i))) return i;
  }
  return -1;
}

/** until 이전의 마지막 절·어절 경계. 문장부호가 끝내 안 올 때의 차선책 */
function softBreakBefore(s: string, until: number): number {
  const end = Math.min(s.length, until) - 1;
  for (let i = end; i > 0; i--) if (CLAUSE_MARK.includes(s.charAt(i))) return i;
  for (let i = end; i > 0; i--) if (s.charAt(i) === ' ') return i;
  return -1;
}

export function createSegmentAssembler(
  onSegment: (s: EngineSegment) => void,
  onError?: (code: string, message: string) => void,
  options: AssemblerOptions = {},
): SegmentAssembler {
  /** 실측(60초 연속 발화): 번역 델타 사이 최대 공백 1.6초 */
  const pauseMs = options.pauseMs ?? 1_800;
  const minRowChars = options.minRowChars ?? 28;
  const maxRowChars = options.maxRowChars ?? 55;
  let targetLang = options.targetLang;
  void targetLang; // 현재 조립에는 쓰지 않는다 — 정렬 단계가 언어를 다룬다

  const startedAt = Date.now();
  let nextSeq = 0;

  /** 번역을 받고 있는 줄 */
  let openRow: EngineSegment | null = null;
  /** 부가 전사(텍스트만 오는 폴백) 누적 버퍼 */
  let sourcePartial = '';
  /** VAD 모드 — 전용 전사 레그가 붙으면 켜진다 (그때는 확정본만 쓴다) */
  let vadMode = false;
  const vadWindows = new Map<string, { startMs: number; endMs?: number }>();

  let detectedLang: string | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const emit = (s: EngineSegment) => onSegment({ ...s });

  function newRow(kind: 'target' | 'source'): EngineSegment {
    return {
      seq: nextSeq++,
      startMs: Date.now() - startedAt,
      sourceText: '',
      targetText: '',
      isFinal: false,
      detectedLang,
      kind,
    };
  }

  // ── 번역 스트림: 자르기만 한다 ─────────────────────────────────────────
  function feedTarget(text: string) {
    let rest = text;
    while (rest) {
      if (!openRow) openRow = newRow('target');
      openRow.targetText += rest;
      rest = '';
      emit(openRow);

      const t = openRow.targetText;
      if (t.length < minRowChars) return;

      let cut = sentenceEndAtOrAfter(t, minRowChars - 1);
      if (cut < 0 && t.length >= maxRowChars) cut = softBreakBefore(t, maxRowChars);
      if (cut < 0) return;

      rest = t.slice(cut + 1);
      openRow.targetText = t.slice(0, cut + 1);
      closeRow(openRow);
      openRow = null;
    }
  }

  function closeRow(row: EngineSegment) {
    row.isFinal = true;
    row.endMs = Date.now() - startedAt;
    row.targetText = row.targetText.replace(/^[\s.,!?。、！？]+/, '').trim();
    if (!row.targetText) return; // 빈 줄은 올리지 않는다
    emit(row);
  }

  // ── 원문 스트림: 도착하는 대로 자기 줄로 내보낸다 ──────────────────────
  function emitSource(text: string, audio?: { startMs: number; endMs?: number }) {
    const t = text.trim();
    if (!t || !HAS_WORD.test(t)) return;
    const row = newRow('source');
    row.sourceText = t;
    row.isFinal = true;
    row.endMs = Date.now() - startedAt;
    if (audio) {
      row.audioStartMs = audio.startMs;
      row.audioEndMs = audio.endMs;
    }
    emit(row);
  }

  /** 부가 전사(텍스트만) 경로 — 문장 단위로 잘라 내보낸다 */
  function drainSourceText() {
    for (;;) {
      const idx = sentenceEndAtOrAfter(sourcePartial, 0);
      if (idx < 0) break;
      emitSource(sourcePartial.slice(0, idx + 1));
      sourcePartial = sourcePartial.slice(idx + 1);
    }
    if (sourcePartial.length >= 160) {
      const at = sourcePartial.lastIndexOf(' ', 160);
      const cut = at > 80 ? at : 160;
      emitSource(sourcePartial.slice(0, cut));
      sourcePartial = sourcePartial.slice(cut);
    }
  }

  function onPause() {
    if (openRow && openRow.targetText.trim()) {
      closeRow(openRow);
      openRow = null;
    }
  }

  function armTimer() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onPause, pauseMs);
  }

  return {
    setTargetLang(lang) {
      targetLang = lang;
    },

    handle(evt) {
      const itemId = typeof evt.item_id === 'string' ? evt.item_id : undefined;

      switch (evt.type) {
        // ── VAD 경계: 발화의 오디오 구간을 기록한다 (정렬 단계의 힌트) ──
        case 'input_audio_buffer.speech_started': {
          vadMode = true;
          if (itemId && typeof evt.audio_start_ms === 'number') {
            vadWindows.set(itemId, { startMs: evt.audio_start_ms });
          }
          break;
        }
        case 'input_audio_buffer.speech_stopped': {
          const w = itemId ? vadWindows.get(itemId) : undefined;
          if (w && typeof evt.audio_end_ms === 'number') w.endMs = evt.audio_end_ms;
          break;
        }

        // ── 전용 전사 레그의 확정 원문 ──
        case 'conversation.item.input_audio_transcription.completed': {
          const transcript = typeof evt.transcript === 'string' ? evt.transcript : '';
          if (!transcript.trim()) break;
          const w = itemId ? vadWindows.get(itemId) : undefined;
          if (itemId) vadWindows.delete(itemId);
          emitSource(transcript, w);
          break;
        }

        // ── 부가 전사(폴백): 텍스트만 온다 ──
        case 'session.input_transcript.delta':
        case 'conversation.item.input_audio_transcription.delta': {
          if (evt.language) detectedLang = evt.language;
          // VAD 모드에서는 확정본만 쓴다 — 델타까지 받으면 같은 말이 두 번 들어간다
          if (vadMode) break;
          sourcePartial += evt.delta ?? '';
          drainSourceText();
          break;
        }

        // ── 번역 스트림 ──
        case 'session.output_transcript.delta':
        case 'response.output_text.delta':
        case 'response.output_audio_transcript.delta': {
          const delta = evt.delta ?? '';
          if (!delta) break;
          feedTarget(delta);
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
      const tail = sourcePartial.trim();
      sourcePartial = '';
      if (tail) emitSource(tail);
      if (openRow && openRow.targetText.trim()) closeRow(openRow);
      openRow = null;
    },
  };
}
