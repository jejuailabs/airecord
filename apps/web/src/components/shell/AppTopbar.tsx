'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bell, ChevronRight, LogOut } from 'lucide-react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { firebaseAuth } from '@/lib/firebase/client';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { MobileNav } from './MobileNav';
import type { SidebarUsage, SidebarAccount } from './AppSidebar';

/** 시안 상단 바: 모바일 햄버거 + "관리 · {현재 화면}" + 알림 + 계정 */
export function AppTopbar({
  usage,
  account,
  isAdmin,
}: {
  usage?: SidebarUsage;
  account?: SidebarAccount;
  isAdmin?: boolean;
}) {
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
    <header className="sticky top-0 z-10 flex h-[72px] items-center gap-2.5 border-b border-border bg-bg/90 px-4 backdrop-blur md:gap-3 md:px-8">
      {/* 모바일: 햄버거로 사이드바 드로어를 연다 (데스크톱은 사이드바가 상시 노출) */}
      <MobileNav usage={usage} account={account} isAdmin={isAdmin} />
      {/* 모바일: 브랜드 */}
      <Link href="/" className="flex shrink-0 items-center gap-2 font-bold lg:hidden">
        <span
          aria-hidden
          className="cta-orb-violet inline-flex h-8 w-8 items-center justify-center rounded-md text-[13px] font-bold text-white"
        >
          IL
        </span>
      </Link>
      {/* 브레드크럼 — 좁은 화면에서 글자가 세로로 쪼개지지 않게 줄바꿈을 막는다 */}
      <nav
        aria-label="breadcrumb"
        className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[15px]"
      >
        <span className="hidden text-text-muted sm:inline">{t('shell.manage')}</span>
        <ChevronRight size={15} aria-hidden className="hidden shrink-0 text-text-faint sm:block" />
        <span className="truncate font-semibold">{section}</span>
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <span className="hidden sm:block">
          <LocaleSwitch />
        </span>
        <ThemeToggle />
        <span aria-hidden className="hidden h-6 w-px bg-border sm:block" />
        <button
          type="button"
          aria-label={t('shell.notifications')}
          className="relative hidden h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-bg-sunken sm:flex"
        >
          <Bell size={17} aria-hidden />
          <span aria-hidden className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-accent" />
        </button>
        <button
          onClick={logout}
          title={`${email ?? ''} · ${t('auth.logout')}`}
          className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-[13px] text-text-muted hover:text-text"
        >
          <LogOut size={14} aria-hidden />
          <span className="hidden sm:inline">{t('auth.logout')}</span>
        </button>
      </div>
    </header>
  );
}
