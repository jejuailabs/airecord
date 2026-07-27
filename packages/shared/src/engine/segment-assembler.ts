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
  /** 통역 중 표시 언어가 바뀌면 알려준다 — 같은 언어 판정 기준이 달라진다 */
  setTargetLang(lang: string): void;
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
  /** 원문 전사가 이 시간 동안 안 오면 번역만으로 자막을 만든다 */
  sourceStallMs?: number;
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
  /**
   * ⚠ 1.2초는 너무 짧았다.
   * 실측(2026-07-27, 60초 연속 발화): 번역 델타 사이 최대 공백 1.6초, 원문 1.2초.
   * 타이머가 그보다 짧으면 문장이 끝나기도 전에 덩어리를 확정해,
   * 원문 한 문장이 번역 두 문장으로 갈릴 때 뒤 문장이 다음 덩어리로 밀린다.
   */
  const pauseMs = options.pauseMs ?? 2_500;
  const untranslatedIdleMs = options.untranslatedIdleMs ?? 3_500;
  const maxSourceChars = options.maxSourceChars ?? 160;
  const sourceStallMs = options.sourceStallMs ?? 2_500;
  let targetLang = options.targetLang;

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
  /** 마지막 원문 전사 도착 시각. 0이면 아직 한 번도 안 왔다. */
  let lastSourceAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 원문 대비 번역 길이 비율. 언어쌍마다 다르다 — 영어→한국어는 짧아지고, 한국어→영어는 길어진다.
   * 이 비율로 "이 덩어리가 가져갈 번역 분량"을 가늠해 한 덩어리가 전부 삼키는 것을 막는다.
   *
   * ⚠ 진행 중 누적치(도착한 원문/번역 총량)로 재면 안 된다.
   * 번역은 원문보다 1.5초쯤 늦게 오므로 그 비율은 항상 실제보다 낮게 나온다
   * (실측: 진행 중 0.30 vs 세션 전체 0.43). 낮게 잡히면 자를 지점을 너무 앞에서 찾아
   * 원문 한 문장의 번역이 첫 마침표에서 잘려 뒤 문장이 다음 덩어리로 밀린다.
   *
   * 그래서 **확정된 덩어리만** 센다. 확정된 것끼리는 원문·번역이 같은 구간을 덮으므로 편향이 없다.
   */
  let closedSource = 0;
  let closedTarget = 0;
  const targetPerSource = () => (closedSource < 40 ? 0.6 : closedTarget / closedSource);

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
    drainTarget(force);
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
   * 번역 델타를 받는 유일한 입구.
   *
   * ⚠ 반드시 버퍼 뒤에 붙인다. 예전에는 대기 중인 버퍼가 있어도 새 델타를
   * 덩어리에 바로 썼는데, 그러면 나중에 버퍼가 풀리며 이미 쓴 글 뒤에 끼어들어
   * 번역 글자 순서가 깨졌다("기 리뷰좋은 이 분에…" — 실측으로 확인).
   * 순서는 절대 어겨선 안 된다.
   */
  function feedTarget(text: string) {
    pendingTarget += text;
    drainTarget();
  }

  /** 버퍼를 앞에서부터 덩어리에 흘려보낸다 */
  function drainTarget(force = false) {
    while (pendingTarget) {
      let seg = currentOpen();
      if (!seg) {
        /**
         * 원문 전사가 끊겼는데 번역은 계속 오는 경우 (실사용 사고 2026-07-27).
         * 원문 주도 구조라 열린 덩어리가 없으면 번역이 여기 영영 갇혀,
         * 통역 음성은 잘 나오는데 자막만 세 줄에서 멈춰 버렸다.
         * 원문을 못 붙이더라도 번역만으로 자막을 계속 내보낸다.
         */
        const quiet = Date.now() - (lastSourceAt || startedAt);
        const stalled = quiet >= sourceStallMs && pendingTarget.trim().length >= 8;
        if (!(force ? pendingTarget.trim().length > 0 : stalled)) return;
        seg = newSegment('');
      }

      seg.targetText += pendingTarget;
      pendingTarget = '';
      emit(seg);

      /**
       * 아직 문장이 안 끝난 미리보기 조각은 여기서 닫지 않는다.
       * 닫으면 원문이 문장 한복판에서 잘려 "Good m" / "orning" 같은 자막이 나온다.
       * 문장이 완성될 때 정상 덩어리가 되고, 그때 아래 규칙으로 잘린다.
       */
      if (seg === livePreview) return;

      // 원문이 없는 덩어리는 길이 비례가 불가능하다 — 문장부호에서만 끊는다
      // 하한을 크게 잡으면 "네." → "Yes." 같은 짧은 문장이 다음 문장까지 물고 간다
      const quota = seg.sourceText ? Math.max(6, seg.sourceText.length * targetPerSource()) : 40;
      /**
       * 자를 지점은 예상 분량의 60%를 넘긴 뒤부터 찾는다.
       * 50%로 두면 원문 한 문장이 번역 두 문장으로 갈릴 때 첫 문장에서 끊겨
       * 자막이 한 칸씩 밀린다(실측으로 확인).
       */
      const idx = sentenceEndAtOrAfter(seg.targetText, Math.ceil(quota * 0.6) - 1);
      if (idx >= 0 && idx < seg.targetText.length - 1) {
        // 문장이 끝난 지점에서 자르고, 나머지는 버퍼로 되돌려 다음 덩어리가 받게 한다
        pendingTarget = seg.targetText.slice(idx + 1);
        seg.targetText = seg.targetText.slice(0, idx + 1);
        closeSegment(seg);
        continue;
      }
      if (idx >= 0) {
        closeSegment(seg);
        return;
      }
      /**
       * 구두점이 끝내 안 오는 경우의 안전장치 — 한 덩어리가 전부 삼키지 못하게 한다.
       * 절대 하한(24자)을 함께 두지 않으면, 짧은 원문에서 문장이 끝나기도 전에
       * 강제로 잘려 번역이 중간에서 토막 난다("Understood" / ". Thank y").
       */
      if (seg.targetText.length >= Math.max(24, quota * 1.6)) closeSegment(seg);
      return;
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
    // 언어쌍 비율은 확정된 덩어리로만 갱신한다 (위 주석 참고)
    if (!sameAsTarget && seg.sourceText.trim() && seg.targetText.trim()) {
      closedSource += seg.sourceText.length;
      closedTarget += seg.targetText.length;
    }
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
    setTargetLang(lang) {
      targetLang = lang;
    },

    handle(evt) {
      switch (evt.type) {
        // ── 원문: 자막 덩어리의 뼈대 ─────────────────
        case 'session.input_transcript.delta':
        case 'conversation.item.input_audio_transcription.delta': {
          if (evt.language) detectedLang = evt.language;
          lastSourceAt = Date.now();
          sourcePartial += evt.delta ?? '';
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
