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
  ShieldCheck,
  ChevronDown,
  Type,
  FileText,
  FolderOpen,
  Radio,
  UsersRound,
} from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { SidebarLink } from './SidebarLink';

export interface SidebarUsage {
  usedMinutes: number;
  includedMinutes: number;
  /** 운영자 계정 — 한도 없음 */
  unlimited?: boolean;
  /** 무료 플랜처럼 사용량이 매일 초기화되는 경우 — 문구를 '오늘'로 바꾼다 */
  daily?: boolean;
}

export interface SidebarAccount {
  name: string;
  role: string;
}

interface ShellProps {
  usage?: SidebarUsage;
  account?: SidebarAccount;
  /** 운영자에게만 콘솔 진입점을 그린다 — 일반 유저에게는 메뉴 자체가 없다 */
  isAdmin?: boolean;
}

/**
 * 사이드바 알맹이 — 브랜드 + 메뉴 + 사용량/계정 카드.
 * 데스크톱 `<aside>`(AppSidebar)와 모바일 드로어(MobileNav)가 **같은 것**을 렌더한다.
 * 두 벌로 두면 한쪽만 고쳐졌을 때 메뉴가 어긋난다.
 */
export function SidebarBody({
  usage,
  account,
  isAdmin = false,
  onNavigate,
}: ShellProps & { onNavigate?: () => void }) {
  const t = useTranslations('common');
  const pathname = usePathname();

  const items = [
    { href: '/dashboard', icon: LayoutDashboard, label: t('nav.dashboard'), ready: true },
    { href: '/live', icon: Mic, label: t('nav.live'), ready: true },
    { href: '/talk', icon: Radio, label: t('nav.talk'), ready: true },
    { href: '/faceoff', icon: UsersRound, label: t('nav.faceoff'), ready: true },
    { href: '/meeting', icon: Video, label: t('nav.meeting'), ready: true },
    { href: '/translate', icon: Type, label: t('nav.translate'), ready: true },
    { href: '/translate/file', icon: FileText, label: t('nav.translateFile'), ready: true },
    { href: '/sessions', icon: ScrollText, label: t('nav.sessions'), ready: true },
    { href: '/mypage', icon: FolderOpen, label: t('nav.mypage'), ready: true },
    { href: '/pricing', icon: CreditCard, label: t('nav.pricing'), ready: true },
    { href: '/settings', icon: Settings, label: t('nav.settings'), ready: true },
    { href: '/help', icon: HelpCircle, label: t('nav.help'), ready: false },
    // 운영 콘솔은 관리자에게만. '준비 중'으로도 노출하지 않는다 (존재를 알리지 않는다)
    ...(isAdmin
      ? [{ href: '/admin', icon: ShieldCheck, label: '운영 콘솔', ready: true }]
      : []),
  ] as const;

  const used = usage?.usedMinutes ?? 0;
  const total = usage?.includedMinutes ?? 0;
  // 초과 사용한 경우에도 막대가 100%를 넘지 않게 한다
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const remaining = Math.max(0, total - used);

  return (
    <>
      <Link
        href="/"
        onClick={onNavigate}
        className="flex h-[88px] items-center px-5"
      >
        {/* 사이드바 배경(--caption-bg)은 테마와 무관하게 항상 딥 네이비 → 밝은 글자 버전 고정.
            아이콘 폭을 워드마크 폭에 맞춘 세로 락업이라 세로가 길다. 행 높이를 88px로 잡아야
            로고가 위아래로 눌리지 않는다 */}
        <img
          src="/logo-interlive-v-dark.png"
          alt="InterLive"
          className="h-[68px] w-auto max-w-full object-contain"
        />
      </Link>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
        {items.map((item) => {
          /**
           * ⚠ startsWith만 쓰면 안 된다 — '/translate/file'은 '/translate'로도 시작하므로
           *   파일 번역 페이지에서 텍스트 번역까지 같이 활성화됐다.
           *   정확히 일치하거나, 그 아래 경로('/x/…')일 때만 켠다.
           *   단 더 구체적인 형제 항목이 있으면 그쪽에 양보한다(파일 번역이 텍스트 번역을 이긴다).
           */
          const isUnder = pathname === item.href || pathname.startsWith(item.href + '/');
          const moreSpecific = items.some(
            (o) =>
              o !== item &&
              o.ready &&
              o.href.startsWith(item.href + '/') &&
              (pathname === o.href || pathname.startsWith(o.href + '/')),
          );
          const active = item.ready && isUnder && !moreSpecific;
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
              onNavigate={onNavigate}
            />
          );
        })}
      </nav>

      {/* 사용량 카드 */}
      {usage ? (
        <div className="mx-3 mb-3 rounded-xl bg-white/[.05] p-4">
          <p className="text-[12px] text-caption-source">
            {t(usage.daily ? 'sidebar.dayUsage' : 'sidebar.monthUsage')}
          </p>
          {usage.unlimited ? (
            <>
              <p className="tabular mt-1 text-[22px] font-bold leading-none text-caption-target">
                {used}
                <span className="text-[13px] font-normal text-caption-source">
                  {t('sidebar.minute')}
                </span>
              </p>
              <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-accent/20 px-2 py-0.5 text-[12px] font-semibold text-accent">
                {t('sidebar.unlimited')}
              </p>
            </>
          ) : (
            <>
              <p className="tabular mt-1 text-[22px] font-bold leading-none text-caption-target">
                {Math.min(used, total)}
                <span className="text-[13px] font-normal text-caption-source">
                  {t('sidebar.minuteOf', { total })}
                </span>
              </p>
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ${
                    remaining === 0 ? 'bg-danger' : 'bg-accent'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p
                className={`mt-2 text-[12px] ${remaining === 0 ? 'font-semibold text-danger' : 'text-caption-source'}`}
              >
                {remaining === 0
                  ? t(usage.daily ? 'sidebar.exhaustedDay' : 'sidebar.exhausted')
                  : t('sidebar.remaining', { minutes: remaining })}
              </p>
            </>
          )}
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
    </>
  );
}

/**
 * 좌측 사이드바 (데스크톱) — 테마와 무관하게 항상 딥 네이비(시안).
 * 좁은 화면에서는 숨고, 대신 상단바의 햄버거(MobileNav)가 같은 알맹이를 드로어로 연다.
 */
export function AppSidebar({ usage, account, isAdmin = false }: ShellProps) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-white/5 bg-caption-bg lg:flex xl:w-72">
      <SidebarBody usage={usage} account={account} isAdmin={isAdmin} />
    </aside>
  );
}
