'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { PLANS } from '@sotong/shared/constants';
import { Link } from '@/i18n/navigation';

const SHOWN = ['starter', 'pro', 'business'] as const;

/**
 * 요금제 비교 — 개인 2종 + 기업 1종 (docs/07 §4 가설 가격, 원가 기반 GM≥50% 방어선 충족).
 * 무제한 플랜은 만들지 않는다 (docs/07 §3).
 */
export function PricingSection() {
  const t = useTranslations('pricing');
  const fmt = useFormatter();

  return (
    <section id="pricing" className="flex flex-col gap-8 py-16">
      <div className="text-center">
        <h2 className="text-[28px] font-bold">{t('title')}</h2>
        <p className="mt-2 text-sm text-text-muted">{t('subtitle')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {SHOWN.map((id) => {
          const plan = PLANS.find((p) => p.id === id)!;
          const highlighted = id === 'pro';
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
                  {fmt.number(plan.monthlyKrw, {
                    style: 'currency',
                    currency: 'KRW',
                    maximumFractionDigits: 0,
                  })}
                </span>
                <span className="text-sm text-text-muted">{t('perMonth')}</span>
              </div>
              <p className="text-sm text-text-muted">{t(`plans.${id}.for`)}</p>
              <ul className="flex flex-1 flex-col gap-2 text-sm">
                <Feature>{t('includedMinutes', { minutes: plan.includedMinutes })}</Feature>
                <Feature>{t('retention', { days: plan.retentionDays })}</Feature>
                {plan.meetingMode ? <Feature>{t('meetingMode')}</Feature> : null}
                {plan.maxMembers === null ? <Feature>{t('unlimitedMembers')}</Feature> : null}
                {plan.overageKrwPerMin ? (
                  <Feature>{t('overage', { krw: plan.overageKrwPerMin })}</Feature>
                ) : (
                  <Feature>{t('noOverage')}</Feature>
                )}
              </ul>
              <Link
                href={`/checkout/${id}`}
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

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check size={15} aria-hidden className="mt-0.5 shrink-0 text-accent" />
      <span className="text-text-muted">{children}</span>
    </li>
  );
}
