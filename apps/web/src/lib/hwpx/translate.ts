/**
 * 브라우저에서 .hwpx(한글)를 번역해 .hwpx로 되돌려준다.
 *
 * docx와 완전히 같은 흐름이다. 파일은 서버로 보내지 않는다 — 여기서 ZIP을 풀고,
 * 문단 글자만 서버에 보내(같은 /api/translate/docx 재사용) 번역을 받아 제자리에 되쓴 뒤
 * 다시 압축한다. 원본 표·서식이 그대로 남는다.
 *
 * ⚠ HWPX는 OCF(ODF·EPUB 계열) ZIP이라 `mimetype` 항목이 **맨 앞·무압축**이어야 안전하다.
 *   fflate로 다시 압축할 때 그 규칙을 지켜 준다.
 */
import { unzipSync, zipSync, type Zippable } from 'fflate';
import type { SourceLangSetting, LangCode } from '@sotong/shared/types';
import {
  collectParagraphs,
  applyTranslations,
  translatableParts,
  type HwpxMode,
  type HwpxUnit,
} from './transform';

/** 한 번에 보낼 글자 수 — docx와 같은 값 (서버 문단 수 상한 400도 함께 지킨다) */
const CHUNK_CHARS = 3_000;
const CHUNK_ITEMS = 200;

export interface HwpxTranslateOptions {
  file: File;
  mode: HwpxMode;
  sourceLang: SourceLangSetting;
  targetLang: LangCode;
  tone?: 'plain' | 'formal' | 'casual';
  /** 0~1 — 문단 번역 진행률 */
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

export interface HwpxTranslateResult {
  blob: Blob;
  fileName: string;
  translated: number;
  missing: number;
}

/** 묶음 나누기 — 글자 수·문단 수 둘 다 넘지 않게 (docx와 동일) */
function chunk(units: HwpxUnit[]): HwpxUnit[][] {
  const out: HwpxUnit[][] = [];
  let cur: HwpxUnit[] = [];
  let size = 0;
  for (const u of units) {
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

/** 파일명에 무엇을 했는지 남긴다 */
export function outputName(original: string, mode: HwpxMode, targetLang: string): string {
  const base = original.replace(/\.hwpx$/i, '');
  return `${base} (${mode === 'bilingual' ? '원문·번역' : targetLang}).hwpx`;
}

export async function translateHwpx(opts: HwpxTranslateOptions): Promise<HwpxTranslateResult> {
  const { file, mode, sourceLang, targetLang, tone = 'plain', onProgress, signal } = opts;

  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const parts = translatableParts(Object.keys(zip));
  if (parts.length === 0) throw new Error('not_a_hwpx');

  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  /** 섹션마다 따로 파싱하되 문단 번호는 이어 붙인다 — 번호가 문서 전체에서 유일해야 짝이 맞는다 */
  const loaded: Array<{ part: string; doc: Document; units: HwpxUnit[]; nodes: Element[] }> = [];
  let n = 0;
  for (const part of parts) {
    const doc = parser.parseFromString(decoder.decode(zip[part]!), 'application/xml');
    const { units, nodes, nextN } = collectParagraphs(doc, n);
    n = nextN;
    if (units.length > 0) loaded.push({ part, doc, units, nodes });
  }

  const all = loaded.flatMap((l) => l.units);
  if (all.length === 0) throw new Error('no_text');

  // 번역 — 묶음별 순차 요청 (docx 엔드포인트 재사용: 번호 붙은 문단만 번역하는 형식 무관 API)
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
  const modified: Record<string, Uint8Array> = {};
  let translated = 0;
  let missing = 0;
  for (const l of loaded) {
    const r = applyTranslations(l.nodes, l.units, translations, mode);
    translated += r.applied;
    missing += r.missing;
    modified[l.part] = encoder.encode(serializer.serializeToString(l.doc));
  }

  /**
   * 다시 압축 — mimetype을 맨 앞에 무압축(level 0)으로 넣는다 (OCF 규칙).
   * 나머지는 원본 바이트 그대로, 바뀐 섹션만 교체한다.
   */
  const out: Zippable = {};
  if (zip['mimetype']) out['mimetype'] = [zip['mimetype'], { level: 0 }];
  for (const name of Object.keys(zip)) {
    if (name === 'mimetype') continue;
    out[name] = modified[name] ?? zip[name]!;
  }

  return {
    blob: new Blob([zipSync(out) as unknown as BlobPart], {
      // HWPX 공식 MIME
      type: 'application/hwp+zip',
    }),
    fileName: outputName(file.name, mode, targetLang),
    translated,
    missing,
  };
}
