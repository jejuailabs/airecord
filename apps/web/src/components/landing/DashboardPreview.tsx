'use client';

import { useTranslations } from 'next-intl';
import { Bell, LayoutDashboard, Mic, ScrollText, Settings, Users, Video } from 'lucide-react';

/** 시안 차트 막대 높이 (샘플 데이터 연출) */
const BARS: Array<[number, number]> = [
  [38, 22], [55, 30], [30, 46], [62, 24], [44, 38], [70, 30], [52, 58],
];

/** 랜딩 히어로 우측 — InterLive 대시보드 목업 (시안 재현, 항상 다크) */
export function DashboardPreview() {
  const t = useTranslations('landing.preview');

  const sessions = [
    { title: t('rows.r1'), pair: '한국어 → English', meta: t('live'), live: true, time: '12:04' },
    { title: t('rows.r2'), pair: '한국어 → 日本語', meta: '24분', live: false, time: '7/24' },
    { title: t('rows.r3'), pair: '한국어 → English', meta: '45분', live: false, time: '7/23' },
  ];

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-caption-bg shadow-token">
      <div className="flex">
        {/* 미니 사이드바 */}
        <div className="hidden w-36 shrink-0 flex-col gap-1 border-r border-white/5 p-3 sm:flex">
          <span className="mb-2 flex items-center gap-1.5 px-1 text-[12px] font-bold text-caption-target">
            <span aria-hidden className="cta-orb-violet inline-block h-4 w-4 rounded" />
            InterLive
          </span>
          {[
            { icon: LayoutDashboard, label: t('nav.dashboard'), active: true },
            { icon: ScrollText, label: t('nav.sessions'), active: false },
            { icon: Users, label: t('nav.users'), active: false },
            { icon: Mic, label: t('nav.inperson'), active: false },
            { icon: Video, label: t('nav.meeting'), active: false },
            { icon: Settings, label: t('nav.settings'), active: false },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <span
                key={item.label}
                className={`flex items-center gap-2 rounded px-2 py-1.5 text-[11px] ${
                  item.active
                    ? 'bg-white/10 font-semibold text-caption-target'
                    : 'text-caption-source'
                }`}
              >
                <Icon size={11} aria-hidden />
                {item.label}
              </span>
            );
          })}
        </div>

        {/* 본문 */}
        <div className="min-w-0 flex-1 p-4">
          <div className="mb-3 flex items-center text-[12px] font-semibold text-caption-target">
            {t('title')}
            <Bell size={12} aria-hidden className="ml-auto text-caption-source" />
          </div>

          {/* 통계 카드 */}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {[
              { label: t('stats.remaining'), value: '218', unit: t('stats.minute'), sub: '/ 300' },
              { label: t('stats.month'), value: '82', unit: t('stats.minute') },
              { label: t('stats.meeting'), value: '42', unit: t('stats.minute') },
              { label: t('stats.inperson'), value: '40', unit: t('stats.minute') },
            ].map((s) => (
              <div key={s.label} className="rounded-md bg-white/5 p-2.5">
                <div className="text-[10px] text-caption-source">{s.label}</div>
                <div className="tabular mt-0.5 text-[17px] font-bold text-caption-target">
                  {s.value}
                  <span className="text-[10px] font-normal text-caption-source">
                    {s.unit}
                    {'sub' in s && s.sub ? ` ${s.sub}` : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* 일별 사용량 차트 */}
          <div className="mt-2 rounded-md bg-white/5 p-2.5">
            <div className="flex items-center text-[10px] text-caption-source">
              {t('chart')}
              <span className="ml-auto flex items-center gap-1">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-chart-1" />
                {t('stats.meeting')}
              </span>
              <span className="ml-2 flex items-center gap-1">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-chart-2" />
                {t('stats.inperson')}
              </span>
            </div>
            <div className="mt-2 flex h-16 items-end gap-1.5">
              {BARS.map(([a, b], i) => (
                <div key={i} className="flex flex-1 items-end gap-0.5">
                  <div className="w-1/2 rounded-t-sm bg-chart-1" style={{ height: `${a}%` }} />
                  <div className="w-1/2 rounded-t-sm bg-chart-2" style={{ height: `${b}%` }} />
                </div>
              ))}
            </div>
          </div>

          {/* 최근 세션 */}
          <div className="mt-2 rounded-md bg-white/5 p-2.5">
            <div className="flex items-center text-[10px] text-caption-source">
              {t('recent')}
              <span className="ml-auto text-accent">{t('viewAll')}</span>
            </div>
            <div className="mt-1 flex flex-col">
              {sessions.map((s) => (
                <div
                  key={s.title}
                  className="flex items-center gap-2 border-b border-white/5 py-1.5 text-[11px] last:border-0"
                >
                  <span className="truncate font-medium text-caption-target">{s.title}</span>
                  <span className="hidden shrink-0 text-caption-source sm:inline">{s.pair}</span>
                  <span
                    className={`ml-auto shrink-0 ${s.live ? 'font-semibold text-accent' : 'text-caption-source'}`}
                  >
                    {s.meta}
                  </span>
                  <span className="tabular shrink-0 text-caption-source">{s.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
