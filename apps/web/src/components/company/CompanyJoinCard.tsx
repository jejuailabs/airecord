'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, Check, Loader2, Search } from 'lucide-react';

/**
 * 회사 합류 카드 (설정) — 회사명 검색(2자 이상, 앞글자 매칭) → 펼침목록 선택 → 코드 입력.
 * 성공하면 이후 토큰 소비가 회사 지갑에서 이루어진다. 화면 전체를 새로 고쳐
 * 사이드바 잔액·회사명이 즉시 회사 기준으로 바뀌게 한다.
 */
interface Candidate {
  workspaceId: string;
  name: string;
}

export function CompanyJoinCard() {
  const t = useTranslations('settings.companyJoin');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 검색 — 300ms 디바운스, 2자 미만이면 안 던진다
  useEffect(() => {
    if (picked) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/company/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) return;
        const body = (await res.json()) as { companies: Candidate[] };
        setResults(body.companies ?? []);
      } catch {
        /* 검색 실패는 조용히 — 다시 입력하면 재시도된다 */
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, picked]);

  const join = async () => {
    if (!picked || code.trim().length < 6) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/company/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: picked.workspaceId, code: code.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        companyName?: string;
        error?: string;
        retryAfterSec?: number;
      };
      if (res.ok && body.companyName) {
        setJoined(body.companyName);
        // 사이드바 잔액·회사명이 회사 지갑 기준으로 바뀌도록 전체 새로고침
        setTimeout(() => window.location.reload(), 1200);
        return;
      }
      if (body.error === 'too_many_attempts') {
        setError(t('locked', { min: Math.max(1, Math.ceil((body.retryAfterSec ?? 600) / 60)) }));
      } else {
        setError(t('wrongCode'));
      }
    } catch {
      setError(t('wrongCode'));
    } finally {
      setBusy(false);
    }
  };

  if (joined) {
    return (
      <section className="flex items-center gap-3 rounded-xl border border-accent bg-accent-weak/20 p-5">
        <Check size={20} aria-hidden className="shrink-0 text-accent" />
        <p className="font-semibold">{t('done', { name: joined })}</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-bg-raised p-5">
      <h2 className="flex items-center gap-2 text-[16px] font-semibold">
        <Building2 size={16} aria-hidden className="text-accent" />
        {t('title')}
      </h2>
      <p className="text-[13px] text-text-muted">{t('hint')}</p>

      {picked ? (
        <div className="flex items-center justify-between rounded-lg border border-accent bg-accent-weak/20 px-3 py-2.5">
          <span className="font-semibold">{picked.name}</span>
          <button
            onClick={() => {
              setPicked(null);
              setCode('');
              setQ('');
            }}
            className="text-[13px] font-semibold text-text-muted hover:text-text"
          >
            {t('repick')}
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search
            size={15}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('searchPh')}
            className="h-11 w-full rounded-lg border border-border bg-bg-sunken pl-9 pr-3 text-[15px]"
          />
          {results.length > 0 ? (
            <ul className="absolute inset-x-0 top-12 z-10 overflow-hidden rounded-lg border border-border bg-bg-raised shadow-token">
              {results.map((c) => (
                <li key={c.workspaceId}>
                  <button
                    onClick={() => {
                      setPicked(c);
                      setResults([]);
                    }}
                    className="w-full px-3 py-2.5 text-left text-[14.5px] font-medium hover:bg-bg-sunken"
                  >
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      {picked ? (
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder={t('codePh')}
            maxLength={20}
            autoCapitalize="characters"
            className="tabular h-11 min-w-0 flex-1 rounded-lg border border-border bg-bg-sunken px-3 text-[15px] font-semibold tracking-[0.15em]"
          />
          <button
            onClick={() => void join()}
            disabled={busy || code.trim().length < 6}
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-5 font-semibold text-accent-text disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}
            {t('join')}
          </button>
        </div>
      ) : null}

      {error ? <p className="text-[13px] font-semibold text-danger">{error}</p> : null}
    </section>
  );
}
