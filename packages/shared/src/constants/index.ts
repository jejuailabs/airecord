import type { LangCode, SourceLangSetting, UiLocale } from '../types';

/**
 * 통역 언어 목록. 언어 이름은 자기 언어로 표기한다 (docs/06 §4.4).
 * 실제 선택 가능 여부는 engine.supports()로 최종 검사한다 — 이 목록을 곧이곧대로 UI에 뿌리지 않는다.
 */
export interface InterpretLanguage {
  code: LangCode;
  /** 자기 언어 표기 */
  label: string;
  /** 영어 표기 (검색·로그용) */
  english: string;
}

export const INTERPRET_LANGUAGES: readonly InterpretLanguage[] = [
  { code: 'ko', label: '한국어', english: 'Korean' },
  { code: 'en', label: 'English', english: 'English' },
  { code: 'ja', label: '日本語', english: 'Japanese' },
  { code: 'zh', label: '中文', english: 'Chinese' },
  { code: 'es', label: 'Español', english: 'Spanish' },
  { code: 'fr', label: 'Français', english: 'French' },
  { code: 'de', label: 'Deutsch', english: 'German' },
  { code: 'pt', label: 'Português', english: 'Portuguese' },
  { code: 'it', label: 'Italiano', english: 'Italian' },
  { code: 'ru', label: 'Русский', english: 'Russian' },
  { code: 'vi', label: 'Tiếng Việt', english: 'Vietnamese' },
  { code: 'th', label: 'ไทย', english: 'Thai' },
  { code: 'id', label: 'Bahasa Indonesia', english: 'Indonesian' },
  { code: 'ar', label: 'العربية', english: 'Arabic' },
  { code: 'hi', label: 'हिन्दी', english: 'Hindi' },
] as const;

/** 소스 언어 자동 감지 센티널 */
export const AUTO_SOURCE: SourceLangSetting = 'auto';

/**
 * gpt-realtime-translate 출력(목적) 언어 13개 — 2026-07 조사값.
 * 입력은 70+ 자동 감지라 제한 없음. 이 목록은 engine.supports()와 UI 선택지 양쪽에서 쓴다.
 * 출처: OpenAI realtime translation guide (분기마다 재확인 — core.md §3-7)
 */
export const TRANSLATE_TARGET_LANGS: readonly LangCode[] = [
  'en', 'ko', 'ja', 'zh', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'vi', 'id', 'hi',
] as const;

export function languageLabel(code: SourceLangSetting): string {
  if (code === 'auto') return 'auto';
  return INTERPRET_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

/** UI 로케일 — Phase 1~3는 ko/en만 완성. ja/zh-CN은 구조만 (docs/06 §4.5) */
export const UI_LOCALES: readonly UiLocale[] = ['ko', 'en', 'ja', 'zh-CN'];
export const ACTIVE_UI_LOCALES: readonly UiLocale[] = ['ko', 'en'];
export const DEFAULT_UI_LOCALE: UiLocale = 'ko';

/** 세그먼트 배치 저장 규칙 (docs/08 §1): 10건 또는 5초 중 먼저 도달하는 쪽 */
export const SEGMENT_BATCH_MAX_COUNT = 10;
export const SEGMENT_BATCH_MAX_MS = 5_000;

/** 하트비트 주기 (docs/01 §4.1) — 10초. 3회 유실 시 orphaned */
export const HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_MISS_LIMIT = 3;

/** 번역 오디오 재생 큐 상한 (docs/04 §3) — 넘으면 오래된 것을 버린다 */
export const MAX_AUDIO_QUEUE_MS = 2_500;

export * from './plans';
