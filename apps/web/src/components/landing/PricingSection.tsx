'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { PLANS, MODE_TOKENS_PER_MIN, yearlyKrw, YEARLY_DISCOUNT } from '@sotong/shared/constants';
import { Link } from '@/i18n/navigation';

const SHOWN = ['starter', 'pro', 'business'] as const;

/**
 * 요금제 비교 — 개인 2종 + 기업 1종.
 * 청구 단위는 '토큰'이다 (1 토큰 = 일반 모드 1분). 월/연 결제 토글, 연 결제 10% 할인.
 * 무제한 플랜은 만들지 않는다 (docs/07 §3).
 */
export function PricingSection() {
  const t = useTranslations('pricing');
  const fmt = useFormatter();
  const [yearly, setYearly] = useState(false);

  const won = (v: number) =>
    fmt.number(v, { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 });

  return (
    <section id="pricing" className="flex flex-col gap-8 py-16">
      <div className="text-center">
        <h2 className="text-[28px] font-bold">{t('title')}</h2>
        <p className="mt-2 text-sm text-text-muted">{t('subtitle')}</p>
      </div>

      {/* 토큰 표준 — 모드별 분당 토큰. 마주는 색을 달리하고 '토큰 최다'를 명시한다. */}
      <TokenStandard />

      {/* 월/연 결제 토글 */}
      <div className="flex items-center justify-center gap-2">
        <div className="inline-flex rounded-full border border-border bg-bg-raised p-1 text-sm">
          <button
            type="button"
            onClick={() => setYearly(false)}
            className={`rounded-full px-4 py-1.5 font-medium transition-colors ${
              !yearly ? 'bg-accent text-accent-text' : 'text-text-muted'
            }`}
          >
            {t('billMonthly')}
          </button>
          <button
            type="button"
            onClick={() => setYearly(true)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 font-medium transition-colors ${
              yearly ? 'bg-accent text-accent-text' : 'text-text-muted'
            }`}
          >
            {t('billYearly')}
            <span
              className={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold ${
                yearly ? 'bg-accent-text/20 text-accent-text' : 'bg-accent-weak text-accent'
              }`}
            >
              {t('yearlyBadge')}
            </span>
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {SHOWN.map((id) => {
          const plan = PLANS.find((p) => p.id === id)!;
          const highlighted = id === 'pro';
          const yearTotal = yearlyKrw(plan.monthlyKrw);
          const yearMonthly = Math.round((plan.monthlyKrw * (1 - YEARLY_DISCOUNT)) / 100) * 100;
          return (
            <div
              key={id}
              className={`flex flex-col gap-5 rounded-lg border bg-bg-raised p-6 ${
                highlighted ? 'border-accent' : 'border-border'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[20px] font-semibold">{t(`plans.${id}.name`)}</span>
                {highlighted ? (
                  <span className="rounded-sm bg-accent-weak px-2 py-0.5 text-[11px] font-semibold text-accent">
                    {t('popular')}
                  </span>
                ) : null}
              </div>
              <div>
                <span className="tabular text-[32px] font-bold leading-none">
                  {won(yearly ? yearMonthly : plan.monthlyKrw)}
                </span>
                <span className="text-sm text-text-muted">
                  {yearly ? t('perMonthBilled') : t('perMonth')}
                </span>
                {yearly ? (
                  <p className="mt-1 text-[13px] text-text-muted">
                    {t('yearlyTotal', { amount: won(yearTotal) })}
                    <span className="ml-1.5 text-[12px] text-accent">{t('yearlyBadge')}</span>
                  </p>
                ) : null}
              </div>
              <p className="text-sm text-text-muted">{t(`plans.${id}.for`)}</p>
              <ul className="flex flex-1 flex-col gap-2 text-sm">
                <Feature>{t('includedTokens', { tokens: plan.includedMinutes })}</Feature>
                <Feature>{t('retention', { days: plan.retentionDays })}</Feature>
                {plan.meetingMode ? <Feature>{t('meetingMode')}</Feature> : null}
                {plan.unlimitedTranslation ? <Feature>{t('unlimitedTranslation')}</Feature> : null}
                {plan.maxMembers === null ? <Feature>{t('unlimitedMembers')}</Feature> : null}
                {plan.overageKrwPerMin ? (
                  <Feature>{t('overage', { krw: plan.overageKrwPerMin })}</Feature>
                ) : (
                  <Feature>{t('noOverage')}</Feature>
                )}
              </ul>
              <Link
                href={`/checkout/${id}?cycle=${yearly ? 'yearly' : 'monthly'}`}
                className={`flex h-11 items-center justify-center rounded-md font-semibold transition-colors duration-150 ${
                  highlighted
                    ? 'bg-accent text-accent-text'
                    : 'border border-border hover:border-border-strong'
                }`}
              >
                {t('cta')}
              </Link>
            </div>
          );
        })}
      </div>

      <p className="text-center text-[13px] text-text-faint">{t('freeNote')}</p>
    </section>
  );
}

/**
 * 토큰 표준 카드 — 3개 모드의 분당 토큰 소비.
 * 마주(faceoff)는 원가가 가장 큰 모드라 색을 달리하고 '토큰 최다' 배지를 단다 (사용자 지시).
 */
function TokenStandard() {
  const t = useTranslations('pricing.tokenStd');
  const rows = [
    { key: 'general', rate: MODE_TOKENS_PER_MIN.inperson, accent: false },
    { key: 'meeting', rate: MODE_TOKENS_PER_MIN.meeting, accent: false },
    { key: 'faceoff', rate: MODE_TOKENS_PER_MIN.faceoff, accent: true },
  ] as const;

  return (
    <div className="mx-auto w-full max-w-xl rounded-lg border border-border bg-bg-raised p-5">
      <div className="mb-1 text-center text-[15px] font-semibold">{t('title')}</div>
      <p className="mb-4 text-center text-[13px] text-text-muted">{t('subtitle')}</p>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div
            key={r.key}
            className={`flex items-center justify-between rounded-md border px-4 py-3 ${
              r.accent ? 'border-warn/50 bg-warn-weak' : 'border-border bg-bg'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{t(r.key)}</span>
              {r.accent ? (
                <span className="rounded-sm bg-warn px-2 py-0.5 text-[10px] font-semibold text-white">
                  {t('faceoffBadge')}
                </span>
              ) : null}
            </div>
            <div className="text-right">
              <span
                className={`tabular text-[17px] font-bold ${
                  r.accent ? 'text-warn' : 'text-text'
                }`}
              >
                ×{r.rate}
              </span>
              <span className="ml-1 text-[12px] text-text-muted">{t('unit')}</span>
              <div className="text-[11px] text-text-faint">
                {t('per10', { tokens: r.rate * 10 })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check size={15} aria-hidden className="mt-0.5 shrink-0 text-accent" />
      <span className="text-text-muted">{children}</span>
    </li>
  );
}
