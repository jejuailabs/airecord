'use client';

import { useTranslations } from 'next-intl';
import { Type, FileText } from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';

/**
 * 텍스트 번역 ↔ 파일 번역 전환.
 * 둘은 같은 일(번역)의 입력 방식만 다른 것이라, 대시보드로 나갔다 들어오게 하지 않는다.
 */
export function TranslateTabs() {
  const t = useTranslations('common.nav');
  const pathname = usePathname();
  const onFile = pathname.startsWith('/translate/file');

  const tabs = [
    { href: '/translate', label: t('translate'), icon: Type, active: !onFile },
    { href: '/translate/file', label: t('translateFile'), icon: FileText, active: onFile },
  ] as const;

  return (
    <div
      role="tablist"
      aria-label={t('translate')}
      className="mx-auto flex h-12 w-full max-w-md items-center gap-1 rounded-xl border border-border p-1.5"
    >
      {tabs.map(({ href, label, icon: Icon, active }) => (
        <Link
          key={href}
          href={href}
          role="tab"
          aria-selected={active}
          className={`flex h-full flex-1 items-center justify-center gap-2 rounded-lg text-[15px] font-semibold transition-colors duration-150 ${
            active ? 'bg-accent-weak text-accent' : 'text-text-muted hover:text-text'
          }`}
        >
          <Icon size={16} aria-hidden />
          {label}
        </Link>
      ))}
    </div>
  );
}
