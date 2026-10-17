'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { LOCALE_META } from '@/i18n/locale-meta';

/** UI 언어 전환 — 통역 언어와 완전히 별개 (docs/06 §4.1). 언어 이름은 자기 언어로. */

export function LocaleSwitch() {
  const t = useTranslations('common.language');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <label className="flex items-center gap-1 text-xs text-text-muted">
      <span className="sr-only">{t('label')}</span>
      <select
        value={locale}
        onChange={(e) => router.replace(pathname, { locale: e.target.value as never })}
        className="h-8 rounded-md border border-border bg-bg-sunken px-2 text-xs text-text"
      >
        {routing.locales.map((l) => (
          <option key={l} value={l}>
            {LOCALE_META[l].label}
          </option>
        ))}
      </select>
    </label>
  );
}
