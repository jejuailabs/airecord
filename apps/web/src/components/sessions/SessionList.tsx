'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { languageLabel } from '@sotong/shared/constants';
import type { SourceLangSetting } from '@sotong/shared/types';
import type { SessionListItem } from '@/lib/server/sessions-query';

const PAGE_SIZE = 10;

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 세션 기록 목록 — 10개씩 페이지네이션 (사용자 지시 2026-08-03).
 * 데이터는 서버가 한 번에 받아 넘겨주므로 여기서는 잘라 보여주기만 한다(추가 조회 없음).
 */
export function SessionList({ items, locale }: { items: SessionListItem[]; locale: string }) {
  const t = useTranslations('sessions');
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const shown = items.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {shown.map((s) => (
          <li key={s.id}>
            <Link
              href={`/sessions/${s.id}`}
              className="flex items-center gap-4 rounded-lg border border-border bg-bg-raised px-5 py-4 transition-colors duration-150 hover:border-accent"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[17px] font-semibold">{s.title ?? t('untitled')}</div>
                <div className="mt-0.5 text-sm text-text-muted">
                  {languageLabel(s.sourceLang as SourceLangSetting)} →{' '}
                  {languageLabel(s.targetLang as SourceLangSetting)}
                  {' · '}
                  {t('segments', { count: s.segmentCount })}
                </div>
              </div>
              <span className="tabular flex shrink-0 items-center gap-1.5 text-sm text-text-muted">
                <Clock size={14} aria-hidden />
                {fmtDuration(s.billedSeconds)}
              </span>
              <span className="tabular hidden shrink-0 text-sm text-text-faint sm:block">
                {s.startedAtMs
                  ? new Intl.DateTimeFormat(locale, {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }).format(new Date(s.startedAtMs))
                  : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {pageCount > 1 ? (
        <div className="flex items-center justify-center gap-1.5">
          <button
            type="button"
            onClick={() => setPage(current - 1)}
            disabled={current === 0}
            aria-label={t('prevPage')}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-text-muted disabled:opacity-40 hover:enabled:border-accent hover:enabled:text-accent"
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
          {Array.from({ length: pageCount }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setPage(i)}
              aria-current={i === current ? 'page' : undefined}
              className={`tabular h-9 min-w-9 rounded-md px-2 text-sm font-semibold ${
                i === current
                  ? 'bg-accent text-accent-text'
                  : 'border border-border text-text-muted hover:border-accent hover:text-accent'
              }`}
            >
              {i + 1}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPage(current + 1)}
            disabled={current >= pageCount - 1}
            aria-label={t('nextPage')}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-text-muted disabled:opacity-40 hover:enabled:border-accent hover:enabled:text-accent"
          >
            <ChevronRight size={16} aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}
