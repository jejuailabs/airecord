'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowRight,
  Bot,
  ClipboardPaste,
  Globe,
  Info,
  Link2,
  Lock,
  ShieldCheck,
  Video,
} from 'lucide-react';
import { detectMeetingPlatform } from '@sotong/shared/schemas';
import { INTERPRET_LANGUAGES, TRANSLATE_TARGET_LANGS } from '@sotong/shared/constants';
import type { LangCode, SourceLangSetting } from '@sotong/shared/types';
import { FieldSelect } from '@/components/ui/SettingRow';

const PLATFORM_NAMES: Record<string, string> = {
  zoom: 'Zoom',
  teams: 'Microsoft Teams',
  meet: 'Google Meet',
  webex: 'Webex',
};

/**
 * 모드 A 시작 화면 (docs/06 §2.1).
 * 붙여넣는 즉시 플랫폼을 판별한다. "다음" 단계가 없다.
 * "봇 보내기"를 누르면 /api/meeting/join이 실제로 Recall.ai 봇을 만들어 회의에 넣고,
 * 봇이 회의 채팅에 자막 링크를 1회 게시한다.
 *
 * ⚠ 인프라 키(RECALL_API_KEY·WORKER_BASE_URL·WORKER_SHARED_SECRET)가 없으면 503이 온다.
 *   그때는 무엇이 비었는지 그대로 보여준다 — "안 됩니다"만 띄우면 원인을 찾을 수 없다.
 */
export function MeetingStart() {
  const t = useTranslations('meeting');
  const [url, setUrl] = useState('');
  const [sourceLang, setSourceLang] = useState<SourceLangSetting>('auto');
  const [targetLang, setTargetLang] = useState<LangCode>('en');
  const [result, setResult] = useState<'unavailable' | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** 봇이 회의에 들어간 뒤 — 자막 링크와 종료 버튼을 든다 */
  const [live, setLive] = useState<{ sessionId: string; botId: string; viewerUrl: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const platform = useMemo(() => (url ? detectMeetingPlatform(url) : null), [url]);
  const urlEntered = url.trim().length > 0;

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
    } catch {
      /* 클립보드 권한 없음 — 직접 붙여넣으면 된다 */
    }
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/meeting/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, sourceLang, targetLang }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        missing?: string[];
        sessionId?: string;
        botId?: string;
        viewerUrl?: string;
      };
      if (res.ok && body.sessionId && body.botId && body.viewerUrl) {
        setLive({ sessionId: body.sessionId, botId: body.botId, viewerUrl: body.viewerUrl });
        return;
      }
      // 인프라 미설정은 "무엇이 비었는지"까지 보여준다 — 그게 다음 행동을 정한다
      if (body.error === 'infra_not_configured') {
        setMissing(body.missing ?? []);
        setResult('unavailable');
        return;
      }
      setError(body.error ?? 'join_failed');
    } catch {
      setError('network');
    } finally {
      setBusy(false);
    }
  };

  /** 봇을 내보낸다. 안 내보내면 회의에 계속 앉아 초당 과금된다 (docs/07 §1.2) */
  const stop = async () => {
    if (!live) return;
    setBusy(true);
    try {
      await fetch('/api/meeting/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: live.sessionId, botId: live.botId }),
      });
      setLive(null);
    } finally {
      setBusy(false);
    }
  };

  /**
   * 실패 사유 문구.
   * ⚠ t()에 서버가 준 문자열을 그대로 넣으면 없는 키에서 예외가 난다 —
   *   아는 사유만 번역하고 나머지는 하나로 모은다.
   */
  const FAILED_KEYS = [
    'auth_required',
    'quota_exhausted',
    'unsupported_platform',
    'unsupported_pair',
    'bot_create_failed',
    'network',
  ] as const;
  const failedText = (code: string) =>
    (FAILED_KEYS as readonly string[]).includes(code)
      ? t(`failed.${code}` as 'failed.network')
      : t('failed.join_failed');

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 py-2">
      {/* 히어로 */}
      <div className="flex flex-col items-center gap-6 pt-6 sm:flex-row sm:justify-center">
        <span
          className="hero-glow cta-orb-violet text-white"
          style={{ ['--glow-color' as string]: 'rgb(124 77 255 / .55)' }}
          aria-hidden
        >
          <Link2 size={46} />
        </span>
        <div className="text-center sm:text-left">
          <h1 className="text-[40px] font-bold leading-tight tracking-tight">{t('title')}</h1>
          <p className="mt-1 max-w-lg whitespace-pre-line text-[16px] text-text-muted">
            {t('subtitle')}
          </p>
        </div>
      </div>

      <section className="flex flex-col gap-6 rounded-2xl border border-border bg-bg-raised p-6">
        {/* 회의 링크 */}
        <div className="flex flex-col gap-2">
          <label htmlFor="meeting-url" className="text-[15px] font-semibold">
            {t('urlLabel')}
          </label>
          <div className="relative">
            <Link2
              size={17}
              aria-hidden
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-faint"
            />
            <input
              id="meeting-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('urlPlaceholder')}
              className="h-14 w-full rounded-lg border border-border bg-bg-sunken pl-11 pr-32 text-[16px]"
            />
            <button
              type="button"
              onClick={pasteFromClipboard}
              className="absolute right-2 top-1/2 flex h-10 -translate-y-1/2 items-center gap-1.5 rounded-lg px-3 text-[14px] font-semibold text-accent hover:bg-accent-weak"
            >
              <ClipboardPaste size={15} aria-hidden />
              {t('paste')}
            </button>
          </div>
          {urlEntered && platform ? (
            <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-accent-2">
              <Video size={14} aria-hidden />
              {t('detected', { platform: PLATFORM_NAMES[platform] ?? platform })}
            </p>
          ) : null}
          {urlEntered && !platform ? (
            <p className="text-[13.5px] text-danger">{t('urlInvalid')}</p>
          ) : null}
          {!urlEntered ? (
            <p className="flex flex-wrap gap-1.5 text-[13px] text-text-faint">
              {Object.values(PLATFORM_NAMES).map((n) => (
                <span key={n} className="rounded-md bg-bg-sunken px-2 py-0.5">
                  {n}
                </span>
              ))}
            </p>
          ) : null}
        </div>

        {/* 언어 — 입력 → 표시 */}
        <div className="grid items-start gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <div className="flex flex-col gap-2">
            <label htmlFor="m-source" className="text-[15px] font-semibold">
              {t('sourceLang')}
            </label>
            <div className="flex items-center gap-2.5">
              <span className="icon-chip" aria-hidden>
                <Globe size={18} />
              </span>
              <FieldSelect
                id="m-source"
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value as SourceLangSetting)}
              >
                <option value="auto">{t('autoDetect')}</option>
                {INTERPRET_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </FieldSelect>
            </div>
            <p className="text-[13px] leading-snug text-text-faint">{t('sourceHint')}</p>
          </div>

          <span
            aria-hidden
            className="hidden self-center pt-9 text-text-faint sm:block"
          >
            <ArrowRight size={18} />
          </span>

          <div className="flex flex-col gap-2">
            <label htmlFor="m-target" className="text-[15px] font-semibold">
              {t('targetLang')}
            </label>
            <div className="flex items-center gap-2.5">
              <span className="icon-chip icon-chip-accent" aria-hidden>
                <span className="text-[15px] font-bold">A</span>
              </span>
              <FieldSelect
                id="m-target"
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value as LangCode)}
              >
                {INTERPRET_LANGUAGES.filter((l) => TRANSLATE_TARGET_LANGS.includes(l.code)).map(
                  (l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ),
                )}
              </FieldSelect>
            </div>
            <p className="text-[13px] leading-snug text-text-faint">{t('targetHint')}</p>
          </div>
        </div>

        {/* 봇 동작 안내 — 봇의 존재를 숨기지 않는다 (docs/08 §2.2) */}
        <div className="flex items-center gap-3.5 rounded-xl border border-border bg-bg-sunken px-4 py-3.5">
          <span className="icon-chip icon-chip-teal" aria-hidden>
            <ShieldCheck size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px] font-semibold">{t('botRow.title')}</p>
            <p className="text-[13px] text-text-faint">{t('botRow.body')}</p>
          </div>
          <span className="hidden shrink-0 items-center gap-1.5 text-[13px] font-semibold text-accent-2 sm:flex">
            <ShieldCheck size={14} aria-hidden />
            {t('botRow.badge')}
          </span>
        </div>
      </section>

      <div className="flex flex-col gap-3">
        <button
          onClick={send}
          disabled={!platform || busy}
          className="btn-gradient-violet flex h-16 items-center justify-center gap-2.5 rounded-xl text-[19px] font-bold transition-opacity duration-150 disabled:cursor-not-allowed"
        >
          <Bot size={21} aria-hidden />
          {busy ? t('sending') : t('send')}
        </button>
        <p className="flex items-center justify-center gap-1.5 text-[13.5px] text-text-faint">
          <Lock size={13} aria-hidden />
          {t('consentNotice')}
        </p>
      </div>

      {live ? (
        <section className="flex flex-col gap-4 rounded-xl border border-accent bg-accent-weak/20 p-6">
          <div>
            <p className="text-[17px] font-semibold">{t('live.title')}</p>
            <p className="mt-1 text-[14px] text-text-muted">{t('live.hint')}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              value={live.viewerUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="h-12 min-w-0 flex-1 rounded-lg border border-border bg-bg-raised px-3 text-[14px]"
            />
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(live.viewerUrl).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="h-12 shrink-0 rounded-lg border border-border px-4 text-[14px] font-semibold"
            >
              {copied ? t('live.copied') : t('live.copy')}
            </button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <a
              href={live.viewerUrl}
              target="_blank"
              rel="noopener"
              className="flex h-12 flex-1 items-center justify-center rounded-lg border border-border text-[15px] font-semibold"
            >
              {t('live.open')}
            </a>
            <button
              onClick={stop}
              disabled={busy}
              className="h-12 flex-1 rounded-lg bg-warn/15 text-[15px] font-bold text-warn disabled:opacity-60"
            >
              {busy ? t('live.stopping') : t('live.stop')}
            </button>
          </div>
        </section>
      ) : null}

      {error ? (
        <div className="flex gap-4 rounded-xl border border-warn/40 bg-warn/10 p-5">
          <Info size={20} aria-hidden className="mt-0.5 shrink-0 text-warn" />
          <div>
            <p className="text-[15px] font-semibold">{t('failed.title')}</p>
            <p className="mt-1 text-[14px] text-text-muted">{failedText(error)}</p>
          </div>
        </div>
      ) : null}

      {result === 'unavailable' ? (
        <div className="flex gap-4 rounded-xl border border-border bg-bg-raised p-6">
          <Info size={20} aria-hidden className="mt-0.5 shrink-0 text-text-muted" />
          <div>
            <p className="text-[16px] font-semibold">{t('unavailable.title')}</p>
            <p className="mt-1.5 text-[14.5px] text-text-muted">{t('unavailable.body')}</p>
            {missing.length > 0 ? (
              <p className="mt-2 font-mono text-[13px] text-warn">{missing.join(' · ')}</p>
            ) : null}
            <p className="mt-2 text-[13px] text-text-faint">{t('unavailable.docs')}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
