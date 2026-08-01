'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Copy, Loader2, RefreshCw, ShieldCheck, UserX } from 'lucide-react';

/**
 * 회사 관리 카드 (설정) — Business 결제자(대표)에게만 보인다.
 * 합류 코드 표시·복사·재발급·직접 수정(영문+숫자 6~20자), 멤버 목록·제거.
 * 대표가 아니면 GET이 404를 주고 카드는 아예 그려지지 않는다.
 */
interface ManageData {
  workspaceId: string;
  company: { name: string; bizNo: string };
  joinCode: string | null;
  members: Array<{ uid: string; email: string; displayName: string; role: string }>;
}

export function CompanyManageCard() {
  const t = useTranslations('settings.companyManage');
  const [data, setData] = useState<ManageData | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/company/manage', { cache: 'no-store' });
      if (!res.ok) return; // 404 = 대표 아님 — 카드 자체를 안 그린다
      setData((await res.json()) as ManageData);
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return null;

  const patch = async (body: { code?: string }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/company/manage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const resBody = (await res.json().catch(() => ({}))) as { joinCode?: string; error?: string };
      if (res.ok && resBody.joinCode) {
        setData((d) => (d ? { ...d, joinCode: resBody.joinCode! } : d));
        setEditing(false);
      } else {
        setError(resBody.error === 'invalid_format' ? t('badFormat') : t('failed'));
      }
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (memberUid: string) => {
    setBusy(true);
    try {
      const res = await fetch('/api/company/manage', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberUid }),
      });
      if (res.ok) await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-accent/40 bg-bg-raised p-5">
      <h2 className="flex items-center gap-2 text-[16px] font-semibold">
        <ShieldCheck size={16} aria-hidden className="text-accent" />
        {t('title', { name: data.company.name })}
      </h2>

      {/* 합류 코드 */}
      <div className="rounded-lg bg-bg-sunken p-4">
        <p className="text-[12.5px] font-semibold text-text-muted">{t('codeLabel')}</p>
        {editing ? (
          <div className="mt-2 flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value.toUpperCase())}
              maxLength={20}
              className="tabular h-10 min-w-0 flex-1 rounded-lg border border-border bg-bg-raised px-3 font-semibold tracking-[0.15em]"
            />
            <button
              onClick={() => void patch({ code: draft.trim() })}
              disabled={busy || !/^[A-Za-z0-9]{6,20}$/.test(draft.trim())}
              className="h-10 shrink-0 rounded-lg bg-accent px-4 text-[13.5px] font-semibold text-accent-text disabled:opacity-50"
            >
              {t('save')}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="h-10 shrink-0 rounded-lg border border-border px-3 text-[13.5px] font-semibold text-text-muted"
            >
              {t('cancel')}
            </button>
          </div>
        ) : (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="tabular text-[26px] font-bold tracking-[0.25em]">
              {data.joinCode ?? '—'}
            </span>
            <button
              onClick={() => {
                if (!data.joinCode) return;
                void navigator.clipboard.writeText(data.joinCode).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-semibold text-text-muted hover:text-text"
            >
              <Copy size={13} aria-hidden />
              {copied ? t('copied') : t('copy')}
            </button>
            <button
              onClick={() => void patch({})}
              disabled={busy}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-semibold text-text-muted hover:text-text disabled:opacity-50"
            >
              {busy ? (
                <Loader2 size={13} className="animate-spin" aria-hidden />
              ) : (
                <RefreshCw size={13} aria-hidden />
              )}
              {t('regen')}
            </button>
            <button
              onClick={() => {
                setDraft(data.joinCode ?? '');
                setEditing(true);
              }}
              className="h-9 rounded-lg border border-border px-3 text-[13px] font-semibold text-text-muted hover:text-text"
            >
              {t('edit')}
            </button>
          </div>
        )}
        <p className="mt-2 text-[12.5px] text-text-faint">{t('regenHint')}</p>
        {error ? <p className="mt-1 text-[13px] font-semibold text-danger">{error}</p> : null}
      </div>

      {/* 멤버 */}
      <div>
        <p className="mb-2 text-[12.5px] font-semibold text-text-muted">
          {t('members', { count: data.members.length })}
        </p>
        <ul className="flex flex-col gap-1.5">
          {data.members.map((m) => (
            <li
              key={m.uid}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <span className="text-[14px] font-medium">{m.email || m.displayName || m.uid}</span>
                {m.role === 'owner' ? (
                  <span className="ml-2 rounded-sm bg-accent-weak px-1.5 py-0.5 text-[11px] font-semibold text-accent">
                    {t('owner')}
                  </span>
                ) : null}
              </div>
              {m.role !== 'owner' ? (
                <button
                  onClick={() => void removeMember(m.uid)}
                  disabled={busy}
                  className="flex h-8 items-center gap-1 rounded-md px-2 text-[12.5px] font-semibold text-danger hover:bg-danger-weak disabled:opacity-50"
                >
                  <UserX size={13} aria-hidden />
                  {t('remove')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
