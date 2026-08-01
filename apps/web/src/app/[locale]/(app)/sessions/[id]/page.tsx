import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Sparkles, FileDown, Clock } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { currentUid, getSessionDetail } from '@/lib/server/sessions-query';
import { buildScript } from '@sotong/shared/engine';
import { FaceoffTranscript } from '@/components/sessions/FaceoffTranscript';
import { RecordingPlayer } from '@/components/sessions/RecordingPlayer';
import { languageLabel } from '@sotong/shared/constants';
import type { SourceLangSetting } from '@sotong/shared/types';
import { SummaryRefresher } from '@/components/sessions/SummaryRefresher';
import { EditableTitle } from '@/components/sessions/EditableTitle';

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
      <div className="flex flex-col gap-3">
        <Link href="/sessions" className="text-sm text-text-muted hover:text-text">
          ← {t('back')}
        </Link>

        <EditableTitle
          sessionId={detail.id}
          initialTitle={detail.title ?? ''}
          fromAi={detail.titleFromAi}
          placeholder={t('untitled')}
        />

        {/* 메타 — 좁은 화면에서도 각 항목이 쪼개지지 않게 한 덩어리씩 묶는다 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[14px] text-text-muted">
          <span className="whitespace-nowrap">
            {languageLabel(detail.sourceLang as SourceLangSetting)} →{' '}
            {languageLabel(detail.targetLang as SourceLangSetting)}
          </span>
          <span aria-hidden className="text-text-faint">
            ·
          </span>
          <span className="tabular flex items-center gap-1 whitespace-nowrap">
            <Clock size={13} aria-hidden />
            {Math.ceil(detail.billedSeconds / 60)}
            {t('minute')}
          </span>
          <span aria-hidden className="text-text-faint">
            ·
          </span>
          <span className="whitespace-nowrap">
            {t('segments', { count: detail.segments.length })}
          </span>
        </div>

        <a
          href={`/api/sessions/${detail.id}/pdf`}
          target="_blank"
          rel="noopener"
          className="btn-gradient flex h-12 w-full items-center justify-center gap-2 rounded-xl px-6 font-semibold sm:w-auto sm:self-start"
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

      {/* 원본 음성 (녹음이 있으면) */}
      <RecordingPlayer sessionId={detail.id} />

      {/* 원본 스크립트 — 원문·번역 대조 */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('transcript')}</h2>
        {detail.segments.length === 0 ? (
          <p className="rounded-lg border border-border bg-bg-raised px-6 py-10 text-center text-text-muted">
            {t('noTranscript')}
          </p>
        ) : detail.mode === 'faceoff' ? (
          // 마주통역 — 화자별 색 + 화자별 필터
          <FaceoffTranscript segments={detail.segments} />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-bg-raised">
            {buildScript(detail.segments).map((b) =>
              b.type === 'paired' ? (
                <div
                  key={b.seq}
                  className="flex gap-4 border-b border-border px-5 py-4 last:border-0"
                >
                  <span className="tabular w-12 shrink-0 pt-1 text-[13px] text-text-faint">
                    {fmtMs(b.startMs)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[17px] font-semibold leading-relaxed">{b.targetText}</p>
                    <p className="mt-1 text-[14px] leading-relaxed text-text-faint">
                      {b.sourceText}
                    </p>
                  </div>
                </div>
              ) : (
                /* 짝을 못 지은 구간 — 억지로 한 줄에 끼우지 않고 좌우로 나란히 둔다 */
                <div
                  key={b.seq}
                  className="flex gap-4 border-b border-border bg-bg-sunken/40 px-5 py-4 last:border-0"
                >
                  <span className="tabular w-12 shrink-0 pt-1 text-[13px] text-text-faint">
                    {fmtMs(b.startMs)}
                  </span>
                  {/*
                    넓은 화면은 좌우로 나란히 두면 어느 구간인지 한눈에 보인다.
                    좁은 화면은 위아래로 접히면서 그 대응이 사라져, 번역이 다 쌓인 뒤
                    원문이 다 쌓인 벽처럼 보인다. 그래서 좁을 때만 라벨을 띄워
                    "여기부터 원문"을 명시한다 — 넓은 화면에는 군더더기라 감춘다.
                  */}
                  <div className="grid min-w-0 flex-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                    {/* 한쪽만 있는 블록도 흔하다 — 빈 칸에 라벨만 남는 걸 막는다 */}
                    <div className={b.target.length === 0 ? 'hidden sm:block' : 'flex flex-col gap-1.5'}>
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-text-faint sm:hidden">
                        {t('colTarget')}
                      </span>
                      {b.target.map((line, i) => (
                        <p key={i} className="text-[17px] font-semibold leading-relaxed">
                          {line}
                        </p>
                      ))}
                    </div>
                    {/*
                      좁은 화면에서 위에 번역이 있을 때만 가로줄로 가른다.
                      ⚠ 'border-t' 뒤에 'border-t-0'을 덧붙여 덮으려 하면 안 된다 —
                      Tailwind는 클래스 문자열 순서가 아니라 생성된 CSS 순서로 이기고 진다.
                    */}
                    <div
                      className={
                        b.source.length === 0
                          ? 'hidden sm:block'
                          : b.target.length === 0
                            ? 'flex flex-col gap-1.5'
                            : 'flex flex-col gap-1.5 border-t border-border pt-3 sm:border-t-0 sm:pt-0'
                      }
                    >
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-text-faint sm:hidden">
                        {t('colSource')}
                      </span>
                      {b.source.map((line, i) => (
                        <p key={i} className="text-[14px] leading-relaxed text-text-faint">
                          {line}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </section>
    </div>
  );
}
