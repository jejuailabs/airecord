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

const SENTENCE_SPLIT = /[^.!?。！？]+[.!?。！？]+\s*/g;
const HAS_WORD = /[\p{L}\p{N}]/u;
const SENTENCE_MARK = '.!?。！？…';

/** from 이후로 문장이 처음 끝나는 위치. 없으면 -1 */
function sentenceEndAtOrAfter(s: string, from: number): number {
  for (let i = Math.max(0, from); i < s.length; i++) {
    if (SENTENCE_MARK.includes(s.charAt(i))) return i;
  }
  return -1;
}

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
  /** 문장이 끝나기 전 미리 띄워 둔 덩어리 (완성되면 이 덩어리를 확정한다) */
  let livePreview: EngineSegment | null = null;
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
      targetText: '',
      isFinal: false,
      detectedLang,
    };
    open.push(seg);
    emit(seg); // 원문을 먼저 화면에 띄운다 — 번역은 곧 따라 붙는다
    return seg;
  }

  /**
   * 원문 덩어리가 생기기 전에 도착해 대기하던 번역을 흘려보낸다.
   * ⚠ newSegment 안에서 부르면 안 된다 — 갓 만든 미리보기 덩어리가 그 자리에서 닫히는데
   * 아직 livePreview에 대입되기 전이라 sourcePartial 정리가 건너뛰어지고 원문이 중복된다.
   */
  function flushPendingTarget(force = false) {
    if (!pendingTarget) return;
    /**
     * 아직 문장이 안 끝난 미리보기 조각밖에 없으면 기다린다.
     * 거기에 번역을 밀어 넣으면 그 자리에서 조각이 확정돼 원문이 어색하게 쪼개진다
     * ("Good m" / "orning").
     */
    if (!force && (open.length === 0 || (open.length === 1 && open[0] === livePreview))) return;
    const carry = pendingTarget;
    pendingTarget = '';
    feedTarget(carry);
  }

  /**
   * 완성된 원문 문장이 나올 때마다 덩어리를 하나 만든다.
   * 문장이 끝나기 전이라도 진행 중인 조각을 화면에 즉시 보여준다 —
   * 문장 완성을 기다리면 자막이 한꺼번에 뭉쳐 나오고 음성보다 한참 늦게 뜬다.
   */
  function drainSourceSentences() {
    const matches = sourcePartial.match(SENTENCE_SPLIT);
    if (matches) {
      sourcePartial = sourcePartial.slice(matches.join('').length);
      for (const raw of matches) {
        const s = raw.trim();
        if (!s || !HAS_WORD.test(s)) continue;
        // 미리 보여주던 조각이 있으면 그 덩어리를 완성된 문장으로 확정한다
        if (livePreview) {
          livePreview.sourceText = s;
          emit(livePreview);
          livePreview = null;
        } else {
          newSegment(s);
        }
      }
    }

    // 구두점 없이 길게 이어지면 강제로 끊는다
    if (sourcePartial.length >= maxSourceChars) {
      const cut = sourcePartial.lastIndexOf(' ', maxSourceChars);
      const at = cut > maxSourceChars / 2 ? cut : maxSourceChars;
      const head = sourcePartial.slice(0, at).trim();
      sourcePartial = sourcePartial.slice(at);
      if (head && HAS_WORD.test(head)) {
        if (livePreview) {
          livePreview.sourceText = head;
          emit(livePreview);
          livePreview = null;
        } else {
          newSegment(head);
        }
      }
    }

    // 아직 문장이 안 끝났으면 조각만이라도 즉시 띄운다
    const partial = sourcePartial.trim();
    if (partial && HAS_WORD.test(partial)) {
      if (!livePreview) livePreview = newSegment(partial);
      else {
        livePreview.sourceText = partial;
        emit(livePreview);
      }
    }

    // 덩어리가 생겼으니, 먼저 도착해 대기하던 번역을 이제 흘려보낸다
    flushPendingTarget();
  }

  /** 가장 오래된, 아직 열려 있는 덩어리 */
  function currentOpen(): EngineSegment | undefined {
    return open[0];
  }

  /**
   * 번역 델타를 가장 오래된 덩어리부터 채우고, 문장이 끝나면 거기서 잘라
   * 남은 말을 다음 덩어리로 넘긴다.
   *
   * 예전에는 "덩어리 끝이 마침표인가"만 봤는데, 델타 경계가 마침표에 딱 떨어지는 일이 드물어
   * ("…하세요. 오늘" 처럼 온다) 다음 문장 번역이 앞 덩어리에 붙어 버렸다.
   * 이제는 문장부호 위치에서 직접 자른다.
   *
   * 자를 위치는 원문 길이에 비례한 분량(quota)의 절반을 넘긴 뒤부터 찾는다 —
   * 그러지 않으면 짧은 첫 문장에서 잘려 뒤 덩어리가 번역을 다 가져간다.
   */
  function feedTarget(text: string) {
    let rest = text;
    while (rest) {
      const seg = currentOpen();
      if (!seg) {
        // 아직 원문 덩어리가 없으면 빈 덩어리를 만들지 않고 잠시 들고 있는다
        pendingTarget += rest;
        return;
      }
      seg.targetText += rest;
      rest = '';
      emit(seg);

      // 하한을 크게 잡으면 "네." → "Yes." 같은 짧은 문장이 다음 문장까지 물고 간다
      const quota = Math.max(6, seg.sourceText.length * targetPerSource());
      const idx = sentenceEndAtOrAfter(seg.targetText, Math.ceil(quota * 0.5) - 1);
      if (idx >= 0) {
        rest = seg.targetText.slice(idx + 1);
        seg.targetText = seg.targetText.slice(0, idx + 1);
        closeSegment(seg);
        continue;
      }
      /**
       * 구두점이 끝내 안 오는 경우의 안전장치 — 한 덩어리가 전부 삼키지 못하게 한다.
       * 절대 하한(24자)을 함께 두지 않으면, 짧은 원문에서 문장이 끝나기도 전에
       * 강제로 잘려 번역이 중간에서 토막 난다("Understood" / ". Thank y").
       */
      if (seg.targetText.length >= Math.max(24, quota * 1.6)) closeSegment(seg);
    }
  }

  function closeSegment(seg: EngineSegment, sameAsTarget = false) {
    const idx = open.indexOf(seg);
    if (idx >= 0) open.splice(idx, 1);
    if (livePreview === seg) {
      livePreview = null;
      /**
       * 미리 보여주던 조각이 확정됐다.
       * 그 부분을 남은 원문에서 지우지 않으면, 다음 델타가 붙을 때
       * 같은 말이 새 덩어리에 한 번 더 들어간다.
       */
      const i = sourcePartial.indexOf(seg.sourceText);
      if (i >= 0) sourcePartial = sourcePartial.slice(i + seg.sourceText.length);
    }
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
    // 대기 중인 번역이 남아 있으면 지금 흘려보낸다 — 여기서 안 보내면 영영 못 보낸다
    flushPendingTarget(true);
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
      // 남은 원문 조각도 덩어리로 만들어 유실을 막는다
      const tail = sourcePartial.trim();
      sourcePartial = '';
      if (tail && HAS_WORD.test(tail) && !livePreview) newSegment(tail);
      livePreview = null;
      flushPendingTarget(true);
      for (const seg of [...open]) {
        const sameScript =
          !targetLang || guessScript(seg.sourceText) === scriptOfLang(targetLang);
        closeSegment(seg, !seg.targetText.trim() && sameScript);
      }
    },
  };
}
