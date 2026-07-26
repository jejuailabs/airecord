import { defineRouting } from 'next-intl/routing';
import { ACTIVE_UI_LOCALES, DEFAULT_UI_LOCALE } from '@sotong/shared/constants';

/**
 * Phase 1~3는 ko/en만 완성한다. ja/zh-CN은 메시지 파일 구조만 있고
 * 여기(라우팅)에 노출하지 않는다 (docs/06 §4.5).
 * 기본 로케일도 접두사 표기 — 링크 공유 시 혼란 방지 (docs/06 §4.2).
 */
export const routing = defineRouting({
  locales: [...ACTIVE_UI_LOCALES],
  defaultLocale: DEFAULT_UI_LOCALE,
  localePrefix: 'always',
});

export type AppLocale = (typeof routing.locales)[number];
