'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  FileDown,
  FileText,
  Image as ImageIcon,
  Languages,
  Loader2,
  History,
  RotateCcw,
  Rows3,
  Upload,
  X,
} from 'lucide-react';
import { INTERPRET_LANGUAGES, TRANSLATE_TARGET_LANGS } from '@sotong/shared/constants';
import type { LangCode, SourceLangSetting } from '@sotong/shared/types';
import type { TranslateFileResponse } from '@sotong/shared/schemas';
import { FieldSelect } from '@/components/ui/SettingRow';
import { extractPdfPages, fileToDataUrl, renderPdfPagesToImages } from '@/lib/pdf/extract';
import { listDrafts, removeDraft, saveDraft, type FileDraft } from '@/lib/translate/drafts';

type Phase = 'idle' | 'reading' | 'scanning' | 'translating' | 'done' | 'error';
type ErrorKey = 'unsupported' | 'tooLarge' | 'noTextLayer' | 'authRequired' | 'keyMissing' | 'failed';

const MAX_MB = 10;
const ACCEPT = '.pdf,image/png,image/jpeg,image/webp';

export function FileTranslator() {
  const t = useTranslations('translateFile');

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<ErrorKey | null>(null);
  const [fileName, setFileName] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<TranslateFileResponse | null>(null);
  /**
   * 원문·번역을 한 문서에 번갈아 놓을지.
   * 기본은 꺼둔다 — 사람들이 기대하는 "번역문만"이 먼저 나와야 한다.
   * 켜면 이미 받아둔 문단 짝으로 즉시 다시 그린다 (API를 다시 부르지 않는다).
   */
  const [interleaved, setInterleaved] = useState(false);
  const [sourceLang, setSourceLang] = useState<SourceLangSetting>('auto');
  const [targetLang, setTargetLang] = useState<LangCode>('ko');
  const [dragging, setDragging] = useState(false);
  /**
   * 브라우저에 남아 있는 이전 번역 결과.
   * 번역은 수십 초가 걸리므로 실수로 화면을 벗어나도 되살릴 수 있어야 한다.
   */
  const [drafts, setDrafts] = useState<FileDraft[]>([]);
  /** 이번 결과가 OCR로 읽은 것인지 — 원문이 원본이 아님을 화면에 밝혀야 한다 */
  const [fromOcr, setFromOcr] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 서버 렌더에는 없는 값이라 마운트 후에 읽는다 (하이드레이션 어긋남 방지)
  useEffect(() => {
    setDrafts(listDrafts());
  }, []);

  const reset = () => {
    setPhase('idle');
    setError(null);
    setResult(null);
    setProgress(null);
    setFileName('');
  };

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setResult(null);
      setFileName(file.name);

      if (file.size > MAX_MB * 1024 * 1024) {
        setError('tooLarge');
        setPhase('error');
        return;
      }
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const isImage = file.type.startsWith('image/');
      if (!isPdf && !isImage) {
        setError('unsupported');
        setPhase('error');
        return;
      }

      try {
        let payload: Record<string, unknown>;
        if (isPdf) {
          setPhase('reading');
          const pages = await extractPdfPages(file, (done, total) => setProgress({ done, total }));
          const hasText = pages.some((p) => p.text.trim().length > 0);
          if (hasText) {
            setFromOcr(false);
            payload = { kind: 'pdf', fileName: file.name, sourceLang, targetLang, pages };
          } else {
            /**
             * 글자 정보가 없는 스캔본 — 예전에는 여기서 막고 "이미지로 저장해 올리라"고 떠넘겼다.
             * 페이지를 직접 그려 넘기면 유저가 캡처할 필요가 없다.
             */
            setPhase('scanning');
            const pageImages = await renderPdfPagesToImages(file, (done, total) =>
              setProgress({ done, total }),
            );
            if (pageImages.length === 0) {
              setError('noTextLayer');
              setPhase('error');
              return;
            }
            payload = { kind: 'pdf-scan', fileName: file.name, sourceLang, targetLang, pageImages };
            setFromOcr(true);
          }
        } else {
          setPhase('reading');
          const dataUrl = await fileToDataUrl(file);
          payload = { kind: 'image', fileName: file.name, sourceLang, targetLang, dataUrl };
        }

        setPhase('translating');
        setProgress(null);
        const res = await fetch('/api/translate/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(
            body.error === 'no_text_layer'
              ? 'noTextLayer'
              : body.error === 'auth_required'
                ? 'authRequired'
                : body.error === 'key_missing'
                  ? 'keyMissing'
                  : 'failed',
          );
          setPhase('error');
          return;
        }
        const data = (await res.json()) as TranslateFileResponse;
        setResult(data);
        // 유저가 따로 누르지 않아도 남긴다 — 놓치면 시간과 비용이 통째로 날아간다
        saveDraft(data, targetLang);
        setDrafts(listDrafts());
        setPhase('done');
      } catch {
        setError('failed');
        setPhase('error');
      }
    },
    [sourceLang, targetLang],
  );

  const busy = phase === 'reading' || phase === 'scanning' || phase === 'translating';

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 py-2">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <span
          className="cta-orb-teal flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white"
          style={{
            boxShadow: '0 8px 20px -8px rgb(45 212 191 / .6), inset 0 1px 0 rgb(255 255 255 / .3)',
          }}
          aria-hidden
        >
          <FileText size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight sm:text-[30px]">
            {t('title')}
          </h1>
          <p className="text-[14px] text-text-muted">{t('lead')}</p>
        </div>
        {result ? (
          <button
            onClick={reset}
            className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-border px-4 text-[14px] font-semibold text-text-muted hover:text-text"
          >
            <RotateCcw size={15} aria-hidden />
            {t('newFile')}
          </button>
        ) : null}
      </div>

      {/* 언어 */}
      <div className="flex items-center gap-2 rounded-xl border border-border bg-bg-raised p-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="icon-chip hidden sm:inline-flex" aria-hidden>
            <Languages size={18} />
          </span>
          <FieldSelect
            aria-label={t('sourceLang')}
            value={sourceLang}
            onChange={(e) => setSourceLang(e.target.value as SourceLangSetting)}
            disabled={busy}
          >
            <option value="auto">{t('autoDetect')}</option>
            {INTERPRET_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </FieldSelect>
        </div>
        <span aria-hidden className="shrink-0 text-text-faint">
          →
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="icon-chip icon-chip-accent hidden sm:inline-flex" aria-hidden>
            <span className="text-[15px] font-bold">A</span>
          </span>
          <FieldSelect
            aria-label={t('targetLang')}
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value as LangCode)}
            disabled={busy}
          >
            {INTERPRET_LANGUAGES.filter((l) => TRANSLATE_TARGET_LANGS.includes(l.code)).map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </FieldSelect>
        </div>
      </div>

      {/*
        이전 작업 — 저장 안 하고 화면을 벗어났어도 여기서 되살린다.
        번역은 수십 초가 걸리므로 놓치면 시간과 비용이 통째로 날아간다.
      */}
      {!result && drafts.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-bg-raised p-3">
          <p className="px-1 text-[12px] font-semibold uppercase tracking-wider text-text-faint">
            {t('recentTitle')}
          </p>
          <div className="flex flex-wrap gap-2">
            {drafts.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-1 rounded-xl border border-border bg-bg-sunken pl-1"
              >
                <button
                  onClick={() => {
                    setResult(d.result);
                    setFileName(d.fileName);
                    setTargetLang(d.targetLang as LangCode);
                    setPhase('done');
                  }}
                  className="flex h-10 items-center gap-2 rounded-lg px-3 text-[13.5px] font-semibold hover:text-accent"
                >
                  <History size={14} aria-hidden className="shrink-0 text-accent" />
                  <span className="max-w-[190px] truncate">{d.fileName}</span>
                  <span className="tabular shrink-0 text-[12px] font-normal text-text-faint">
                    {t('pages', { count: d.pageCount })}
                  </span>
                </button>
                <button
                  onClick={() => {
                    removeDraft(d.id);
                    setDrafts(listDrafts());
                  }}
                  aria-label={t('removeDraft')}
                  title={t('removeDraft')}
                  className="flex h-10 w-8 items-center justify-center text-text-faint hover:text-danger"
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
            ))}
          </div>
          <p className="px-1 text-[12px] text-text-faint">{t('recentNote')}</p>
        </div>
      ) : null}

      {/* 업로드 영역 */}
      {!result ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f && !busy) void handleFile(f);
          }}
          className={`flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors duration-150 ${
            dragging ? 'border-accent bg-accent-weak/30' : 'border-border bg-bg-raised'
          }`}
        >
          {busy ? (
            <>
              <Loader2 size={30} className="animate-spin text-accent" aria-hidden />
              <div>
                <p className="text-[17px] font-semibold">
                  {phase === 'reading'
                    ? t('reading')
                    : phase === 'scanning'
                      ? t('scanning')
                      : t('translating')}
                </p>
                <p className="mt-1 text-[14px] text-text-muted">{fileName}</p>
                {progress ? (
                  <p className="tabular mt-1 text-[13px] text-text-faint">
                    {t('pageProgress', { done: progress.done, total: progress.total })}
                  </p>
                ) : null}
              </div>
              {phase === 'translating' ? (
                <div className="h-1.5 w-56 overflow-hidden rounded-full bg-bg-sunken">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
                </div>
              ) : null}
            </>
          ) : (
            <>
              <span className="icon-chip icon-chip-accent h-14 w-14" aria-hidden>
                <Upload size={24} />
              </span>
              <div>
                <p className="text-[18px] font-semibold">{t('dropTitle')}</p>
                <p className="mt-1 text-[14px] text-text-muted">{t('dropHint', { mb: MAX_MB })}</p>
              </div>
              <button
                onClick={() => inputRef.current?.click()}
                className="btn-gradient flex h-12 items-center gap-2 rounded-xl px-6 text-[15px] font-bold"
              >
                <Upload size={17} aria-hidden />
                {t('choose')}
              </button>
              <div className="flex flex-wrap justify-center gap-2 text-[12.5px] text-text-faint">
                <span className="flex items-center gap-1 rounded-md bg-bg-sunken px-2 py-1">
                  <FileText size={12} aria-hidden />
                  PDF
                </span>
                <span className="flex items-center gap-1 rounded-md bg-bg-sunken px-2 py-1">
                  <ImageIcon size={12} aria-hidden />
                  PNG · JPG · WEBP
                </span>
              </div>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = '';
            }}
          />
        </div>
      ) : null}

      {/* 오류 */}
      {error ? (
        <div className="flex gap-3 rounded-xl bg-danger-weak px-5 py-4">
          <AlertTriangle size={18} aria-hidden className="mt-0.5 shrink-0 text-danger" />
          <div>
            <p className="text-[15px] font-semibold text-danger">{t(`errors.${error}.title`)}</p>
            <p className="text-[13.5px] text-text-muted">{t(`errors.${error}.action`)}</p>
          </div>
        </div>
      ) : null}

      {/* 결과 — 원문·번역 대조 */}
      {result ? (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-bg-raised px-5 py-3.5">
            <FileText size={18} aria-hidden className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
              {result.fileName}
            </span>
            <span className="tabular shrink-0 text-[13px] text-text-muted">
              {t('pages', { count: result.pages.length })} · {result.totalChars.toLocaleString()}
              {t('chars')}
            </span>
            {result.pages.some((p) => p.pairs?.length) ? (
              <button
                onClick={() => setInterleaved((v) => !v)}
                aria-pressed={interleaved}
                className={`flex h-11 shrink-0 items-center gap-2 rounded-xl border px-4 text-[14px] font-semibold transition-colors duration-150 ${
                  interleaved
                    ? 'border-accent bg-accent-weak text-accent'
                    : 'border-border text-text-muted'
                }`}
              >
                <Rows3 size={15} aria-hidden />
                {interleaved ? t('splitBack') : t('mergeWithSource')}
              </button>
            ) : null}
            <a
              href={`/api/translate/file/pdf?name=${encodeURIComponent(result.fileName)}`}
              onClick={(e) => {
                e.preventDefault();
                const w = window.open('', '_blank');
                if (!w) return;
                w.document.write(buildPrintable(result, t('printHint'), interleaved));
                w.document.close();
              }}
              className="btn-gradient flex h-11 shrink-0 items-center gap-2 rounded-xl px-5 text-[14px] font-bold"
            >
              <FileDown size={15} aria-hidden />
              {t('downloadPdf')}
            </a>
          </div>

          {fromOcr ? (
            <p className="flex items-start gap-2.5 rounded-xl border border-warn/40 bg-warn-weak px-4 py-3 text-[13.5px] text-warn">
              <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0" />
              {t('ocrNote')}
            </p>
          ) : null}

          {result.pages.map((p) => (
            <section key={p.page} className="flex flex-col gap-2">
              <h2 className="text-[13px] font-semibold uppercase tracking-wider text-text-muted">
                {t('page', { page: p.page })}
              </h2>
              {p.notes?.length ? (
                <div className="flex gap-2.5 rounded-xl border border-border bg-bg-raised px-4 py-3">
                  <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0 text-warn" />
                  <ul className="flex flex-col gap-0.5">
                    {p.notes.map((n, i) => (
                      <li key={i} className="text-[13px] text-text-muted">
                        {n}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {interleaved && p.pairs?.length ? (
                /* 한 문서에 원문 → 번역 → 원문 → 번역 순으로 번갈아 */
                <div className="flex flex-col gap-4 rounded-2xl border border-border bg-bg-raised p-5">
                  {p.pairs.map((pair, i) => (
                    <div key={i} className="flex flex-col gap-1">
                      <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed text-text-muted">
                        {pair.source}
                      </p>
                      <p className="whitespace-pre-wrap text-[15px] font-medium leading-relaxed">
                        {pair.translated || '—'}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-2xl border border-border bg-bg-sunken p-5">
                    <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-text-faint">
                      {t('original')}
                    </p>
                    <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-text-muted">
                      {p.source}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border bg-bg-raised p-5">
                    <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-accent">
                      {t('translated')}
                    </p>
                    <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{p.translated}</p>
                  </div>
                </div>
              )}
            </section>
          ))}
        </>
      ) : null}
    </div>
  );
}

/** 인쇄용 HTML — 서버에서 PDF를 굽지 않고 브라우저 인쇄로 저장한다 (한글 폰트 문제 회피) */
function buildPrintable(
  result: TranslateFileResponse,
  hint: string,
  interleaved = false,
): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = result.pages
    .map((p) => {
      // 합치기 모드 — 한 문서에 원문 → 번역 순으로 번갈아 흐르게 한다 (표가 아니라 본문 흐름)
      if (interleaved && p.pairs?.length) {
        const body = p.pairs
          .map(
            (pair) =>
              `<div class="pair"><p class="src">${esc(pair.source).replace(/\n/g, '<br>')}</p>` +
              `<p class="tgt">${esc(pair.translated).replace(/\n/g, '<br>')}</p></div>`,
          )
          .join('');
        return `<h2>Page ${p.page}</h2>${body}`;
      }
      return `<h2>Page ${p.page}</h2>
<table><thead><tr><th>원문</th><th>번역</th></tr></thead><tbody>
<tr><td class="src">${esc(p.source).replace(/\n/g, '<br>')}</td><td>${esc(p.translated).replace(/\n/g, '<br>')}</td></tr>
</tbody></table>`;
    })
    .join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(result.fileName)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>
@page { size: A4; margin: 16mm; }
body { font-family:'Pretendard Variable',Pretendard,system-ui,sans-serif; color:#14172B; font-size:10.5pt; line-height:1.6; }
h1 { font-size:18pt; margin:0 0 4px; }
h2 { font-size:11pt; margin:18px 0 6px; color:#6D5AE8; }
.meta { color:#5A6079; font-size:9pt; margin-bottom:14px; }
table { width:100%; border-collapse:collapse; }
th { text-align:left; font-size:8.5pt; color:#5A6079; text-transform:uppercase; border-bottom:1px solid #E2E5F0; padding:5px 6px; }
td { vertical-align:top; padding:8px 6px; border-bottom:1px solid #F0F1F6; width:50%; }
td.src { color:#5A6079; }
/* 합치기 모드 — 원문은 흐리게, 번역은 진하게. 문단 짝이 눈에 붙어 보이게 간격을 준다 */
.pair { margin:0 0 12px; break-inside:avoid; }
.pair .src { color:#5A6079; margin:0 0 2px; }
.pair .tgt { color:#14172B; font-weight:500; margin:0; }
.hint { background:#EDEAFD; color:#4B3FB5; padding:10px 14px; border-radius:8px; margin-bottom:16px; font-size:10pt; }
@media print { .hint { display:none; } }
</style></head><body>
<div class="hint">${esc(hint)}</div>
<h1>${esc(result.fileName)}</h1>
<div class="meta">InterLive · ${result.pages.length} pages · ${result.totalChars.toLocaleString()} chars</div>
${rows}
<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},500);});</script>
</body></html>`;
}
