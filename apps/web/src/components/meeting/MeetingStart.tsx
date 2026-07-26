'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Info, Languages, Link2, Video } from 'lucide-react';
import { detectMeetingPlatform } from '@sotong/shared/schemas';
import { INTERPRET_LANGUAGES, TRANSLATE_TARGET_LANGS } from '@sotong/shared/constants';
import type { LangCode, SourceLangSetting } from '@sotong/shared/types';

const PLATFORM_NAMES: Record<string, string> = {
  zoom: 'Zoom',
  teams: 'Microsoft Teams',
  meet: 'Google Meet',
  webex: 'Webex',
};

/**
 * 모드 A 시작 화면 (docs/06 §2.1).
 * 붙여넣는 즉시 플랫폼을 판별한다. "다음" 단계가 없다.
 * Phase 4에서 /api/meeting/join이 봇을 실제로 보낸다 — 지금은 준비 상태를 정직하게 보여준다.
 */
export function MeetingStart() {
  const t = useTranslations('meeting');
  const [url, setUrl] = useState('');
  const [sourceLang, setSourceLang] = useState<SourceLangSetting>('auto');
  const [targetLang, setTargetLang] = useState<LangCode>('ko');
  const [result, setResult] = useState<'unavailable' | null>(null);
  const [busy, setBusy] = useState(false);

  const platform = useMemo(() => (url ? detectMeetingPlatform(url) : null), [url]);
  const urlEntered = url.trim().length > 0;

  const send = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/meeting/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, sourceLang, targetLang }),
      });
      if (res.status === 501) setResult('unavailable');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 py-4">
      <div>
        <h1 className="text-[34px] font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1.5 text-[17px] text-text-muted">{t('subtitle')}</p>
      </div>

      {/* 회의 링크 */}
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-bg-raised p-6">
        <label
          htmlFor="meeting-url"
          className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-text-muted"
        >
          <Link2 size={15} aria-hidden />
          {t('urlLabel')}
        </label>
        <input
          id="meeting-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('urlPlaceholder')}
          className="h-16 rounded-lg border border-border bg-bg-sunken px-5 text-[18px]"
        />
        {urlEntered && platform ? (
          <p className="flex items-center gap-2 rounded-lg bg-accent-2-weak px-4 py-2.5 text-[15px] font-semibold text-accent-2">
            <Video size={16} aria-hidden />
            {t('detected', { platform: PLATFORM_NAMES[platform] ?? platform })}
          </p>
        ) : null}
        {urlEntered && !platform ? (
          <p className="rounded-lg bg-danger-weak px-4 py-2.5 text-[15px] text-danger">
            {t('urlInvalid')}
          </p>
        ) : null}
        {!urlEntered ? (
          <p className="flex flex-wrap gap-2 text-[14px] text-text-faint">
            {Object.values(PLATFORM_NAMES).map((n) => (
              <span key={n} className="rounded-md bg-bg-sunken px-2.5 py-1">
                {n}
              </span>
            ))}
          </p>
        ) : null}
      </section>

      {/* 언어 */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-bg-raised p-6">
          <label
            htmlFor="m-source"
            className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-text-muted"
          >
            <Languages size={15} aria-hidden />
            {t('sourceLang')}
          </label>
          <select
            id="m-source"
            value={sourceLang}
            onChange={(e) => setSourceLang(e.target.value as SourceLangSetting)}
            className="h-14 rounded-lg border border-border bg-bg-sunken px-4 text-[19px] font-semibold"
          >
            <option value="auto">{t('autoDetect')}</option>
            {INTERPRET_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <p className="text-[14px] leading-snug text-text-faint">{t('sourceHint')}</p>
        </div>

        <div className="flex flex-col gap-2.5 rounded-xl border border-accent bg-bg-raised p-6">
          <label
            htmlFor="m-target"
            className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-accent"
          >
            <Languages size={15} aria-hidden />
            {t('targetLang')}
          </label>
          <select
            id="m-target"
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value as LangCode)}
            className="h-14 rounded-lg border border-border bg-bg-sunken px-4 text-[19px] font-semibold"
          >
            {INTERPRET_LANGUAGES.filter((l) => TRANSLATE_TARGET_LANGS.includes(l.code)).map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <p className="text-[14px] leading-snug text-text-faint">{t('targetHint')}</p>
        </div>
      </section>

      <div className="flex flex-col gap-3">
        <button
          onClick={send}
          disabled={!platform || busy}
          className="h-16 rounded-xl bg-accent text-[19px] font-bold text-accent-text transition-opacity duration-150 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? t('sending') : t('send')}
        </button>
        <p className="text-center text-[14px] text-text-faint">{t('consentNotice')}</p>
      </div>

      {result === 'unavailable' ? (
        <div className="flex gap-4 rounded-xl border border-border bg-bg-raised p-6">
          <Info size={20} aria-hidden className="mt-0.5 shrink-0 text-text-muted" />
          <div>
            <p className="text-[17px] font-semibold">{t('unavailable.title')}</p>
            <p className="mt-1.5 text-[15px] text-text-muted">{t('unavailable.body')}</p>
            <p className="mt-2 text-[14px] text-text-faint">{t('unavailable.docs')}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
