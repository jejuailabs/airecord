import { routing, type AppLocale } from './routing';

/**
 * 화면 언어별 표기·SEO 값. 새 로케일을 열 때 여기 한 곳만 채우면
 * 언어 선택 목록·hreflang·OG locale·정적 경로가 같이 따라간다.
 * 언어 이름은 자기 언어로 표기한다 (docs/06 §4.4).
 */
export const LOCALE_META: Record<AppLocale, { label: string; ogLocale: string }> = {
  ko: { label: '한국어', ogLocale: 'ko_KR' },
  en: { label: 'English', ogLocale: 'en_US' },
  es: { label: 'Español', ogLocale: 'es_ES' },
  // 메시지 파일 구조만 있는 로케일 — 라우팅에 열리기 전까지 화면에 나오지 않는다
  ja: { label: '日本語', ogLocale: 'ja_JP' },
  'zh-CN': { label: '中文(简体)', ogLocale: 'zh_CN' },
};

function asAppLocale(locale: string): AppLocale {
  return (routing.locales as readonly string[]).includes(locale)
    ? (locale as AppLocale)
    : routing.defaultLocale;
}

export function ogLocale(locale: string): string {
  return LOCALE_META[asAppLocale(locale)].ogLocale;
}

export function ogAlternateLocales(locale: string): string[] {
  return routing.locales.filter((l) => l !== locale).map((l) => LOCALE_META[l].ogLocale);
}

/** Metadata.alternates — canonical + 모든 로케일 hreflang + x-default(ko) */
export function localeAlternates(locale: string, path = '') {
  return {
    canonical: `/${locale}${path}`,
    languages: {
      ...Object.fromEntries(routing.locales.map((l) => [l, `/${l}${path}`])),
      'x-default': `/${routing.defaultLocale}${path}`,
    },
  };
}

export function localeStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}
