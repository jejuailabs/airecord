import { cookies } from 'next/headers';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Mic, Link2, Inbox, Clock, ChevronRight, Type, FileText, Radio, UsersRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { getEntitlement } from '@/lib/server/entitlement';
import { listSessions, type SessionListItem } from '@/lib/server/sessions-query';
import { getPlan, cycleKey, languageLabel } from '@sotong/shared/constants';
import type { SourceLangSetting } from '@sotong/shared/types';
import { ActionCard } from '@/components/ui/ActionCard';

interface DashData {
  includedMinutes: number;
  usedMinutes: number;
  /** 운영자 — 한도 없음 */
  unlimited: boolean;
  /** 사용량이 매일 초기화되는 플랜인가 (무료) */
  dailyCycle: boolean;
  meetingMinutes: number;
  inpersonMinutes: number;
  sessions: SessionListItem[];
  /** 최근 14일 일별 사용량 (분) */
  daily: Array<{ date: string; meeting: number; inperson: number }>;
}

/** 세션 목록에서 최근 14일 막대를 만든다 — 별도 집계 배치 없이 실데이터로 그린다 */
function buildDaily(sessions: SessionListItem[]): DashData['daily'] {
  const days: DashData['daily'] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    days.push({ date: d.toISOString().slice(0, 10), meeting: 0, inperson: 0 });
  }
  for (const s of sessions) {
    if (!s.startedAtMs) continue;
    const key = new Date(s.startedAtMs).toISOString().slice(0, 10);
    const bucket = days.find((d) => d.date === key);
    if (!bucket) continue;
    const minutes = Math.ceil(s.billedSeconds / 60);
    if (s.mode === 'meeting') bucket.meeting += minutes;
    else bucket.inperson += minutes;
  }
  return days;
}

/** 워크스페이스 + 최근 세션 — 실패해도 대시보드는 뜬다 */
async function loadData(): Promise<DashData> {
  const free = getPlan('free');
  const fallback: DashData = {
    includedMinutes: free?.includedMinutes ?? 10,
    usedMinutes: 0,
    unlimited: false,
    dailyCycle: (free?.cycle ?? 'daily') === 'daily',
    meetingMinutes: 0,
    inpersonMinutes: 0,
    sessions: [],
    daily: buildDaily([]),
  };
  try {
    const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    const user = await verifySessionCookie(cookie);
    if (!user) return fallback;

    /**
     * 세션 목록과 사용 권한은 서로 의존하지 않는다 — 나란히 읽는다.
     * 순서대로 기다리면 Firestore 왕복이 그대로 더해져 화면이 늦게 뜬다.
     *
     * 사용량은 반드시 entitlement를 거친다. Firestore billing을 직접 읽으면
     * 주기 갱신(무료=매일 초기화)과 운영자 무제한이 빠져 사이드바와 숫자가 어긋난다.
     * (레이아웃이 이미 부른 경우 React cache 덕에 왕복은 한 번뿐이다)
     */
    const [sessions, ent] = await Promise.all([
      listSessions(user.uid, 20),
      getEntitlement(user.uid, user.email),
    ]);
    /**
     * ⚠ mode별 분은 "이번 주기"로만 센다.
     *   예전엔 전체 세션을 합산해서, 무료가 매일 0으로 리셋되는 "오늘 사용량 0분" 옆에
     *   전체 누적인 "대면 67분"이 나란히 떠 서로 다른 걸 세는 것처럼 보였다.
     *   같은 주기(무료=오늘, 유료=이번 달)로 맞추면 두 숫자가 한 축에서 맞물린다.
     */
    const cycle = getPlan(ent.plan)?.cycle ?? 'daily';
    const nowKey = cycleKey(cycle);
    const inCycle = (ms?: number | null) => {
      if (!ms) return false;
      const iso = new Date(ms).toISOString();
      return cycle === 'daily' ? iso.slice(0, 10) === nowKey : iso.slice(0, 7) === nowKey;
    };
    const minutesOf = (mode: 'meeting' | 'inperson') =>
      sessions
        .filter((s) => (mode === 'meeting' ? s.mode === 'meeting' : s.mode !== 'meeting'))
        .filter((s) => inCycle(s.startedAtMs))
        .reduce((sum, s) => sum + Math.ceil(s.billedSeconds / 60), 0);

    return {
      includedMinutes: ent.includedMinutes,
      usedMinutes: ent.usedMinutes,
      unlimited: ent.isAdmin || ent.unlimited,
      dailyCycle: getPlan(ent.plan)?.cycle === 'daily',
      meetingMinutes: minutesOf('meeting'),
      inpersonMinutes: minutesOf('inperson'),
      sessions: sessions.slice(0, 5),
      daily: buildDaily(sessions),
    };
  } catch {
    return fallback;
  }
}

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('dashboard');
  const ts = await getTranslations('sessions');
  const data = await loadData();
  const remaining = Math.max(0, data.includedMinutes - data.usedMinutes);
  const pct = data.includedMinutes > 0 ? (remaining / data.includedMinutes) * 100 : 0;
  const barColor = pct <= 0 ? 'bg-danger' : pct < 20 ? 'bg-warn' : 'bg-accent';

  return (
    <div className="flex flex-col gap-8">
      {/* ── 시작 카드 — 화면의 주인공 ── */}
      <section className="flex flex-col items-center gap-6 pt-2">
        <h1 className="text-[28px] font-bold tracking-tight">{t('title')}</h1>
        <div className="flex w-full max-w-4xl flex-col gap-3 sm:gap-4">
          {/* 통역 4종 — 좁은 화면 2×2, 넓은 화면 한 줄 4칸 */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            <ActionCard
              href="/live"
              tone="teal"
              compact
              icon={<Mic size={30} />}
              title={t('startInPerson.title')}
              subtitle={t('startInPerson.subtitle')}
            />
            <ActionCard
              href="/talk"
              tone="teal"
              compact
              icon={<Radio size={30} />}
              title={t('startTalk.title')}
              subtitle={t('startTalk.subtitle')}
            />
            <ActionCard
              href="/faceoff"
              tone="gold"
              compact
              badge={t('startFaceoff.badge')}
              icon={<UsersRound size={30} />}
              title={t('startFaceoff.title')}
              subtitle={t('startFaceoff.subtitle')}
            />
            <ActionCard
              href="/meeting"
              tone="violet"
              compact
              icon={<Link2 size={30} />}
              title={t('startMeeting.title')}
              subtitle={t('startMeeting.subtitle')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <ActionCard
              href="/translate"
              tone="violet"
              compact
              icon={<Type size={30} />}
              title={t('startText.title')}
              subtitle={t('startText.subtitle')}
            />
            <ActionCard
              href="/translate/file"
              tone="teal"
              compact
              icon={<FileText size={30} />}
              title={t('startFile.title')}
              subtitle={t('startFile.subtitle')}
            />
          </div>
        </div>
      </section>

      {/* ── 통계 카드 4 ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-bg-raised p-5">
          <span className="text-[13px] font-semibold text-text-muted">{t('stats.remaining')}</span>
          {data.unlimited ? (
            <>
              <span className="tabular text-[26px] font-bold leading-none">∞</span>
              <span className="inline-flex w-fit items-center rounded-md bg-accent-weak px-2 py-0.5 text-[12px] font-semibold text-accent">
                {t('stats.unlimited')}
              </span>
            </>
          ) : (
            <>
              <span className="tabular text-[26px] font-bold leading-none">
                {remaining}
                <span className="text-sm font-normal text-text-muted">
                  {' '}
                  {t('stats.tokenOf', { total: data.includedMinutes })}
                </span>
              </span>
              <div className="h-1.5 overflow-hidden rounded-full bg-bg-sunken">
                <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
              </div>
            </>
          )}
        </div>
        <StatCard
          label={t(data.dailyCycle ? 'stats.day' : 'stats.month')}
          value={data.usedMinutes}
          unit={t('stats.token')}
        />
        <StatCard label={t('stats.meeting')} value={data.meetingMinutes} unit={t('stats.minute')} />
        <StatCard
          label={t('stats.inperson')}
          value={data.inpersonMinutes}
          unit={t('stats.minute')}
        />
      </div>

      {/* ── 일별 사용량 — 세션 실데이터로 그린다 ── */}
      <section className="flex flex-col gap-4 rounded-xl border border-border bg-bg-raised p-5">
        <div className="flex items-center gap-4">
          <h2 className="text-[15px] font-semibold">{t('chart.title')}</h2>
          <span className="ml-auto flex items-center gap-1.5 text-[12px] text-text-muted">
            <span aria-hidden className="h-2 w-2 rounded-full bg-chart-1" />
            {t('chart.legendMeeting')}
          </span>
          <span className="flex items-center gap-1.5 text-[12px] text-text-muted">
            <span aria-hidden className="h-2 w-2 rounded-full bg-chart-2" />
            {t('chart.legendInPerson')}
          </span>
        </div>
        {(() => {
          const max = Math.max(1, ...data.daily.map((d) => d.meeting + d.inperson));
          const hasData = data.daily.some((d) => d.meeting + d.inperson > 0);
          return (
            <>
              <div className="flex h-28 items-end gap-2">
                {data.daily.map((d) => (
                  <div
                    key={d.date}
                    className="flex flex-1 items-end justify-center gap-0.5"
                    title={`${d.date} · ${d.meeting + d.inperson}${t('stats.minute')}`}
                  >
                    <span
                      className="w-1/2 rounded-t-sm bg-chart-1 transition-[height] duration-300"
                      style={{ height: `${Math.max(4, (d.meeting / max) * 100)}%` }}
                    />
                    <span
                      className="w-1/2 rounded-t-sm bg-chart-2 transition-[height] duration-300"
                      style={{ height: `${Math.max(4, (d.inperson / max) * 100)}%` }}
                    />
                  </div>
                ))}
              </div>
              {!hasData ? (
                <p className="text-[13px] text-text-faint">{t('chart.empty')}</p>
              ) : null}
            </>
          );
        })()}
      </section>

      {/* ── 최근 세션 ── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center">
          <h2 className="text-[17px] font-semibold">{t('recent.title')}</h2>
          <Link
            href="/sessions"
            className="ml-auto flex items-center gap-0.5 text-[14px] text-text-muted hover:text-text"
          >
            {t('recent.viewAll')}
            <ChevronRight size={14} aria-hidden />
          </Link>
        </div>

        {data.sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-bg-raised px-6 py-12 text-center">
            <Inbox size={26} aria-hidden className="text-text-faint" />
            <div className="font-semibold">{t('recent.emptyTitle')}</div>
            <p className="max-w-md text-sm text-text-muted">{t('recent.emptyHint')}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.sessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/sessions/${s.id}`}
                  className="flex items-center gap-4 rounded-xl border border-border bg-bg-raised px-5 py-4 transition-colors duration-150 hover:border-accent"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[16px] font-semibold">
                      {s.title ?? ts('untitled')}
                    </div>
                    <div className="mt-0.5 text-[13.5px] text-text-muted">
                      {languageLabel(s.sourceLang as SourceLangSetting)} →{' '}
                      {languageLabel(s.targetLang as SourceLangSetting)}
                      {' · '}
                      {ts('segments', { count: s.segmentCount })}
                    </div>
                  </div>
                  <span className="tabular flex shrink-0 items-center gap-1.5 text-[14px] text-text-muted">
                    <Clock size={14} aria-hidden />
                    {fmtDuration(s.billedSeconds)}
                  </span>
                  <span className="tabular hidden shrink-0 text-[13px] text-text-faint sm:block">
                    {s.startedAtMs
                      ? new Intl.DateTimeFormat(locale, {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        }).format(new Date(s.startedAtMs))
                      : ''}
                  </span>
                  <ChevronRight size={16} aria-hidden className="shrink-0 text-text-faint" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-bg-raised p-5">
      <span className="text-[13px] font-semibold text-text-muted">{label}</span>
      <span className="tabular text-[26px] font-bold leading-none">
        {value}
        <span className="text-sm font-normal text-text-muted">{unit}</span>
      </span>
    </div>
  );
}
