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
} from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';

/**
 * InterLive 시안의 좌측 다크 사이드바 — 테마와 무관하게 항상 딥 네이비.
 * 준비 안 된 메뉴는 숨기지 않고 '준비 중'으로 표시한다 (빈 상태가 다음을 안내 — core.md §6).
 */
export function AppSidebar() {
  const t = useTranslations('common');
  const pathname = usePathname();

  const items = [
    { href: '/dashboard', icon: LayoutDashboard, label: t('nav.dashboard'), ready: true },
    { href: '/live', icon: Mic, label: t('nav.live'), ready: true },
    { href: '/meeting', icon: Video, label: t('nav.meeting'), ready: true },
    { href: '/sessions', icon: ScrollText, label: t('nav.sessions'), ready: false },
    { href: '/#pricing', icon: CreditCard, label: t('nav.pricing'), ready: true },
    { href: '/settings', icon: Settings, label: t('nav.settings'), ready: false },
    { href: '/help', icon: HelpCircle, label: t('nav.help'), ready: false },
  ] as const;

  return (
    <aside className="hidden w-56 shrink-0 flex-col bg-caption-bg md:flex">
      <Link
        href="/"
        className="flex h-14 items-center gap-2 px-5 font-bold tracking-tight text-caption-target"
      >
        <span
          aria-hidden
          className="cta-orb-violet inline-flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold text-white"
        >
          IL
        </span>
        {t('appName')}
      </Link>
      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-3">
        {items.map((item) => {
          const active = item.ready && pathname.startsWith(item.href) && item.href !== '/#pricing';
          const Icon = item.icon;
          if (!item.ready) {
            return (
              <span
                key={item.href}
                className="flex h-10 cursor-default items-center gap-3 rounded-md px-3 text-sm text-caption-source/60"
              >
                <Icon size={16} aria-hidden />
                {item.label}
                <span className="ml-auto text-[10px]">{t('nav.soon')}</span>
              </span>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors duration-150 ${
                active
                  ? 'bg-white/10 font-semibold text-caption-target'
                  : 'text-caption-source hover:text-caption-target'
              }`}
            >
              <Icon size={16} aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
