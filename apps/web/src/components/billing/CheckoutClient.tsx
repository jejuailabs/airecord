'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { CheckCircle2 } from 'lucide-react';
import { getPlan, yearlyKrw } from '@sotong/shared/constants';
import { Link } from '@/i18n/navigation';

/**
 * 결제 유도 화면. PG 미확정(docs/02 §6)이므로 결제 의사를 기록하고
 * 정직하게 "연동 준비 중"을 알린다 — 가짜 결제창을 띄우지 않는다.
 */
export function CheckoutClient({ planId }: { planId: 'starter' | 'pro' | 'business' }) {
  const t = useTranslations('checkout');
  const tp = useTranslations('pricing');
  const fmt = useFormatter();
  const plan = getPlan(planId);
  const params = useSearchParams();
  const yearly = params.get('cycle') === 'yearly';
  const [state, setState] = useState<'idle' | 'busy' | 'reserved' | 'failed'>('idle');

  if (!plan) return null;

  const price = yearly ? yearlyKrw(plan.monthlyKrw) : plan.monthlyKrw;

  const submit = async () => {
    setState('busy');
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, cycle: yearly ? 'yearly' : 'monthly' }),
      });
      setState(res.ok ? 'reserved' : 'failed');
    } catch {
      setState('failed');
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 py-12">
      <h1 className="text-[28px] font-bold">{t('title')}</h1>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-bg-raised p-6">
        <div className="flex items-baseline justify-between">
          <span className="text-[20px] font-semibold">{tp(`plans.${plan.id}.name`)}</span>
          <span className="tabular text-[20px] font-bold">
            {fmt.number(price, { style: 'currency', currency: 'KRW' })}
            <span className="text-sm font-normal text-text-muted">
              {yearly ? tp('perYear') : tp('perMonth')}
            </span>
          </span>
        </div>
        {yearly ? (
          <p className="-mt-1 text-[12px] font-medium text-accent">{tp('yearlyHint')}</p>
        ) : null}
        <ul className="flex flex-col gap-1.5 text-sm text-text-muted">
          <li>{tp('includedTokens', { tokens: plan.includedMinutes })}</li>
          <li>{tp('retention', { days: plan.retentionDays })}</li>
          {plan.meetingMode ? <li>{tp('meetingMode')}</li> : null}
          {plan.overageKrwPerMin ? (
            <li>{tp('overage', { krw: plan.overageKrwPerMin })}</li>
          ) : (
            <li>{tp('noOverage')}</li>
          )}
        </ul>
      </div>

      {state === 'reserved' ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-bg-raised p-6 text-center">
          <CheckCircle2 size={28} aria-hidden className="text-accent" />
          <p className="font-semibold">{t('reserved.title')}</p>
          <p className="text-sm text-text-muted">{t('reserved.body')}</p>
          <Link href="/dashboard" className="mt-2 text-sm font-semibold text-accent">
            {t('reserved.toDashboard')}
          </Link>
        </div>
      ) : (
        <>
          <button
            onClick={submit}
            disabled={state === 'busy'}
            className="h-12 rounded-md bg-accent font-semibold text-accent-text disabled:opacity-50"
          >
            {state === 'busy' ? t('busy') : t('submit')}
          </button>
          <p className="text-center text-[13px] text-text-faint">{t('pgNote')}</p>
          {state === 'failed' ? (
            <div className="rounded-md bg-danger-weak px-4 py-3">
              <p className="text-sm font-semibold text-danger">{t('failed.title')}</p>
              <p className="text-sm text-text-muted">{t('failed.action')}</p>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
