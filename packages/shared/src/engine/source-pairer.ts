/**
 * 번역 줄 ↔ 원문 문장 짝짓기 (대면·대화 통역).
 *
 * 예전에는 "가장 최근 원문 한 칸"을 들고 있다가 번역 줄이 확정될 때 붙였다.
 * 원문(전사)은 번역보다 먼저 도착하는 일이 많아, 번역이 확정되기 전에 다음 원문이
 * 그 칸을 덮어써 버렸다 — 원문이 한 줄씩 밀리고 중간 문장이 사라졌다
 * (실측 2026-10-17, 스페인어 7문장 중 3문장 유실·2줄 어긋남).
 *
 * 그래서 양쪽을 **문장 단위 줄(queue)** 로 세우고 순서대로 맞춘다.
 *   · 번역 줄이 확정되면 그 줄의 문장 수만큼 원문 문장을 앞에서 꺼내 붙인다.
 *   · 원문이 아직 없으면 그 번역 줄을 대기열에 두고, 원문이 오는 대로 뒤늦게 채운다.
 *   · 번역 모델이 문장을 합치거나 쪼개면 개수가 어긋날 수 있다 — 오래된(staleMs) 대기분은
 *     버리거나 한꺼번에 붙여 어긋남이 계속 쌓이지 않게 한다.
 *
 * ⚠ 원문·번역 문자열 자체는 바꾸지 않는다. 문장 경계로 나누고 다시 이어 붙일 뿐이다.
 */

export interface PairedSource {
  sourceText: string;
  lang?: string;
}

export interface SourceFill extends PairedSource {
  seq: number;
}

export interface SourcePairer {
  /** 확정 원문 조각을 넣는다. 원문을 기다리던 번역 줄이 채워지면 그 목록을 돌려준다. */
  pushSource(text: string, lang?: string): SourceFill[];
  /** 번역 줄이 확정됐다. 지금 붙일 수 있는 원문을 돌려준다(없으면 빈 문자열). */
  takeForTarget(seq: number, targetText: string): PairedSource;
  /** 세션 종료 — 문장부호 없이 남은 원문 꼬리를 기다리던 줄에 붙인다. */
  flush(): SourceFill[];
  reset(): void;
}

const SENTENCE_END = /[.!?。！？…]+["'”’)\]]*/g;

/** 문장 끝 기준으로 자른다. 마지막 미완성 조각은 rest로 돌려준다. */
function splitSentences(text: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let last = 0;
  for (const m of text.matchAll(SENTENCE_END)) {
    const end = (m.index ?? 0) + m[0].length;
    const s = text.slice(last, end).trim();
    if (s) sentences.push(s);
    last = end;
  }
  return { sentences, rest: text.slice(last).trim() };
}

/** 번역 줄이 품은 문장 수. 문장부호 없이 잘린 줄(문장 중간)은 0. */
function countSentences(text: string): number {
  return splitSentences(text).sentences.length;
}

interface QueuedSentence {
  text: string;
  lang?: string;
  at: number;
}

interface WaitingRow {
  seq: number;
  need: number;
  got: string[];
  lang?: string;
  at: number;
}

export function createSourcePairer(
  opts: { staleMs?: number; now?: () => number } = {},
): SourcePairer {
  const staleMs = opts.staleMs ?? 10_000;
  const now = opts.now ?? (() => Date.now());

  let queue: QueuedSentence[] = [];
  let waiting: WaitingRow[] = [];
  /** 문장부호가 아직 안 온 원문 꼬리 — 다음 조각과 이어 붙인다 */
  let carry = '';
  let carryLang: string | undefined;
  /** 마지막으로 원문을 다 채운 번역 줄 — 이어지는 소문자 조각을 여기에 덧붙인다 */
  let lastDone: { seq: number; parts: string[]; lang?: string; at: number } | null = null;

  const join = (parts: string[]) => parts.join(' ').replace(/\s+/g, ' ').trim();

  /** 오래 기다린 번역 줄은 포기한다 — 원문이 끝내 안 왔거나 개수가 어긋난 경우 */
  function dropStaleWaiting(t: number) {
    waiting = waiting.filter((w) => t - w.at < staleMs);
  }

  function fillWaiting(): SourceFill[] {
    const fills: SourceFill[] = [];
    while (waiting.length && queue.length) {
      const w = waiting[0]!;
      const s = queue.shift()!;
      w.got.push(s.text);
      w.lang ??= s.lang;
      if (w.got.length >= w.need) {
        waiting.shift();
        fills.push({ seq: w.seq, sourceText: join(w.got), lang: w.lang });
        lastDone = { seq: w.seq, parts: w.got, lang: w.lang, at: now() };
      }
    }
    return fills;
  }

  return {
    pushSource(text, lang) {
      const t = now();
      dropStaleWaiting(t);
      const merged = carry ? `${carry} ${text}` : text;
      const pieceLang = lang ?? carryLang;
      const { sentences, rest } = splitSentences(merged);
      const fills: SourceFill[] = [];
      for (const s of sentences) {
        /**
         * 소문자로 시작하는 문장은 앞 문장의 이어짐이다 — 전사가 문장 중간에 마침표를 찍은 경우
         * ("…con el proveedor. / antes de fin de mes."). 따로 세면 한 줄씩 밀린다.
         */
        if (/^\p{Ll}/u.test(s)) {
          const lastQueued = queue[queue.length - 1];
          const partial = waiting[0]?.got;
          if (lastQueued) {
            lastQueued.text = join([lastQueued.text, s]);
            continue;
          }
          if (partial && partial.length > 0) {
            partial[partial.length - 1] = join([partial[partial.length - 1]!, s]);
            continue;
          }
          if (lastDone && t - lastDone.at < staleMs) {
            lastDone.parts = [...lastDone.parts, s];
            fills.push({ seq: lastDone.seq, sourceText: join(lastDone.parts), lang: lastDone.lang });
            continue;
          }
        }
        queue.push({ text: s, lang: pieceLang, at: t });
      }
      carry = rest;
      carryLang = rest ? pieceLang : undefined;
      return [...fills, ...fillWaiting()];
    },

    takeForTarget(seq, targetText) {
      const t = now();
      dropStaleWaiting(t);
      const need = countSentences(targetText);
      if (need === 0) return { sourceText: '' }; // 문장 중간에서 잘린 번역 — 다음 줄이 원문을 받는다

      /**
       * 앞선 번역 줄이 아직 원문을 기다리는 중이면 순서를 지킨다 — 새 줄이 새치기하면 어긋난다.
       * 대신 대기열이 비어 있을 때만 바로 꺼내 붙인다.
       */
      if (waiting.length === 0) {
        // 오래 묵은 원문은 번역이 문장을 합친 흔적이다 — 이번 줄에 함께 붙여 따라잡는다
        let take = need;
        while (take < queue.length && t - queue[take]!.at >= staleMs) take++;
        const got = queue.splice(0, Math.min(take, queue.length));
        if (got.length >= need) {
          const parts = got.map((g) => g.text);
          lastDone = { seq, parts, lang: got[0]?.lang, at: t };
          return { sourceText: join(parts), lang: got[0]?.lang };
        }
        if (got.length > 0) {
          waiting.push({ seq, need, got: got.map((g) => g.text), lang: got[0]?.lang, at: t });
          return { sourceText: join(got.map((g) => g.text)), lang: got[0]?.lang };
        }
      }
      waiting.push({ seq, need, got: [], at: t });
      return { sourceText: '' };
    },

    flush() {
      if (carry) {
        queue.push({ text: carry, lang: carryLang, at: now() });
        carry = '';
        carryLang = undefined;
      }
      const fills = fillWaiting();
      // 개수가 모자라 대기 중인 줄도 받은 만큼은 내보낸다
      for (const w of waiting) {
        if (w.got.length) fills.push({ seq: w.seq, sourceText: join(w.got), lang: w.lang });
      }
      waiting = [];
      return fills;
    },

    reset() {
      lastDone = null;
      queue = [];
      waiting = [];
      carry = '';
      carryLang = undefined;
    },
  };
}
