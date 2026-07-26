'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bell, LogOut } from 'lucide-react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { firebaseAuth } from '@/lib/firebase/client';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LocaleSwitch } from '@/components/LocaleSwitch';

/** 시안 상단 바: "관리 · {현재 화면}" + 알림 + 계정 */
export function AppTopbar() {
  const t = useTranslations('common');
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((j: { user: { email: string | null } | null }) => {
        if (alive) setEmail(j.user?.email ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const section = pathname.startsWith('/live')
    ? t('nav.live')
    : pathname.startsWith('/meeting')
      ? t('nav.meeting')
      : pathname.startsWith('/checkout')
        ? t('nav.pricing')
        : t('nav.dashboard');

  const logout = async () => {
    await fetch('/api/auth/session', { method: 'DELETE' });
    try {
      await firebaseAuth().signOut();
    } catch {
      /* noop */
    }
    router.push('/');
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-10 flex h-20 items-center gap-3 border-b border-border bg-bg/90 px-5 backdrop-blur md:px-8">
      {/* 모바일: 사이드바 대신 브랜드 표시 */}
      <Link href="/" className="flex items-center gap-2 font-bold lg:hidden">
        <span
          aria-hidden
          className="cta-orb-violet inline-flex h-8 w-8 items-center justify-center rounded-md text-[13px] font-bold text-white"
        >
          IL
        </span>
      </Link>
      <span className="text-[19px] font-semibold">
        <span className="text-text-muted">{t('shell.manage')}</span>
        <span className="mx-2 text-text-faint">·</span>
        {section}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <LocaleSwitch />
        <ThemeToggle />
        <span aria-hidden className="hidden h-5 w-px bg-border sm:block" />
        <Bell size={15} aria-hidden className="hidden text-text-faint sm:block" />
        <span className="hidden max-w-[140px] truncate text-xs text-text-muted lg:inline">
          {email ?? ''}
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
    </header>
  );
}
