import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Mic, Link2, Inbox } from 'lucide-react';
import { Link } from '@/i18n/navigation';

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('dashboard');

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">{t('title')}</h1>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* 모드 B — 대면. 이 화면의 목적은 3초 안에 통역을 시작시키는 것 (docs/06 §2.1) */}
        <Link
          href="/live"
          className="group flex flex-col gap-3 rounded-lg border border-border bg-bg-raised p-6 transition-colors duration-150 hover:border-border-strong"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-weak text-accent">
            <Mic size={22} aria-hidden />
          </span>
          <div>
            <div className="text-[20px] font-semibold">{t('startInPerson.title')}</div>
            <div className="text-sm text-text-muted">{t('startInPerson.subtitle')}</div>
          </div>
        </Link>

        {/* 모드 A — 화상회의 (Phase 4 준비) */}
        <Link
          href="/meeting"
          className="group flex flex-col gap-3 rounded-lg border border-border bg-bg-raised p-6 transition-colors duration-150 hover:border-border-strong"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-bg-sunken text-text-muted">
            <Link2 size={22} aria-hidden />
          </span>
          <div>
            <div className="text-[20px] font-semibold">{t('startMeeting.title')}</div>
            <div className="text-sm text-text-muted">{t('startMeeting.subtitle')}</div>
          </div>
        </Link>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          {t('recent.title')}
        </h2>
        {/* 빈 상태는 다음 행동을 안내한다 (core.md §6) */}
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-bg-raised px-6 py-12 text-center">
          <Inbox size={28} aria-hidden className="text-text-faint" />
          <div className="font-semibold">{t('recent.emptyTitle')}</div>
          <p className="max-w-md text-sm text-text-muted">{t('recent.emptyHint')}</p>
        </div>
      </section>
    </div>
  );
}
