import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Sparkles, FileDown, Clock } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { currentUid, getSessionDetail } from '@/lib/server/sessions-query';
import { languageLabel } from '@sotong/shared/constants';
import type { SourceLangSetting } from '@sotong/shared/types';
import { SummaryRefresher } from '@/components/sessions/SummaryRefresher';

function fmtMs(ms: number) {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('sessionDetail');
  const uid = await currentUid();
  const detail = uid ? await getSessionDetail(uid, id) : null;
  if (!detail) notFound();

  const summaryPending = detail.summaryStatus === 'running' || detail.summaryStatus == null;

  return (
    <div className="flex flex-col gap-6">
      {/* 헤더 */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <Link href="/sessions" className="text-sm text-text-muted hover:text-text">
            ← {t('back')}
          </Link>
          <h1 className="mt-1 text-[30px] font-bold leading-tight tracking-tight">
            {detail.summary?.title ?? detail.title ?? t('untitled')}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
            <span>
              {languageLabel(detail.sourceLang as SourceLangSetting)} →{' '}
              {languageLabel(detail.targetLang as SourceLangSetting)}
            </span>
            <span className="tabular flex items-center gap-1">
              <Clock size={13} aria-hidden />
              {Math.ceil(detail.billedSeconds / 60)}
              {t('minute')}
            </span>
            <span>{t('segments', { count: detail.segments.length })}</span>
          </p>
        </div>
        <a
          href={`/api/sessions/${detail.id}/pdf`}
          className="flex h-11 shrink-0 items-center gap-2 rounded-md bg-accent px-5 font-semibold text-accent-text"
        >
          <FileDown size={16} aria-hidden />
          {t('downloadPdf')}
        </a>
      </div>

      {/* AI 요약 */}
      <section className="flex flex-col gap-4 rounded-lg border border-border bg-bg-raised p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Sparkles size={17} aria-hidden className="text-accent" />
          {t('summaryTitle')}
        </h2>

        {detail.summary ? (
          <div className="flex flex-col gap-5">
            <p className="text-[15px] leading-relaxed">{detail.summary.overview}</p>

            {detail.summary.keyPoints.length > 0 ? (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  {t('keyPoints')}
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {detail.summary.keyPoints.map((p, i) => (
                    <li key={i} className="flex gap-2 text-[15px]">
                      <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {detail.summary.decisions.length > 0 ? (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  {t('decisions')}
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {detail.summary.decisions.map((d, i) => (
                    <li key={i} className="flex gap-2 text-[15px]">
                      <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-2" />
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {detail.summary.actionItems.length > 0 ? (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  {t('actionItems')}
                </h3>
                <ul className="flex flex-col gap-2">
                  {detail.summary.actionItems.map((a, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 rounded-md bg-bg-sunken px-3 py-2 text-[15px]"
                    >
                      <input type="checkbox" disabled className="mt-1.5" aria-hidden />
                      <span>
                        {a.text}
                        {a.owner ? (
                          <span className="ml-2 rounded-sm bg-accent-weak px-1.5 py-0.5 text-[12px] font-semibold text-accent">
                            {a.owner}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : summaryPending ? (
          <>
            <div className="flex flex-col gap-2">
              <div className="h-4 w-3/4 animate-pulse rounded bg-bg-sunken" />
              <div className="h-4 w-full animate-pulse rounded bg-bg-sunken" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-bg-sunken" />
            </div>
            <p className="text-sm text-text-muted">{t('summaryRunning')}</p>
            <SummaryRefresher />
          </>
        ) : (
          <div>
            <p className="font-semibold text-warn">{t('summaryFailed.title')}</p>
            <p className="text-sm text-text-muted">{t('summaryFailed.action')}</p>
          </div>
        )}
      </section>

      {/* 원본 스크립트 — 원문·번역 대조 */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('transcript')}</h2>
        {detail.segments.length === 0 ? (
          <p className="rounded-lg border border-border bg-bg-raised px-6 py-10 text-center text-text-muted">
            {t('noTranscript')}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-bg-raised">
            {detail.segments.map((s) => (
              <div
                key={s.seq}
                className="flex gap-4 border-b border-border px-5 py-4 last:border-0"
              >
                <span className="tabular w-12 shrink-0 pt-1 text-[13px] text-text-faint">
                  {fmtMs(s.startMs)}
                </span>
                <div className="min-w-0">
                  <p className="text-[17px] font-semibold leading-relaxed">{s.targetText}</p>
                  {s.sourceText ? (
                    <p className="mt-1 text-[14px] leading-relaxed text-text-faint">
                      {s.sourceText}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
