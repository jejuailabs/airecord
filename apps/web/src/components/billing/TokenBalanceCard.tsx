'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { AlertTriangle, Loader2, Plus } from 'lucide-react';
import { MODE_TOKENS_PER_MIN, TOPUP_PACKS } from '@sotong/shared/constants';

/**
 * 대시보드 잔여 토큰 카드 (사용자 지시 2026-08-02).
 * 토큰 수와 "그게 몇 분인지"를 가장 눈에 띄게 — 모드별 환산을 같이 보여준다.
 * 충전(선불 팩)과 후불 미결제 정산이 여기서 시작된다.
 * PG 미연동: 두 요청 모두 결제 의사만 기록되고 'pg_pending'이 돌아온다.
 */
export function TokenBalanceCard({
  remaining,
  included,
  topupTokens,
  debtKrw,
  unlimited,
}: {
  /** 남은 토큰 (포함분 잔여 + 충전 잔액) */
  remaining: number;
  /** 이번 주기 포함 토큰 */
  included: number;
  topupTokens: number;
  /** 후불 미결제 금액(원). 0보다 크면 새 세션이 막혀 있다 */
  debtKrw: number;
  unlimited: boolean;
}) {
  const t = useTranslations('dashboard.tokens');
  const fmt = useFormatter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  /** 'topup' | 'settle' — 신청이 접수된 항목 (PG 연동 전 안내) */
  const [requested, setRequested] = useState<Set<string>>(new Set());

  const won = (v: number) =>
    fmt.number(v, { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 });

  const total = included + topupTokens;
  const pct = total > 0 ? Math.min(100, (remaining / total) * 100) : 0;
  const barColor = pct <= 0 ? 'bg-danger' : pct < 20 ? 'bg-warn' : 'bg-accent';
  const minutesFor = (mode: keyof typeof MODE_TOKENS_PER_MIN) =>
    Math.floor(remaining / MODE_TOKENS_PER_MIN[mode]);

  const post = async (kind: 'topup' | 'settle', body?: object) => {
    setBusy(kind + (body ? JSON.stringify(body) : ''));
    try {
      const res = await fetch(`/api/billing/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      if (res.ok) setRequested((prev) => new Set(prev).add(kind));
    } finally {
      setBusy(null);
    }
  };

  if (unlimited) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-bg-raised p-5">
        <span className="text-[13px] font-semibold text-text-muted">{t('remaining')}</span>
        <span className="tabular text-[26px] font-bold leading-none">∞</span>
        <span className="inline-flex w-fit items-center rounded-md bg-accent-weak px-2 py-0.5 text-[12px] font-semibold text-accent">
          {t('unlimited')}
        </span>
      </div>
    );
  }

  return (
    <div className="col-span-2 flex flex-col gap-3 rounded-xl border border-border bg-bg-raised p-5">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-text-muted">{t('remaining')}</span>
        {topupTokens > 0 ? (
          <span className="tabular rounded-sm bg-accent-weak px-1.5 py-0.5 text-[11px] font-semibold text-accent">
            {t('topupHeld', { tokens: topupTokens })}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto flex h-8 items-center gap-1 rounded-md bg-accent px-3 text-[13px] font-semibold text-accent-text"
        >
          <Plus size={14} aria-hidden />
          {t('topupBtn')}
        </button>
      </div>

      {/* 토큰 수 + 모드별 분 환산 — 이 카드의 주인공 */}
      <div>
        <span className="tabular text-[32px] font-bold leading-none">{remaining}</span>
        <span className="ml-1 text-sm text-text-muted">{t('of', { total })}</span>
      </div>
      <p className="tabular text-[13.5px] font-medium text-text-muted">
        {t('asMinutes', {
          general: minutesFor('inperson'),
          meeting: minutesFor('meeting'),
          faceoff: minutesFor('faceoff'),
        })}
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-bg-sunken">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>

      {/* 후불 미결제 — 결제 전까지 새 세션이 막혀 있음을 그 자리에서 알린다 */}
      {debtKrw > 0 ? (
        <div className="flex items-start gap-2.5 rounded-lg bg-danger-weak px-4 py-3">
          <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-danger">
              {t('debt', { amount: won(debtKrw) })}
            </p>
            <p className="mt-0.5 text-[12.5px] text-text-muted">{t('debtHint')}</p>
          </div>
          {requested.has('settle') ? (
            <span className="shrink-0 text-[12.5px] font-semibold text-text-muted">
              {t('pgPending')}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void post('settle')}
              disabled={busy !== null}
              className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-danger px-3 text-[13px] font-semibold text-white disabled:opacity-60"
            >
              {busy === 'settle' ? <Loader2 size={13} aria-hidden className="animate-spin" /> : null}
              {t('settleBtn')}
            </button>
          )}
        </div>
      ) : null}

      {/* 충전 팩 선택 */}
      {open ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg p-3">
          {requested.has('topup') ? (
            <p className="text-[13px] font-semibold text-accent">{t('pgPending')}</p>
          ) : (
            TOPUP_PACKS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void post('topup', { packId: p.id })}
                disabled={busy !== null}
                className="flex items-center justify-between rounded-md border border-border bg-bg-raised px-4 py-2.5 text-left transition-colors hover:border-accent disabled:opacity-60"
              >
                <span className="text-[14px] font-semibold">
                  {t('packTokens', { tokens: p.tokens })}
                </span>
                <span className="tabular flex items-center gap-2 text-[14px] font-bold">
                  {busy?.includes(p.id) ? (
                    <Loader2 size={13} aria-hidden className="animate-spin" />
                  ) : null}
                  {won(p.krw)}
                </span>
              </button>
            ))
          )}
          <p className="text-[11.5px] text-text-faint">{t('packNote')}</p>
        </div>
      ) : null}
    </div>
  );
}
