/**
 * 브라우저에서 .docx를 번역해 .docx로 되돌려준다.
 *
 * 파일은 서버로 보내지 않는다. 여기서 ZIP을 풀고, 문단 글자만 서버에 보내고,
 * 받은 번역을 제자리에 되쓴 뒤 다시 압축한다 — 원본 서식이 그대로 남는다.
 */
import { unzipSync, zipSync } from 'fflate';
import type { SourceLangSetting, LangCode } from '@sotong/shared/types';
import {
  collectParagraphs,
  applyTranslations,
  translatableParts,
  type DocxMode,
  type DocxUnit,
} from './transform';

/**
 * 한 번에 보낼 글자 수.
 * 크게 잡으면 모델이 뒤쪽 문단을 흘리고, 잘게 자르면 앞뒤 문맥이 끊긴다.
 * 서버 스키마의 문단 수 상한(400)도 같이 지켜야 한다.
 */
const CHUNK_CHARS = 3_000;
const CHUNK_ITEMS = 200;

export interface DocxTranslateOptions {
  file: File;
  mode: DocxMode;
  sourceLang: SourceLangSetting;
  targetLang: LangCode;
  tone?: 'plain' | 'formal' | 'casual';
  /** 0~1 — 문단 번역 진행률 */
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

export interface DocxTranslateResult {
  blob: Blob;
  fileName: string;
  /** 번역한 문단 수 */
  translated: number;
  /** 번역이 오지 않아 원문 그대로 둔 문단 수 */
  missing: number;
}

/** 묶음 나누기 — 글자 수와 문단 수 둘 다 넘지 않게 자른다 */
function chunk(units: DocxUnit[]): DocxUnit[][] {
  const out: DocxUnit[][] = [];
  let cur: DocxUnit[] = [];
  let size = 0;
  for (const u of units) {
    // 한 문단이 통째로 상한을 넘어도 쪼개지 않는다 — 문장이 잘리느니 크게 보낸다
    if (cur.length > 0 && (size + u.text.length > CHUNK_CHARS || cur.length >= CHUNK_ITEMS)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(u);
    size += u.text.length;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/** 파일명에 무엇을 했는지 남긴다 — 원본과 섞이면 어느 게 어느 건지 알 수 없다 */
export function outputName(original: string, mode: DocxMode, targetLang: string): string {
  const base = original.replace(/\.docx$/i, '');
  return `${base} (${mode === 'bilingual' ? '원문·번역' : targetLang}).docx`;
}

export async function translateDocx(opts: DocxTranslateOptions): Promise<DocxTranslateResult> {
  const { file, mode, sourceLang, targetLang, tone = 'plain', onProgress, signal } = opts;

  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const parts = translatableParts(Object.keys(zip));
  if (parts.length === 0) throw new Error('not_a_docx');

  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  /**
   * 편(본문·머리말·꼬리말·각주)마다 따로 파싱하되 문단 번호는 이어서 붙인다.
   * 번호가 문서 전체에서 유일해야 번역 응답의 짝을 맞출 수 있다.
   */
  const loaded: Array<{ part: string; doc: Document; units: DocxUnit[]; nodes: Element[] }> = [];
  let n = 0;
  for (const part of parts) {
    const doc = parser.parseFromString(decoder.decode(zip[part]!), 'application/xml');
    const { units, nodes, nextN } = collectParagraphs(doc, n);
    n = nextN;
    if (units.length > 0) loaded.push({ part, doc, units, nodes });
  }

  const all = loaded.flatMap((l) => l.units);
  if (all.length === 0) throw new Error('no_text');

  // 번역 — 묶음별로 순차 요청. 한 묶음이 실패해도 나머지는 살린다.
  const translations = new Map<number, string>();
  const groups = chunk(all);
  for (let i = 0; i < groups.length; i++) {
    signal?.throwIfAborted();
    const res = await fetch('/api/translate/docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: groups[i], sourceLang, targetLang, tone }),
      signal,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? 'translate_failed');
    }
    const json = (await res.json()) as { items: Array<{ n: number; text: string }> };
    for (const it of json.items) translations.set(it.n, it.text);
    onProgress?.((i + 1) / groups.length);
  }

  // 되쓰기 — 번역이 안 온 문단은 원문 그대로 둔다
  const out: Record<string, Uint8Array> = { ...zip };
  let translated = 0;
  let missing = 0;
  for (const l of loaded) {
    const r = applyTranslations(l.nodes, l.units, translations, mode);
    translated += r.applied;
    missing += r.missing;
    out[l.part] = encoder.encode(serializer.serializeToString(l.doc));
  }

  return {
    blob: new Blob([zipSync(out) as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    fileName: outputName(file.name, mode, targetLang),
    translated,
    missing,
  };
}
