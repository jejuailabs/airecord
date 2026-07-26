import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Inbox, Clock } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { currentUid, listSessions } from '@/lib/server/sessions-query';
import { languageLabel } from '@sotong/shared/constants';
import type { SourceLangSetting } from '@sotong/shared/types';

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default async function SessionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('sessions');
  const uid = await currentUid();
  const items = uid ? await listSessions(uid) : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[30px] font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-text-muted">{t('subtitle')}</p>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-bg-raised px-6 py-16 text-center">
          <Inbox size={30} aria-hidden className="text-text-faint" />
          <div className="text-lg font-semibold">{t('emptyTitle')}</div>
          <p className="max-w-md text-text-muted">{t('emptyHint')}</p>
          <Link
            href="/live"
            className="mt-2 flex h-11 items-center rounded-md bg-accent px-6 font-semibold text-accent-text"
          >
            {t('emptyCta')}
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((s) => (
            <li key={s.id}>
              <Link
                href={`/sessions/${s.id}`}
                className="flex items-center gap-4 rounded-lg border border-border bg-bg-raised px-5 py-4 transition-colors duration-150 hover:border-accent"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[17px] font-semibold">
                    {s.title ?? t('untitled')}
                  </div>
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
      )}
    </div>
  );
}
