'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowLeftRight,
  Check,
  Copy,
  Globe,
  Info,
  Languages,
  Loader2,
  Trash2,
  Type,
} from 'lucide-react';
import { INTERPRET_LANGUAGES, TRANSLATE_TARGET_LANGS, languageLabel } from '@sotong/shared/constants';
import type { LangCode, SourceLangSetting } from '@sotong/shared/types';
import type { TranslateTextResponse } from '@sotong/shared/schemas';
import { FieldSelect } from '@/components/ui/SettingRow';
import { Link } from '@/i18n/navigation';

const MAX_CHARS = 5000;
const DEBOUNCE_MS = 700;
type Tone = 'plain' | 'formal' | 'casual';
type ErrorKey = 'keyMissing' | 'failed' | 'quota' | 'tooLong';

export function TextTranslator() {
  const t = useTranslations('translateText');

  const [source, setSource] = useState('');
  const [result, setResult] = useState<TranslateTextResponse | null>(null);
  const [sourceLang, setSourceLang] = useState<SourceLangSetting>('auto');
  const [targetLang, setTargetLang] = useState<LangCode>('en');
  const [tone, setTone] = useState<Tone>('plain');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [copied, setCopied] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);
  /** 같은 내용·같은 설정으로 두 번 호출하지 않는다 (비회원 글자 한도가 낭비된다) */
  const lastKeyRef = useRef('');

  const run = useCallback(
    async (text: string, sl: SourceLangSetting, tl: LangCode, tn: Tone) => {
      if (!text.trim()) {
        setResult(null);
        setError(null);
        lastKeyRef.current = '';
        return;
      }
      const key = `${sl}|${tl}|${tn}|${text}`;
      if (key === lastKeyRef.current) return;
      lastKeyRef.current = key;
      const id = ++reqIdRef.current;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch('/api/translate/text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, sourceLang: sl, targetLang: tl, tone: tn }),
        });
        if (id !== reqIdRef.current) return; // 더 최근 요청이 있다
        if (!res.ok) {
          lastKeyRef.current = ''; // 실패했으면 다시 시도할 수 있게 한다
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(
            body.error === 'key_missing'
              ? 'keyMissing'
              : body.error === 'guest_quota_exhausted'
                ? 'quota'
                : body.error === 'guest_quota_too_long'
                  ? 'tooLong'
                  : 'failed',
          );
          return;
        }
        setResult((await res.json()) as TranslateTextResponse);
      } catch {
        if (id === reqIdRef.current) setError('failed');
      } finally {
        if (id === reqIdRef.current) setBusy(false);
      }
    },
    [],
  );

  // 입력이 멈추면 자동으로 번역한다 (버튼을 누르게 하지 않는다 — core.md §3-1)
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void run(source, sourceLang, targetLang, tone), DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [source, sourceLang, targetLang, tone, run]);

  const swap = () => {
    // 자동 감지 상태면 감지된 언어를 입력으로 되돌린다
    const detected = result?.detectedLang as LangCode | undefined;
    const nextTarget =
      sourceLang === 'auto'
        ? detected && TRANSLATE_TARGET_LANGS.includes(detected)
          ? detected
          : targetLang
        : (sourceLang as LangCode);
    setSourceLang(targetLang);
    setTargetLang(nextTarget);
    setSource(result?.translated ?? '');
    setResult(null);
  };

  const copy = async () => {
    if (!result?.translated) return;
    await navigator.clipboard.writeText(result.translated);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const detectedLabel =
    sourceLang === 'auto' && result?.detectedLang
      ? t('detected', { lang: languageLabel(result.detectedLang as SourceLangSetting) })
      : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 py-2">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <span
          className="cta-orb-violet flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white"
          style={{
            boxShadow: '0 8px 20px -8px rgb(124 77 255 / .6), inset 0 1px 0 rgb(255 255 255 / .3)',
          }}
          aria-hidden
        >
          <Type size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight sm:text-[30px]">
            {t('title')}
          </h1>
          <p className="text-[14px] text-text-muted">{t('lead')}</p>
        </div>
      </div>

      {/* 언어 바 */}
      <div className="flex items-center gap-2 rounded-xl border border-border bg-bg-raised p-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="icon-chip hidden sm:inline-flex" aria-hidden>
            <Globe size={18} />
          </span>
          <FieldSelect
            aria-label={t('sourceLang')}
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

        <button
          onClick={swap}
          aria-label={t('swap')}
          title={t('swap')}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border text-text-muted hover:text-text"
        >
          <ArrowLeftRight size={18} aria-hidden />
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="icon-chip icon-chip-accent hidden sm:inline-flex" aria-hidden>
            <Languages size={18} />
          </span>
          <FieldSelect
            aria-label={t('targetLang')}
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value as LangCode)}
          >
            {INTERPRET_LANGUAGES.filter((l) => TRANSLATE_TARGET_LANGS.includes(l.code)).map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </FieldSelect>
        </div>
      </div>

      {/* 입력 · 출력 */}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* 입력 */}
        <div className="flex flex-col rounded-2xl border border-border bg-bg-raised">
          <textarea
            value={source}
            onChange={(e) => setSource(e.target.value.slice(0, MAX_CHARS))}
            placeholder={t('placeholder')}
            spellCheck={false}
            className="min-h-[260px] flex-1 resize-none rounded-t-2xl bg-transparent p-5 text-[17px] leading-relaxed outline-none placeholder:text-text-faint"
          />
          <div className="flex items-center gap-2 border-t border-border px-4 py-2.5">
            {detectedLabel ? (
              <span className="truncate text-[13px] text-accent">{detectedLabel}</span>
            ) : null}
            <span className="tabular ml-auto shrink-0 text-[13px] text-text-faint">
              {source.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
            </span>
            {source ? (
              <button
                onClick={() => {
                  setSource('');
                  setResult(null);
                }}
                aria-label={t('clear')}
                title={t('clear')}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-faint hover:text-text"
              >
                <Trash2 size={15} aria-hidden />
              </button>
            ) : null}
          </div>
        </div>

        {/* 출력 */}
        <div className="flex flex-col rounded-2xl border border-border bg-bg-sunken">
          <div className="relative min-h-[260px] flex-1 p-5">
            {result?.translated ? (
              <p className="whitespace-pre-wrap text-[17px] leading-relaxed">{result.translated}</p>
            ) : (
              <p className="text-[17px] text-text-faint">{busy ? '' : t('outputEmpty')}</p>
            )}
            {busy ? (
              <span className="absolute right-4 top-4 flex items-center gap-1.5 text-[13px] text-text-muted">
                <Loader2 size={14} className="animate-spin" aria-hidden />
                {t('translating')}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2 border-t border-border px-4 py-2.5">
            <span className="truncate text-[13px] text-text-faint">
              {result?.remainingChars != null
                ? t('guestRemaining', { chars: result.remainingChars })
                : ''}
            </span>
            <button
              onClick={copy}
              disabled={!result?.translated}
              className="ml-auto flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-semibold text-text-muted disabled:opacity-40"
            >
              {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
              {copied ? t('copied') : t('copy')}
            </button>
          </div>
        </div>
      </div>

      {/* 문체 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-text-muted">{t('tone')}</span>
        <div role="radiogroup" aria-label={t('tone')} className="flex items-center gap-1">
          {(['plain', 'formal', 'casual'] as const).map((v) => (
            <button
              key={v}
              role="radio"
              aria-checked={tone === v}
              onClick={() => setTone(v)}
              className={`h-9 rounded-lg px-3 text-[13px] font-semibold transition-colors duration-150 ${
                tone === v
                  ? 'bg-accent text-accent-text'
                  : 'border border-border text-text-muted hover:text-text'
              }`}
            >
              {t(`tones.${v}`)}
            </button>
          ))}
        </div>
      </div>

      {/* 확인이 필요한 부분 — 정확도가 관건이므로 숨기지 않는다 */}
      {result?.notes?.length ? (
        <div className="flex gap-3 rounded-xl border border-border bg-bg-raised p-4">
          <Info size={17} aria-hidden className="mt-0.5 shrink-0 text-warn" />
          <div>
            <p className="text-[14px] font-semibold">{t('notesTitle')}</p>
            <ul className="mt-1 flex flex-col gap-1">
              {result.notes.map((n, i) => (
                <li key={i} className="text-[13.5px] text-text-muted">
                  · {n}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl bg-danger-weak px-5 py-4">
          <p className="text-[15px] font-semibold text-danger">{t(`errors.${error}.title`)}</p>
          <p className="text-[13.5px] text-text-muted">{t(`errors.${error}.action`)}</p>
          {error === 'quota' || error === 'tooLong' ? (
            <Link href="/login" className="mt-2 inline-block text-[13.5px] font-semibold text-accent">
              {t('errors.signupCta')}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
