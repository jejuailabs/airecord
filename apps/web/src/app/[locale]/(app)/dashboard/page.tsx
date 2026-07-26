import { cookies } from 'next/headers';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Mic, Link2, Inbox } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { SESSION_COOKIE_NAME, adminDb, verifySessionCookie } from '@/lib/firebase/admin';
import { getPlan } from '@sotong/shared/constants';

interface DashData {
  includedMinutes: number;
  usedMinutes: number;
  meetingMinutes: number;
  inpersonMinutes: number;
}

/** 워크스페이스 실데이터 — 실패 시 Free 기본값 (에러가 대시보드를 막으면 안 된다) */
async function loadData(): Promise<DashData> {
  const fallback: DashData = {
    includedMinutes: getPlan('free')?.includedMinutes ?? 30,
    usedMinutes: 0,
    meetingMinutes: 0,
    inpersonMinutes: 0,
  };
  try {
    const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    const user = await verifySessionCookie(cookie);
    if (!user) return fallback;
    const userSnap = await adminDb().collection('users').doc(user.uid).get();
    const wsId = userSnap.get('lastWorkspaceId') as string | undefined;
    if (!wsId) return fallback;
    const ws = await adminDb().collection('workspaces').doc(wsId).get();
    const billing = ws.get('billing') as
      | { includedMinutes?: number; usedMinutes?: number }
      | undefined;
    return {
      includedMinutes: billing?.includedMinutes ?? fallback.includedMinutes,
      usedMinutes: billing?.usedMinutes ?? 0,
      meetingMinutes: 0, // Phase 4: usage.minutesByMode.meeting
      inpersonMinutes: billing?.usedMinutes ?? 0,
    };
  } catch {
    return fallback;
  }
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('dashboard');
  const data = await loadData();
  const remaining = Math.max(0, data.includedMinutes - data.usedMinutes);
  const pct = data.includedMinutes > 0 ? (remaining / data.includedMinutes) * 100 : 0;
  const barColor = pct <= 0 ? 'bg-danger' : pct < 20 ? 'bg-warn' : 'bg-accent';

  return (
    <div className="flex flex-col gap-6">
      {/* ── 통계 카드 4 (시안) ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg-raised p-5">
          <span className="text-xs font-semibold text-text-muted">{t('stats.remaining')}</span>
          <span className="tabular text-[26px] font-bold leading-none">
            {remaining}
            <span className="text-sm font-normal text-text-muted">
              {t('stats.minuteOf', { total: data.includedMinutes })}
            </span>
          </span>
          <div className="h-1.5 overflow-hidden rounded-full bg-bg-sunken">
            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <StatCard label={t('stats.month')} value={data.usedMinutes} unit={t('stats.minute')} />
        <StatCard label={t('stats.meeting')} value={data.meetingMinutes} unit={t('stats.minute')} />
        <StatCard label={t('stats.inperson')} value={data.inpersonMinutes} unit={t('stats.minute')} />
      </div>

      {/* ── 시작 카드 2 ── */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/live"
          className="flex items-center gap-4 rounded-lg border border-border bg-bg-raised p-5 transition-colors duration-150 hover:border-accent"
        >
          <span className="cta-orb-violet flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white">
            <Mic size={20} aria-hidden />
          </span>
          <div>
            <div className="font-semibold">{t('startInPerson.title')}</div>
            <div className="text-sm text-text-muted">{t('startInPerson.subtitle')}</div>
          </div>
        </Link>
        <Link
          href="/meeting"
          className="flex items-center gap-4 rounded-lg border border-border bg-bg-raised p-5 transition-colors duration-150 hover:border-accent-2"
        >
          <span className="cta-orb-teal flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white">
            <Link2 size={20} aria-hidden />
          </span>
          <div>
            <div className="font-semibold">{t('startMeeting.title')}</div>
            <div className="text-sm text-text-muted">{t('startMeeting.subtitle')}</div>
          </div>
        </Link>
      </div>

      {/* ── 일별 사용량 (시안 차트 — 데이터가 쌓이면 채워진다) ── */}
      <section className="flex flex-col gap-4 rounded-lg border border-border bg-bg-raised p-5">
        <div className="flex items-center gap-4">
          <h2 className="text-sm font-semibold">{t('chart.title')}</h2>
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-text-muted">
            <span aria-hidden className="h-2 w-2 rounded-full bg-chart-1" />
            {t('chart.legendMeeting')}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <span aria-hidden className="h-2 w-2 rounded-full bg-chart-2" />
            {t('chart.legendInPerson')}
          </span>
        </div>
        <div className="flex h-28 items-end gap-2">
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="flex flex-1 items-end gap-0.5">
              <div className="w-1/2 rounded-t-sm bg-chart-1/25" style={{ height: '6px' }} />
              <div className="w-1/2 rounded-t-sm bg-chart-2/25" style={{ height: '6px' }} />
            </div>
          ))}
        </div>
        <p className="text-[13px] text-text-faint">{t('chart.empty')}</p>
      </section>

      {/* ── 최근 세션 ── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center">
          <h2 className="text-sm font-semibold">{t('recent.title')}</h2>
          <span className="ml-auto text-[13px] text-text-faint">{t('recent.viewAll')}</span>
        </div>
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-bg-raised px-6 py-10 text-center">
          <Inbox size={26} aria-hidden className="text-text-faint" />
          <div className="font-semibold">{t('recent.emptyTitle')}</div>
          <p className="max-w-md text-sm text-text-muted">{t('recent.emptyHint')}</p>
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg-raised p-5">
      <span className="text-xs font-semibold text-text-muted">{label}</span>
      <span className="tabular text-[26px] font-bold leading-none">
        {value}
        <span className="text-sm font-normal text-text-muted">{unit}</span>
      </span>
    </div>
  );
}
