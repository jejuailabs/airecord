'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LogIn, LogOut } from 'lucide-react';
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
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 whitespace-nowrap font-bold tracking-tight"
        >
          <img
            src="/main_logo_tra.png"
            alt="InterLive"
            className="h-9 w-auto max-w-[160px] object-contain"
          />
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
          {/* 좁은 화면에서는 언어 선택을 숨긴다 — 로그인 버튼이 줄바꿈되지 않게 (모바일 폭 우선) */}
          <span className="hidden sm:block">
            <LocaleSwitch />
          </span>
          <ThemeToggle />
          {me === 'loading' ? null : me ? (
            <div className="flex items-center gap-1.5">
              <span className="hidden max-w-[140px] truncate text-xs text-text-muted md:inline">
                {me.email ?? me.name ?? ''}
              </span>
              <button
                onClick={logout}
                title={t('auth.logout')}
                aria-label={t('auth.logout')}
                className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 text-[13px] text-text-muted hover:text-text"
              >
                <LogOut size={14} aria-hidden />
                <span className="hidden sm:inline">{t('auth.logout')}</span>
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-accent-text"
            >
              <LogIn size={14} aria-hidden />
              {t('auth.login')}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
