/**
 * 문서 번역 — 청크 분할과 검수.
 *
 * 정확도를 좌우하는 건 청크 설계다 (docs 브리핑).
 * 문장 단위로 쪼개면 대명사·용어·문체가 문단마다 흔들리므로,
 * 크게 자르되 앞뒤를 겹쳐 넘겨 문맥을 유지한다.
 */
import type { LangCode, SourceLangSetting } from '../types';
import { translateText } from './text';

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
    const chunks = splitIntoChunks(p.text);
    const parts: string[] = [];
    const notes: string[] = [];

    for (const c of chunks) {
      const prompt = c.context
        ? `[앞 문맥 — 번역하지 말고 참고만 할 것]\n${c.context}\n\n[번역할 본문]\n${c.body}`
        : c.body;
      const r = await translateText({
        text: prompt,
        sourceLang,
        targetLang,
        glossary,
        tone: 'plain',
      });
      parts.push(r.translated);
      if (r.notes?.length) notes.push(...r.notes);
    }

    const translated = parts.join('\n\n');
    notes.push(...verifyNumbers(p.text, translated));
    results.push({ page: p.page, source: p.text, translated, notes: notes.length ? notes : undefined });

    done += 1;
    onProgress?.(done, pages.length);
  }

  return results;
}
