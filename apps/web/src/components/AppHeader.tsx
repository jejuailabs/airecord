'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { ThemeToggle } from './ThemeToggle';
import { LocaleSwitch } from './LocaleSwitch';

export function AppHeader() {
  const t = useTranslations('common');
  const pathname = usePathname();

  const nav = [
    { href: '/dashboard', label: t('nav.dashboard') },
    { href: '/live', label: t('nav.live') },
    { href: '/meeting', label: t('nav.meeting') },
  ] as const;

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-4 px-4">
        <Link href="/dashboard" className="flex items-center gap-2 font-bold tracking-tight">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-accent" />
          {t('appName')}
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {nav.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-1.5 transition-colors duration-150 ${
                  active
                    ? 'bg-bg-sunken font-semibold text-text'
                    : 'text-text-muted hover:text-text'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden rounded-sm border border-border px-2 py-0.5 text-[11px] text-text-faint md:inline">
            {t('phaseBadge')}
          </span>
          <LocaleSwitch />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
