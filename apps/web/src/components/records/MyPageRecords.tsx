'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Inbox,
  LayoutGrid,
  Loader2,
  Trash2,
  Type,
} from 'lucide-react';
import { languageLabel } from '@sotong/shared/constants';
import type { SourceLangSetting } from '@sotong/shared/types';
import type { TranslationRecord } from '@/lib/server/records';

const PAGE_SIZE = 10;
const DAY_MS = 86_400_000;

const KIND_ICON = {
  layout: LayoutGrid,
  file: FileText,
  text: Type,
} as const;

export function MyPageRecords({
  records,
  locale,
}: {
  records: TranslationRecord[];
  locale: string;
}) {
  const t = useTranslations('mypage');
  const [items, setItems] = useState(records);
  const [page, setPage] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);

  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const shown = items.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const remove = async (id: string) => {
    setDeleting(id);
    try {
      const res = await fetch(`/api/records/${id}`, { method: 'DELETE' });
      if (res.ok) setItems((prev) => prev.filter((r) => r.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-bg-raised px-6 py-16 text-center">
        <Inbox size={30} aria-hidden className="text-text-faint" />
        <div className="text-lg font-semibold">{t('emptyTitle')}</div>
        <p className="max-w-md text-text-muted">{t('emptyHint')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {shown.map((r) => {
          const Icon = KIND_ICON[r.kind] ?? FileText;
          const daysLeft =
            r.expiresAtMs == null ? null : Math.ceil((r.expiresAtMs - Date.now()) / DAY_MS);
          const expired = daysLeft != null && daysLeft <= 0;
          return (
            <li
              key={r.id}
              className="flex items-center gap-4 rounded-xl border border-border bg-bg-raised px-5 py-4"
            >
              <span className="icon-chip icon-chip-accent hidden shrink-0 sm:inline-flex" aria-hidden>
                <Icon size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[16px] font-semibold">{r.title || t('untitled')}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-text-muted">
                  <span>{t(`kind.${r.kind}`)}</span>
                  <span aria-hidden>·</span>
                  <span>
                    {languageLabel(r.sourceLang as SourceLangSetting)} →{' '}
                    {languageLabel(r.targetLang as SourceLangSetting)}
                  </span>
                  {r.createdAtMs ? (
                    <>
                      <span aria-hidden>·</span>
                      <span className="tabular">
                        {new Intl.DateTimeFormat(locale, {
                          year: 'numeric',
                          month: 'numeric',
                          day: 'numeric',
                        }).format(new Date(r.createdAtMs))}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>

              {/* 보관 상태 — Business 무제한, 나머지는 만료 경고 (자동삭제는 아직 안 함, 표시만) */}
              <span
                className={`hidden shrink-0 rounded-md px-2 py-1 text-[12px] font-semibold sm:inline-block ${
                  r.expiresAtMs == null
                    ? 'bg-accent-weak text-accent'
                    : expired
                      ? 'bg-danger-weak text-danger'
                      : daysLeft! <= 7
                        ? 'bg-warn-weak text-warn'
                        : 'bg-bg-sunken text-text-muted'
                }`}
              >
                {r.expiresAtMs == null
                  ? t('retentionUnlimited')
                  : expired
                    ? t('retentionExpired')
                    : t('retentionDays', { days: daysLeft! })}
              </span>

              {r.storagePath ? (
                <a
                  href={`/api/records/${r.id}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-text-muted hover:border-accent hover:text-accent"
                  aria-label={t('download')}
                  title={t('download')}
                >
                  <Download size={15} aria-hidden />
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => void remove(r.id)}
                disabled={deleting === r.id}
                aria-label={t('delete')}
                title={t('delete')}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-text-muted hover:border-danger hover:text-danger disabled:opacity-50"
              >
                {deleting === r.id ? (
                  <Loader2 size={15} aria-hidden className="animate-spin" />
                ) : (
                  <Trash2 size={15} aria-hidden />
                )}
              </button>
            </li>
          );
        })}
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
