/**
 * 문서 번역 — 청크 분할과 검수.
 *
 * 정확도를 좌우하는 건 청크 설계다 (docs 브리핑).
 * 문장 단위로 쪼개면 대명사·용어·문체가 문단마다 흔들리므로,
 * 크게 자르되 앞뒤를 겹쳐 넘겨 문맥을 유지한다.
 */
import type { LangCode, SourceLangSetting } from '../types';
import { translateText, translateParagraphs, type NumberedParagraph } from './text';

/** 한 번에 넘기는 본문 길이 */
export const CHUNK_CHARS = 2_800;
/** 앞 청크 꼬리를 얼마나 겹쳐 문맥으로 넘길지 */
export const CHUNK_OVERLAP_CHARS = 400;

export interface DocChunk {
  index: number;
  /** 번역 대상 본문 */
  body: string;
  /** 앞 청크에서 이어지는 문맥 (번역 결과에 포함하지 않는다) */
  context: string;
}

/**
 * 문단·문장 경계를 지키며 자른다.
 * 문단 중간을 자르면 대명사가 어디를 가리키는지 모르게 된다.
 */
export function splitIntoChunks(text: string): DocChunk[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: DocChunk[] = [];
  let buf = '';

  const flush = () => {
    if (!buf.trim()) return;
    const prev = chunks[chunks.length - 1];
    chunks.push({
      index: chunks.length,
      body: buf,
      context: prev ? prev.body.slice(-CHUNK_OVERLAP_CHARS) : '',
    });
    buf = '';
  };

  for (const p of paragraphs) {
    if (buf && buf.length + p.length + 2 > CHUNK_CHARS) flush();
    // 한 문단이 통째로 상한을 넘으면 문장 단위로 쪼갠다
    if (p.length > CHUNK_CHARS) {
      const sentences = p.match(/[^.!?。！？\n]+[.!?。！？]*\s*/g) ?? [p];
      for (const s of sentences) {
        if (buf.length + s.length > CHUNK_CHARS) flush();
        buf += s;
      }
      continue;
    }
    buf += (buf ? '\n\n' : '') + p;
  }
  flush();
  return chunks;
}

export interface TranslateDocPage {
  page: number;
  source: string;
  translated: string;
  notes?: string[];
  /**
   * 문단별 원문·번역 짝.
   * 기본 화면은 translated만 쓰지만, "원문과 합치기"를 누르면 이걸로 번갈아 배치한다.
   * 짝이 맞아야 성립하므로 번호를 붙여 받는다 (text.ts의 translateParagraphs).
   */
  pairs?: Array<{ source: string; translated: string }>;
}

/** 문단 단위로 자른다 — 대역 배치의 기본 단위 */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+$/, ''))
    .filter((p) => p.trim().length > 0);
}

/**
 * 문단들을 청크로 묶는다. 한 번에 너무 많이 보내면 모델이 번호를 흘린다.
 * 문단 경계는 절대 깨지 않는다 — 깨면 짝이 어긋난다.
 */
export function groupParagraphs(
  paragraphs: string[],
  limit = CHUNK_CHARS,
): NumberedParagraph[][] {
  const groups: NumberedParagraph[][] = [];
  let cur: NumberedParagraph[] = [];
  let size = 0;
  paragraphs.forEach((text, i) => {
    const item = { n: i, text };
    // 한 문단이 통째로 상한을 넘어도 쪼개지 않는다 (짝이 깨지는 것보다 낫다)
    if (cur.length > 0 && size + text.length > limit) {
      groups.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(item);
    size += text.length;
  });
  if (cur.length > 0) groups.push(cur);
  return groups;
}

export interface TranslateDocInput {
  /** 페이지별 원문 (이미지는 페이지 1개) */
  pages: Array<{ page: number; text: string }>;
  sourceLang: SourceLangSetting;
  targetLang: LangCode;
  glossary?: Array<{ term: string; translation: string }>;
  onProgress?: (done: number, total: number) => void;
}

/** 한국어·중국어 수 단위 */
const UNIT_MULTIPLIER: Record<string, number> = {
  천: 1_000,
  만: 10_000,
  억: 100_000_000,
  조: 1_000_000_000_000,
};

/** 영어 자릿수 단어 */
const EN_MULTIPLIER: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  m: 1_000_000,
  mn: 1_000_000,
  million: 1_000_000,
  bn: 1_000_000_000,
  billion: 1_000_000_000,
  trillion: 1_000_000_000_000,
};

const NUMBER_RE =
  /(\d[\d,]*(?:\.\d+)?)\s*([천만억조]|k|m|mn|bn|thousand|million|billion|trillion)?/gi;

/**
 * 문자열에서 수치를 뽑아 "가능한 값들"로 정규화한다.
 * 같은 금액이 "1,250만"·"12,500,000"·"12.5 million"으로 다르게 표기되므로
 * 하나로 못 박지 않고 후보 집합으로 다룬다.
 */
function extractValueSets(s: string): Array<Set<number>> {
  const out: Array<Set<number>> = [];
  let m: RegExpExecArray | null;
  NUMBER_RE.lastIndex = 0;
  while ((m = NUMBER_RE.exec(s))) {
    const base = Number(m[1]!.replace(/,/g, ''));
    if (!Number.isFinite(base)) continue;
    const unit = m[2]?.toLowerCase();
    const mult = unit ? (UNIT_MULTIPLIER[unit] ?? EN_MULTIPLIER[unit] ?? 1) : 1;
    const set = new Set<number>([base * mult]);
    if (mult !== 1) set.add(base); // 단위를 뗀 표기도 인정
    out.push(set);
  }
  return out;
}

function flatten(sets: Array<Set<number>>): Set<number> {
  const all = new Set<number>();
  for (const s of sets) for (const v of s) all.add(v);
  return all;
}

/**
 * 수치 검수 — 원문의 금액·수량이 번역문에서 사라졌는지 본다.
 *
 * 100 미만은 검사하지 않는다. 날짜("3월 14일" → "March 14")처럼
 * 숫자가 단어로 바뀌는 경우가 많아 경고가 노이즈가 되기 때문이다.
 * 경고가 많으면 아무도 안 보게 된다.
 */
export function verifyNumbers(source: string, translated: string): string[] {
  const SIGNIFICANT = 100;
  const srcSets = extractValueSets(source).filter((set) =>
    [...set].some((v) => v >= SIGNIFICANT),
  );
  const tgtValues = flatten(extractValueSets(translated));

  const missing: number[] = [];
  for (const set of srcSets) {
    // 후보 중 하나라도 번역문에 있으면 통과
    if ([...set].some((v) => tgtValues.has(v))) continue;
    missing.push(Math.max(...set));
  }
  if (!missing.length) return [];
  const shown = [...new Set(missing)].slice(0, 5).map((n) => n.toLocaleString());
  return [`원문의 수치 ${shown.join(', ')}가 번역문에서 확인되지 않습니다.`];
}

/** 페이지 단위로 번역한다. 페이지가 길면 내부에서 청크로 나눈다. */
export async function translateDocument(
  input: TranslateDocInput,
): Promise<TranslateDocPage[]> {
  const { pages, sourceLang, targetLang, glossary, onProgress } = input;
  const results: TranslateDocPage[] = [];
  let done = 0;

  for (const p of pages) {
    const notes: string[] = [];
    const paragraphs = splitParagraphs(p.text);

    /**
     * 문단마다 번호를 붙여 번역한다.
     * 예전에는 덩어리째 번역해 문자열 하나만 받았는데, 그러면 원문·번역 짝을 알 수 없어
     * 대역(원문+번역) 문서를 만들 수 없다. 번호로 받으면 짝이 어긋날 수 없다.
     */
    const byIndex = new Map<number, string>();
    let prevTail = '';

    for (const group of groupParagraphs(paragraphs)) {
      try {
        const got = await translateParagraphs({
          paragraphs: group,
          sourceLang,
          targetLang,
          glossary,
          tone: 'plain',
          context: prevTail,
        });
        for (const [n, text] of got) byIndex.set(n, text);
      } catch {
        /**
         * 번호 번역이 실패하면 그 묶음만 통째로 번역해 첫 문단에 넣는다.
         * 짝은 잃지만 번역문 자체는 나온다 — 아무것도 안 나오는 것보다 낫다.
         */
        const joined = group.map((g) => g.text).join('\n\n');
        const r = await translateText({
          text: joined,
          sourceLang,
          targetLang,
          glossary,
          tone: 'plain',
        });
        if (group[0]) byIndex.set(group[0].n, r.translated);
        if (r.notes?.length) notes.push(...r.notes);
      }
      prevTail = group
        .map((g) => g.text)
        .join('\n\n')
        .slice(-CHUNK_OVERLAP_CHARS);
    }

    const pairs = paragraphs.map((source, i) => ({ source, translated: byIndex.get(i) ?? '' }));
    const missing = pairs.filter((x) => !x.translated).length;
    if (missing > 0) notes.push(`문단 ${missing}개는 번역이 오지 않아 비어 있습니다.`);

    const translated = pairs
      .map((x) => x.translated)
      .filter(Boolean)
      .join('\n\n');
    notes.push(...verifyNumbers(p.text, translated));
    results.push({
      page: p.page,
      source: p.text,
      translated,
      pairs,
      notes: notes.length ? notes : undefined,
    });

    done += 1;
    onProgress?.(done, pages.length);
  }

  return results;
}
