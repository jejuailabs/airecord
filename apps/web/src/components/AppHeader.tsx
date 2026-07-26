'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { firebaseAuth } from '@/lib/firebase/client';
import { ThemeToggle } from './ThemeToggle';
import { LocaleSwitch } from './LocaleSwitch';

interface Me {
  uid: string;
  email: string | null;
  name: string | null;
}

export function AppHeader() {
  const t = useTranslations('common');
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null | 'loading'>('loading');

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((j: { user: Me | null }) => {
        if (alive) setMe(j.user);
      })
      .catch(() => {
        if (alive) setMe(null);
      });
    return () => {
      alive = false;
    };
  }, [pathname]);

  const logout = async () => {
    await fetch('/api/auth/session', { method: 'DELETE' });
    try {
      await firebaseAuth().signOut();
    } catch {
      /* noop */
    }
    setMe(null);
    router.push('/');
    router.refresh();
  };

  const nav = [
    { href: '/dashboard', label: t('nav.dashboard') },
    { href: '/live', label: t('nav.live') },
    { href: '/meeting', label: t('nav.meeting') },
  ] as const;

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-accent" />
          {t('appName')}
        </Link>
        <nav className="hidden items-center gap-1 text-sm sm:flex">
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
          <LocaleSwitch />
          <ThemeToggle />
          {me === 'loading' ? null : me ? (
            <div className="flex items-center gap-1.5">
              <span className="hidden max-w-[140px] truncate text-xs text-text-muted md:inline">
                {me.email ?? me.name ?? ''}
              </span>
              <button
                onClick={logout}
                title={t('auth.logout')}
                className="flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs text-text-muted hover:text-text"
              >
                <LogOut size={13} aria-hidden />
                <span className="hidden sm:inline">{t('auth.logout')}</span>
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="flex h-8 items-center rounded-md bg-accent px-3 text-xs font-semibold text-accent-text"
            >
              {t('auth.login')}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
