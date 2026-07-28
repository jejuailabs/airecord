'use client';

import type { TranslateFileResponse } from '@sotong/shared/schemas';

/**
 * 파일 번역 결과 임시 보관.
 *
 * ⚠ 브라우저에만 저장한다. 화면에 "파일은 서버에 저장되지 않습니다"라고 적어 두었으므로
 * 서버로 보내면 그 약속이 깨진다. 번역문도 문서 내용 그 자체다.
 *
 * 왜 필요한가: 번역은 수십 초가 걸리는데 결과가 화면 상태로만 있었다.
 * 실수로 다른 메뉴를 누르거나 새로고침하면 그 시간과 비용이 통째로 날아간다.
 */
const KEY = 'sotong-file-drafts';
/** 몇 개까지 들고 있을지 — localStorage는 대략 5MB라 무한정 쌓을 수 없다 */
const MAX_ITEMS = 5;
/** 한 건이 이보다 크면 저장하지 않는다 (다른 항목까지 밀어내며 실패하는 것을 막는다) */
const MAX_BYTES = 1_500_000;

export interface FileDraft {
  id: string;
  savedAt: number;
  fileName: string;
  targetLang: string;
  pageCount: number;
  totalChars: number;
  result: TranslateFileResponse;
}

function read(): FileDraft[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as FileDraft[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list: FileDraft[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /**
     * 용량 초과 등으로 실패하면 가장 오래된 것부터 버리고 한 번 더 시도한다.
     * 그래도 안 되면 포기한다 — 저장 실패가 번역 결과 화면을 망가뜨리면 안 된다.
     */
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, 1)));
    } catch {
      /* noop */
    }
  }
}

export function listDrafts(): FileDraft[] {
  return read().sort((a, b) => b.savedAt - a.savedAt);
}

/** 번역이 끝나면 자동으로 부른다 — 유저가 따로 저장을 누르지 않아도 남는다 */
export function saveDraft(result: TranslateFileResponse, targetLang: string): FileDraft | null {
  const payload = JSON.stringify(result);
  if (payload.length > MAX_BYTES) return null;

  const draft: FileDraft = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: Date.now(),
    fileName: result.fileName,
    targetLang,
    pageCount: result.pages.length,
    totalChars: result.totalChars,
    result,
  };
  // 같은 파일을 다시 번역하면 옛 기록을 밀어낸다 — 목록에 같은 이름이 쌓이면 못 고른다
  const rest = read().filter((d) => !(d.fileName === draft.fileName && d.targetLang === targetLang));
  write([draft, ...rest].slice(0, MAX_ITEMS));
  return draft;
}

export function removeDraft(id: string): void {
  write(read().filter((d) => d.id !== id));
}

export function clearDrafts(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
