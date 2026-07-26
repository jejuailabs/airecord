'use client';

import { useTranslations } from 'next-intl';
import {
  LayoutDashboard,
  Mic,
  Video,
  ScrollText,
  CreditCard,
  Settings,
  HelpCircle,
  ChevronDown,
  Type,
} from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { SidebarLink } from './SidebarLink';

export interface SidebarUsage {
  usedMinutes: number;
  includedMinutes: number;
}

export interface SidebarAccount {
  name: string;
  role: string;
}

/**
 * 좌측 사이드바 — 테마와 무관하게 항상 딥 네이비(시안).
 * 하단에 사용량 카드와 계정 카드를 둔다.
 * 준비 안 된 메뉴는 숨기지 않고 '준비 중'으로 표시한다 (core.md §6).
 */
export function AppSidebar({ usage, account }: { usage?: SidebarUsage; account?: SidebarAccount }) {
  const t = useTranslations('common');
  const pathname = usePathname();

  const items = [
    { href: '/dashboard', icon: LayoutDashboard, label: t('nav.dashboard'), ready: true },
    { href: '/live', icon: Mic, label: t('nav.live'), ready: true },
    { href: '/meeting', icon: Video, label: t('nav.meeting'), ready: true },
    { href: '/translate', icon: Type, label: t('nav.translate'), ready: true },
    { href: '/sessions', icon: ScrollText, label: t('nav.sessions'), ready: true },
    { href: '/#pricing', icon: CreditCard, label: t('nav.pricing'), ready: true },
    { href: '/settings', icon: Settings, label: t('nav.settings'), ready: false },
    { href: '/help', icon: HelpCircle, label: t('nav.help'), ready: false },
  ] as const;

  const used = usage?.usedMinutes ?? 0;
  const total = usage?.includedMinutes ?? 0;
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const remaining = Math.max(0, total - used);

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-white/5 bg-caption-bg lg:flex xl:w-72">
      <Link
        href="/"
        className="flex h-[72px] items-center gap-2.5 px-6 text-[19px] font-bold tracking-tight text-caption-target"
      >
        <span
          aria-hidden
          className="cta-orb-violet inline-flex h-8 w-8 items-center justify-center rounded-lg text-[13px] font-bold text-white"
        >
          IL
        </span>
        {t('appName')}
      </Link>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
        {items.map((item) => {
          const active =
            item.ready && item.href !== '/#pricing' && pathname.startsWith(item.href);
          const Icon = item.icon;
          if (!item.ready) {
            return (
              <span
                key={item.href}
                className="flex h-12 cursor-default items-center gap-3 rounded-lg px-3.5 text-[15px] text-caption-source/45"
              >
                <Icon size={19} aria-hidden />
                {item.label}
                <span className="ml-auto text-[11px]">{t('nav.soon')}</span>
              </span>
            );
          }
          return (
            <SidebarLink
              key={item.href}
              href={item.href}
              icon={<Icon size={19} />}
              label={item.label}
              active={active}
            />
          );
        })}
      </nav>

      {/* 사용량 카드 */}
      {usage ? (
        <div className="mx-3 mb-3 rounded-xl bg-white/[.05] p-4">
          <p className="text-[12px] text-caption-source">{t('sidebar.monthUsage')}</p>
          <p className="tabular mt-1 text-[22px] font-bold leading-none text-caption-target">
            {used}
            <span className="text-[13px] font-normal text-caption-source">
              {t('sidebar.minuteOf', { total })}
            </span>
          </p>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-2 text-[12px] text-caption-source">
            {t('sidebar.remaining', { minutes: remaining })}
          </p>
        </div>
      ) : null}

      {/* 계정 카드 */}
      {account ? (
        <div className="mx-3 mb-4 flex items-center gap-3 rounded-xl bg-white/[.05] p-3">
          <span
            aria-hidden
            className="cta-orb-violet flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-white"
          >
            {account.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold text-caption-target">
              {account.name}
            </span>
            <span className="block truncate text-[12px] text-caption-source">{account.role}</span>
          </span>
          <ChevronDown size={15} aria-hidden className="shrink-0 text-caption-source" />
        </div>
      ) : null}
    </aside>
  );
}
