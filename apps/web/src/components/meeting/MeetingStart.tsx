'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Video, Info } from 'lucide-react';
import { detectMeetingPlatform } from '@sotong/shared/schemas';
import { INTERPRET_LANGUAGES } from '@sotong/shared/constants';
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
  const [targetLang, setTargetLang] = useState<LangCode>('en');
  const [result, setResult] = useState<'unavailable' | null>(null);

  const platform = useMemo(() => (url ? detectMeetingPlatform(url) : null), [url]);
  const urlEntered = url.trim().length > 0;

  const send = async () => {
    const res = await fetch('/api/meeting/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, sourceLang, targetLang }),
    });
    if (res.status === 501) setResult('unavailable');
  };

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 py-8">
      <div>
        <h1 className="text-[28px] font-bold">{t('title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('subtitle')}</p>
      </div>

      <section className="flex flex-col gap-4 rounded-lg border border-border bg-bg-raised p-6">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="meeting-url"
            className="text-xs font-semibold uppercase tracking-wider text-text-muted"
          >
            {t('urlLabel')}
          </label>
          <input
            id="meeting-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('urlPlaceholder')}
            className="h-11 rounded-md border border-border bg-bg-sunken px-3"
          />
          {urlEntered && platform ? (
            <p className="flex items-center gap-1.5 text-[13px] text-accent">
              <Video size={14} aria-hidden />
              {t('detected', { platform: PLATFORM_NAMES[platform] ?? platform })}
            </p>
          ) : null}
          {urlEntered && !platform ? (
            <p className="text-[13px] text-danger">{t('urlInvalid')}</p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="m-source"
              className="text-xs font-semibold uppercase tracking-wider text-text-muted"
            >
              {t('sourceLang')}
            </label>
            <select
              id="m-source"
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value as SourceLangSetting)}
              className="h-11 rounded-md border border-border bg-bg-sunken px-2"
            >
              <option value="auto">{t('autoDetect')}</option>
              {INTERPRET_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="m-target"
              className="text-xs font-semibold uppercase tracking-wider text-text-muted"
            >
              {t('targetLang')}
            </label>
            <select
              id="m-target"
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value as LangCode)}
              className="h-11 rounded-md border border-border bg-bg-sunken px-2"
            >
              {INTERPRET_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={send}
          disabled={!platform}
          className="h-12 rounded-md bg-accent font-semibold text-accent-text disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('send')}
        </button>
        <p className="text-center text-[13px] text-text-faint">{t('consentNotice')}</p>
      </section>

      {result === 'unavailable' ? (
        <div className="flex gap-3 rounded-lg border border-border bg-bg-raised p-5">
          <Info size={18} aria-hidden className="mt-0.5 shrink-0 text-text-muted" />
          <div>
            <p className="font-semibold">{t('unavailable.title')}</p>
            <p className="mt-1 text-sm text-text-muted">{t('unavailable.body')}</p>
            <p className="mt-2 text-[13px] text-text-faint">{t('unavailable.docs')}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
