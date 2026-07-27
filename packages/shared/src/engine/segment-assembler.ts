/**
 * gpt-realtime-translate 이벤트 스트림 → EngineSegment 조립.
 *
 * ── 이 조립기는 **번역을 주인으로 삼는다.** ──────────────────────────────
 *
 * 번역 텍스트는 통역 음성과 **같은 생성에서 나온 한 쌍**이다(문서·실측 확인).
 * 그래서 번역 문자열은 자르거나 옮겨 담을 뿐 **내용을 바꾸지 않는다** —
 * 화면 글자와 귀에 들리는 말이 100% 같아야 한다.
 * 원문(영어)은 보조 정보라 번역 칸에 맞춰 묶어 붙인다.
 *
 * ⚠ 예전에는 원문을 주인으로 삼았다. 원문이 자주 안 왔기 때문인데, 두 가지가 바뀌었다:
 *  1. 전용 전사 레그가 생겨 원문이 안 죽는다 (열화 오디오 45초 741자 vs 부가 전사 144초 30자).
 *  2. 원문 주도는 **원문이 죽으면 자막이 통째로 멈춘다** — 실제로 세 줄에서 얼어붙는 사고가 났다.
 *     번역 주도면 원문이 죽어도 번역 자막은 멀쩡하고 영어 줄만 빈다. 더 불안정한 쪽을 주인으로
 *     두는 게 거꾸로였다.
 *
 * ⚠ "긴 번역이 여러 칸으로 쪼개지면 뒤쪽 칸의 원문이 빈다"는 예전 문제는
 *    원문을 **큐에 쌓아 칸마다 필요한 만큼 꺼내 쓰는** 방식으로 막았다.
 *    남으면 다음 칸이 가져가고 모자라면 기다린다 — 구조적으로 빌 수 없다.
 *
 * 실측(2026-07) 프로토콜 사실:
 * - 통역 세션 서버 이벤트는 input_transcript / output_transcript / output_audio 델타뿐,
 *   **종료(done) 이벤트가 없다** → 문장 경계는 직접 잡는다.
 * - 전용 전사 레그는 발화마다 VAD 경계(audio_start_ms/audio_end_ms)와 확정 원문을 준다.
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
  /** 통역 중 표시 언어가 바뀌면 알려준다 — 같은 언어 판정 기준이 달라진다 */
  setTargetLang(lang: string): void;
  /** 타이머 정리 — 세션 종료 시 반드시 호출 */
  dispose(): void;
}

export interface AssemblerOptions {
  /** 표시 언어 코드 — 원문이 같은 언어일 때 "번역 없음"으로 처리하는 데 쓴다 */
  targetLang?: string;
  /** 번역 델타가 이 시간 동안 없으면 열린 칸을 확정한다 */
  pauseMs?: number;
  /** 번역이 이 시간 동안 전혀 없으면 같은 언어로 보고 원문을 자막으로 내보낸다 */
  untranslatedIdleMs?: number;
  /** 자막 한 줄 목표 길이 (유저 요청: 30~50자 수준) */
  minRowChars?: number;
  maxRowChars?: number;
  /** 원문이 이 시간을 넘겨도 안 차면 있는 만큼 붙인다 */
  sourceWaitMs?: number;
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

/** until 이전의 마지막 절 경계(쉼표·공백). 문장부호가 끝내 안 올 때의 차선책 */
function softBreakBefore(s: string, until: number): number {
  const end = Math.min(s.length, until) - 1;
  for (let i = end; i > 0; i--) {
    if (CLAUSE_MARK.includes(s.charAt(i))) return i;
  }
  for (let i = end; i > 0; i--) {
    if (s.charAt(i) === ' ') return i;
  }
  return -1;
}

/** 원문 큐 항목 — 붙일 분량을 오디오 길이로 잰다 (언어쌍에 무관) */
interface SourceChunk {
  text: string;
  audioMs: number;
}

/** 원문 글자수로 오디오 길이를 어림잡을 때 쓰는 값 (부가 전사 폴백 경로) */
const SOURCE_CHARS_PER_SEC = 15;

export function createSegmentAssembler(
  onSegment: (s: EngineSegment) => void,
  onError?: (code: string, message: string) => void,
  options: AssemblerOptions = {},
): SegmentAssembler {
  /**
   * 실측(60초 연속 발화): 번역 델타 사이 최대 공백 1.6초.
   * 그보다 짧으면 문장 도중에 확정되고, 너무 길면 자막이 덩어리로 다닌다.
   */
  const pauseMs = options.pauseMs ?? 1_800;
  const untranslatedIdleMs = options.untranslatedIdleMs ?? 3_500;
  const minRowChars = options.minRowChars ?? 28;
  const maxRowChars = options.maxRowChars ?? 55;
  let targetLang = options.targetLang;

  const startedAt = Date.now();
  let nextSeq = 0;

  /** 번역을 받고 있는 칸 */
  let openRow: EngineSegment | null = null;
  /** 확정됐지만 아직 원문이 안 붙은 칸들 (오래된 것부터) */
  const awaitingSource: EngineSegment[] = [];
  /** seq → 원문을 기다리기 시작한 시각. 너무 오래 기다린 칸은 있는 만큼만 붙인다. */
  const awaitingSince = new Map<number, number>();
  /** 원문이 이 시간을 넘겨도 안 차면 있는 만큼 붙인다 (원문 지연 실측 2~3초) */
  const sourceWaitMs = options.sourceWaitMs ?? 6_000;
  /** 붙기를 기다리는 원문 조각들 */
  const sourceQueue: SourceChunk[] = [];

  /** 부가 전사(텍스트만 오는 폴백) 누적 버퍼 */
  let sourcePartial = '';
  /** VAD 모드 여부 — 전용 전사 레그가 붙으면 켜진다 */
  let vadMode = false;
  /** item_id → 그 발화의 오디오 구간 */
  const vadWindows = new Map<string, { startMs: number; endMs?: number }>();

  let detectedLang: string | undefined;
  let lastOutputAt = 0;
  let lastSourceAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 오디오 1초당 번역 글자수 — 원문을 얼마나 꺼내 붙일지 정하는 기준.
   * 실측(영어→한국어) 7.6~9.8자/초. 붙인 실적으로만 보정한다.
   */
  let pairedAudioSec = 0;
  let pairedTargetChars = 0;
  const charsPerSec = () => (pairedAudioSec < 3 ? 9 : pairedTargetChars / pairedAudioSec);

  const emit = (s: EngineSegment) => onSegment({ ...s });

  function newRow(): EngineSegment {
    const seg: EngineSegment = {
      seq: nextSeq++,
      startMs: Date.now() - startedAt,
      sourceText: '',
      targetText: '',
      isFinal: false,
      detectedLang,
    };
    return seg;
  }

  // ── 번역: 주인 스트림. 자르기만 하고 내용은 건드리지 않는다 ──────────────
  function feedTarget(text: string) {
    let rest = text;
    while (rest) {
      if (!openRow) openRow = newRow();
      openRow.targetText += rest;
      rest = '';
      emit(openRow);

      const t = openRow.targetText;
      if (t.length < minRowChars) return;

      // 문장 끝에서 끊는 게 1순위
      let cut = sentenceEndAtOrAfter(t, minRowChars - 1);
      // 문장부호가 끝내 안 오면 절 경계나 어절 경계에서 끊는다
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
    if (!row.targetText && !row.sourceText) return; // 빈 줄은 화면에 올리지 않는다
    awaitingSource.push(row);
    awaitingSince.set(row.seq, Date.now());
    emit(row);
    attachSources();
  }

  // ── 원문: 보조 스트림. 칸마다 필요한 만큼 큐에서 꺼내 붙인다 ─────────────
  function pushSource(text: string, audioMs: number) {
    const t = text.trim();
    if (!t || !HAS_WORD.test(t)) return;
    lastSourceAt = Date.now();
    sourceQueue.push({ text: t, audioMs: Math.max(200, audioMs) });
    attachSources();
  }

  /**
   * 칸이 가져갈 원문 분량 = 그 칸의 번역 글자수 ÷ (초당 글자수).
   * 남는 원문은 큐에 그대로 두어 다음 칸이 가져간다 → 뒤쪽 칸이 구조적으로 비지 않는다.
   */
  function attachSources(force = false) {
    while (awaitingSource.length > 0 && sourceQueue.length > 0) {
      const row = awaitingSource[0]!;
      const needMs = (row.targetText.length / charsPerSec()) * 1000;

      /**
       * ⚠ 먼저 계산만 하고, 충분히 모였을 때만 실제로 큐에서 뺀다.
       * 원문은 번역보다 2~3초 늦게 오므로, 도착한 만큼 성급히 붙이면
       * 뒤 문장이 다음 칸으로 밀려 자막 전체가 한 칸씩 어긋난다(실측으로 확인).
       */
      let gotMs = 0;
      let consume = 0; // 통째로 소비할 개수
      let splitAt = -1; // 마지막 항목을 어절 단위로 나눠 쓸 위치
      let splitRatio = 0;

      for (let i = 0; i < sourceQueue.length; i++) {
        const head = sourceQueue[i]!;
        const remainMs = needMs - gotMs;
        if (gotMs >= needMs * 0.8) break;
        // 한 발화가 필요한 양보다 훨씬 크면 앞부분만 쓰고 나머지는 남긴다
        if (head.audioMs > remainMs * 1.8 && remainMs > 0) {
          const ratio = Math.max(0.2, Math.min(0.85, remainMs / head.audioMs));
          const at = head.text.lastIndexOf(' ', Math.ceil(head.text.length * ratio));
          if (at > 0) {
            splitAt = at;
            splitRatio = ratio;
            gotMs += head.audioMs * ratio;
            break;
          }
        }
        gotMs += head.audioMs;
        consume = i + 1;
      }

      const enough = gotMs >= needMs * 0.8 || splitAt > 0;
      const waited = Date.now() - (awaitingSince.get(row.seq) ?? Date.now());
      // 오래 기다린 칸은 있는 만큼이라도 붙인다 — 영영 비워두지 않는다
      if (!enough && !force && waited < sourceWaitMs) return;
      if (consume === 0 && splitAt < 0) return;

      const parts: string[] = [];
      for (let i = 0; i < consume; i++) parts.push(sourceQueue[i]!.text);
      sourceQueue.splice(0, consume);
      if (splitAt > 0) {
        const head = sourceQueue[0]!;
        parts.push(head.text.slice(0, splitAt).trim());
        head.text = head.text.slice(splitAt).trim();
        head.audioMs = head.audioMs * (1 - splitRatio);
      }

      awaitingSource.shift();
      awaitingSince.delete(row.seq);
      row.sourceText = parts.join(' ').replace(/\s+/g, ' ').trim();
      if (row.targetText) {
        pairedAudioSec += gotMs / 1000;
        pairedTargetChars += row.targetText.length;
      }
      emit(row);
    }
  }

  /**
   * 번역이 전혀 안 오는 경우(표시 언어와 같은 말).
   * 원문만으로 자막을 만들어 화면이 멈추지 않게 한다.
   */
  function drainSourceOnly() {
    const idle = lastOutputAt ? Date.now() - lastOutputAt : Infinity;
    if (idle < untranslatedIdleMs) return;
    if (awaitingSource.length > 0 || openRow) return;
    while (sourceQueue.length > 0) {
      const chunk = sourceQueue.shift()!;
      const sameScript =
        !targetLang || guessScript(chunk.text) === scriptOfLang(targetLang);
      if (!sameScript) {
        sourceQueue.unshift(chunk); // 다른 언어인데 번역이 안 왔다 — 조금 더 기다린다
        return;
      }
      const row = newRow();
      row.sourceText = chunk.text;
      row.targetText = chunk.text;
      row.sameAsTarget = true;
      row.isFinal = true;
      row.endMs = Date.now() - startedAt;
      emit(row);
    }
  }

  /** 번역이 멈추면 열린 칸을 확정한다 */
  function onPause() {
    if (openRow && openRow.targetText.trim()) {
      closeRow(openRow);
      openRow = null;
    }
    attachSources(); // 오래 기다린 칸은 여기서 있는 만큼 붙는다
    drainSourceOnly();
  }

  function armTimer() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onPause, pauseMs);
  }

  /** 부가 전사(텍스트만) 경로 — 문장 단위로 잘라 큐에 넣는다 */
  function drainSourceText() {
    for (;;) {
      const idx = sentenceEndAtOrAfter(sourcePartial, 0);
      if (idx < 0) break;
      const sentence = sourcePartial.slice(0, idx + 1);
      sourcePartial = sourcePartial.slice(idx + 1);
      pushSource(sentence, (sentence.length / SOURCE_CHARS_PER_SEC) * 1000);
    }
    // 구두점 없이 길어지면 강제로 끊는다
    if (sourcePartial.length >= 160) {
      const at = sourcePartial.lastIndexOf(' ', 160);
      const cut = at > 80 ? at : 160;
      const head = sourcePartial.slice(0, cut);
      sourcePartial = sourcePartial.slice(cut);
      pushSource(head, (head.length / SOURCE_CHARS_PER_SEC) * 1000);
    }
  }

  return {
    setTargetLang(lang) {
      targetLang = lang;
    },

    handle(evt) {
      const itemId = typeof evt.item_id === 'string' ? evt.item_id : undefined;

      switch (evt.type) {
        // ── VAD 경계: 발화의 오디오 구간을 기록한다 ──
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
          const audioMs =
            w && w.endMs != null
              ? w.endMs - w.startMs
              : (transcript.length / SOURCE_CHARS_PER_SEC) * 1000;
          if (itemId) vadWindows.delete(itemId);
          pushSource(transcript, audioMs);
          armTimer();
          break;
        }

        // ── 부가 전사(폴백): 텍스트만 온다 ──
        case 'session.input_transcript.delta':
        case 'conversation.item.input_audio_transcription.delta': {
          if (evt.language) detectedLang = evt.language;
          // VAD 모드에서는 확정본(completed)만 쓴다 — 델타까지 받으면 같은 말이 두 번 들어간다
          if (vadMode) break;
          lastSourceAt = Date.now();
          sourcePartial += evt.delta ?? '';
          drainSourceText();
          armTimer();
          break;
        }

        // ── 번역: 주인 스트림 ──
        case 'session.output_transcript.delta':
        case 'response.output_text.delta':
        case 'response.output_audio_transcript.delta': {
          lastOutputAt = Date.now();
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
      // 남은 원문 조각도 큐에 넣어 유실을 막는다
      const tail = sourcePartial.trim();
      sourcePartial = '';
      if (tail) pushSource(tail, (tail.length / SOURCE_CHARS_PER_SEC) * 1000);

      if (openRow && (openRow.targetText.trim() || openRow.sourceText.trim())) {
        closeRow(openRow);
      }
      openRow = null;

      // 아직 원문이 못 붙은 칸에 남은 원문을 몰아 붙인다
      while (awaitingSource.length > 0) {
        const row = awaitingSource.shift()!;
        if (sourceQueue.length > 0) {
          const take = awaitingSource.length === 0 ? sourceQueue.splice(0) : sourceQueue.splice(0, 1);
          row.sourceText = take.map((c) => c.text).join(' ').trim();
        }
        emit(row);
      }

      // 번역이 끝내 없던 원문은 그대로 자막으로 내보낸다
      lastOutputAt = 0;
      drainSourceOnly();

      /**
       * 여기까지 남은 원문은 표시 언어와 문자가 달라 자막으로 못 쓴 것들이다.
       * 그래도 버리지 않는다 — 세션 기록에서 원문이 사라지면 안 된다.
       */
      while (sourceQueue.length > 0) {
        const chunk = sourceQueue.shift()!;
        const row = newRow();
        row.sourceText = chunk.text;
        row.isFinal = true;
        row.endMs = Date.now() - startedAt;
        emit(row);
      }
    },
  };
}
