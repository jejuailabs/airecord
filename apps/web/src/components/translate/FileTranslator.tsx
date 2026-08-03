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
import type { TranslateFileResponse, TranslateLayoutResponse } from '@sotong/shared/schemas';
import { FieldSelect } from '@/components/ui/SettingRow';
import { extractPdfPages, fileToDataUrl, renderPdfPagesToImages } from '@/lib/pdf/extract';
import { listDrafts, removeDraft, saveDraft, type FileDraft } from '@/lib/translate/drafts';
import { translateDocx } from '@/lib/docx/translate';
import type { DocxMode } from '@/lib/docx/transform';
import { translateHwpx } from '@/lib/hwpx/translate';

/**
 * 'docxReady' — 워드·한글 문서는 결과가 화면 글이 아니라 **파일**이다.
 * 그래서 고르자마자 번역하지 않고, 어떤 모양으로 받을지 먼저 묻는다.
 */
type Phase = 'idle' | 'reading' | 'scanning' | 'translating' | 'done' | 'error' | 'docxReady';
type ErrorKey = 'unsupported' | 'tooLarge' | 'noTextLayer' | 'authRequired' | 'keyMissing' | 'failed';
/** 서식을 살려 파일로 되돌려주는 오피스 문서 종류 */
type DocKind = 'docx' | 'hwpx';

const MAX_MB = 10;
const ACCEPT = '.pdf,.docx,.hwpx,image/png,image/jpeg,image/webp';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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
  /** 고른 워드·한글 파일 — 어떤 모양으로 받을지 고를 때까지 들고 있는다 */
  const [docxFile, setDocxFile] = useState<File | null>(null);
  /** 그 파일이 워드인지 한글인지 — 되쓰기 방식이 다르다 */
  const [docKind, setDocKind] = useState<DocKind>('docx');
  /** 지금 굽고 있는 모양 (버튼별 진행 표시) */
  const [docxBusy, setDocxBusy] = useState<DocxMode | null>(null);
  const [docxRatio, setDocxRatio] = useState(0);
  /** 다 구운 결과 — blob을 들고 있어야 "다시 내려받기"가 재번역 없이 된다 */
  const [docxDone, setDocxDone] = useState<{
    mode: DocxMode;
    translated: number;
    missing: number;
    blob: Blob;
    fileName: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** 진행 중 작업 취소용 — 워드·PDF·이미지 모두 이걸로 끊는다 */
  const abortRef = useRef<AbortController | null>(null);
  /** 원본형 재구성(방법 B)에 쓸 원본 PDF 파일 — 페이지를 이미지로 다시 그려 비전에 보낸다 */
  const pdfFileRef = useRef<File | null>(null);
  /** 방금 결과가 PDF에서 온 것인가 — PDF만 원본형 재구성 버튼을 띄운다 */
  const [isPdfResult, setIsPdfResult] = useState(false);
  /** 원본형 재구성 진행 상태 ('replace'|'bilingual') */
  const [layoutBusy, setLayoutBusy] = useState<'replace' | 'bilingual' | null>(null);

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
    setDocxFile(null);
    setDocxBusy(null);
    setDocxDone(null);
    setDocxRatio(0);
    setIsPdfResult(false);
    setLayoutBusy(null);
    pdfFileRef.current = null;
  };

  /** 진행 중 번역을 끊는다 — fetch·문단 루프가 AbortSignal에서 멈춘다 */
  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  /**
   * 원본형 재구성 (방법 B) — 원본 PDF 페이지를 이미지로 다시 그려 비전 모델에 보내고,
   * 표·셀 색·구획을 재현한 HTML을 받아 인쇄 창에 띄운다. 거기서 "PDF로 저장"하면 된다.
   * 'bilingual' 대조본(원문+번역) · 'replace' 번역본(번역만).
   */
  const runLayout = async (mode: 'replace' | 'bilingual') => {
    const file = pdfFileRef.current;
    if (!file || layoutBusy) return;
    setError(null);
    setLayoutBusy(mode);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const pageImages = await renderPdfPagesToImages(file);
      const res = await fetch('/api/translate/layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          sourceLang,
          targetLang,
          mode,
          pageImages,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          body.error === 'auth_required'
            ? 'authRequired'
            : body.error === 'key_missing'
              ? 'keyMissing'
              : 'failed',
        );
        return;
      }
      const data = (await res.json()) as TranslateLayoutResponse;
      openLayoutWindow(data, t('printHint'));
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError('failed');
    } finally {
      setLayoutBusy(null);
      abortRef.current = null;
    }
  };

  /** blob을 파일로 내려준다 (완료 후 다시 눌러도 재번역 없이 즉시) */
  const downloadBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * 워드 문서를 굽는다.
   * 파일은 서버로 가지 않는다 — 여기서 ZIP을 풀고 문단 글자만 보낸 뒤 제자리에 되쓴다.
   */
  const runDocx = useCallback(
    async (mode: DocxMode) => {
      const file = docxFile;
      if (!file || docxBusy) return;
      setError(null);
      setDocxDone(null);
      setDocxBusy(mode);
      setDocxRatio(0);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        // 워드·한글은 되쓰기 방식이 달라 갈라 부른다 — 둘 다 같은 번역 API를 쓴다
        const run = docKind === 'hwpx' ? translateHwpx : translateDocx;
        const r = await run({
          file,
          mode,
          sourceLang,
          targetLang,
          onProgress: setDocxRatio,
          signal: controller.signal,
        });
        // 완료 즉시 한 번 내려주고, blob을 들고 있어 버튼으로 다시 받을 수 있게 한다
        downloadBlob(r.blob, r.fileName);
        setDocxDone({
          mode,
          translated: r.translated,
          missing: r.missing,
          blob: r.blob,
          fileName: r.fileName,
        });
      } catch (e) {
        // 사용자가 취소한 경우는 오류가 아니다 — 조용히 원래 화면으로 돌아간다
        if (e instanceof DOMException && e.name === 'AbortError') return;
        const msg = e instanceof Error ? e.message : '';
        setError(
          msg === 'auth_required'
            ? 'authRequired'
            : msg === 'key_missing'
              ? 'keyMissing'
              : msg === 'no_text' || msg === 'not_a_docx' || msg === 'not_a_hwpx'
                ? 'noTextLayer'
                : 'failed',
        );
      } finally {
        setDocxBusy(null);
        abortRef.current = null;
      }
    },
    [docxFile, docxBusy, docKind, sourceLang, targetLang],
  );

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
      const name = file.name.toLowerCase();
      const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
      const isImage = file.type.startsWith('image/');
      const isDocx = file.type === DOCX_MIME || name.endsWith('.docx');
      const isHwpx = name.endsWith('.hwpx');
      // 원본형 재구성(방법 B)은 PDF만 — 원본 파일을 들고 있다가 페이지를 이미지로 다시 그린다
      pdfFileRef.current = isPdf ? file : null;

      /**
       * 워드·한글은 여기서 멈춘다.
       * PDF·이미지는 화면에 글로 보여주는 게 결과지만, 이들은 **원본 서식을 살린 파일**이 결과다.
       * 번역본과 대조본은 되쓰는 방식이 다르므로 어느 쪽인지 먼저 정해야 한다.
       */
      if (isDocx || isHwpx) {
        setDocKind(isHwpx ? 'hwpx' : 'docx');
        setDocxFile(file);
        setDocxDone(null);
        setDocxRatio(0);
        setPhase('docxReady');
        return;
      }
      if (!isPdf && !isImage) {
        setError('unsupported');
        setPhase('error');
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
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
          signal: controller.signal,
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
        setIsPdfResult(isPdf); // PDF 결과에만 원본형 재구성 버튼을 띄운다
        // 유저가 따로 누르지 않아도 남긴다 — 놓치면 시간과 비용이 통째로 날아간다
        saveDraft(data, targetLang);
        setDrafts(listDrafts());
        setPhase('done');
      } catch (e) {
        // 취소는 오류가 아니다 — 업로드 화면으로 되돌린다
        if (e instanceof DOMException && e.name === 'AbortError') {
          reset();
          return;
        }
        setError('failed');
        setPhase('error');
      } finally {
        abortRef.current = null;
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

      {/*
        워드 문서 — 결과가 화면 글이 아니라 파일이라 여기서 갈라진다.
        두 버튼은 되쓰는 방식이 아예 달라서 토글이 아니라 나란한 두 개로 둔다.
      */}
      {phase === 'docxReady' && docxFile ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-bg-raised p-6">
          <div className="flex items-start gap-3">
            <span className="icon-chip icon-chip-accent shrink-0" aria-hidden>
              <FileText size={18} />
            </span>
            <div className="min-w-0">
              <p className="text-[17px] font-semibold">
                {docKind === 'hwpx' ? t('hwpxTitle') : t('docxTitle')}
              </p>
              <p className="mt-0.5 truncate text-[14px] text-text-muted">{docxFile.name}</p>
              <p className="mt-1.5 text-[13.5px] text-text-faint">{t('docxLead')}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                { mode: 'replace', label: t('docxReplace'), hint: t('docxReplaceHint'), icon: <FileDown size={17} /> },
                { mode: 'bilingual', label: t('docxBilingual'), hint: t('docxBilingualHint'), icon: <Rows3 size={17} /> },
              ] as const
            ).map((b) => (
              <button
                key={b.mode}
                onClick={() => void runDocx(b.mode)}
                disabled={docxBusy !== null}
                className={`flex flex-col items-start gap-1 rounded-xl border p-4 text-left transition-colors disabled:opacity-60 ${
                  b.mode === 'replace'
                    ? 'border-accent bg-accent-weak/30 hover:bg-accent-weak/50'
                    : 'border-border hover:bg-bg-sunken'
                }`}
              >
                <span className="flex items-center gap-2 text-[15px] font-bold">
                  {docxBusy === b.mode ? (
                    <Loader2 size={17} className="animate-spin" aria-hidden />
                  ) : (
                    <span aria-hidden>{b.icon}</span>
                  )}
                  {b.label}
                </span>
                <span className="text-[13px] text-text-muted">{b.hint}</span>
              </button>
            ))}
          </div>

          {docxBusy ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <p className="tabular flex-1 text-[13.5px] text-text-muted">
                  {t('docxWorking', { percent: Math.round(docxRatio * 100) })}
                </p>
                <button
                  onClick={cancel}
                  className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-semibold text-text-muted hover:border-danger hover:text-danger"
                >
                  <X size={14} aria-hidden />
                  {t('cancel')}
                </button>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-bg-sunken">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: `${Math.max(4, Math.round(docxRatio * 100))}%` }}
                />
              </div>
            </div>
          ) : null}

          {docxDone ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-bg-sunken px-4 py-3 text-[13.5px]">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {docxDone.mode === 'bilingual'
                    ? t('docxDoneBilingual', { translated: docxDone.translated })
                    : t('docxDoneReplace', { translated: docxDone.translated })}
                </p>
                {docxDone.missing > 0 ? (
                  <p className="mt-1 text-text-muted">
                    {t('docxMissing', { missing: docxDone.missing })}
                  </p>
                ) : null}
              </div>
              {/* 완료 후에도 남는 버튼 — 팝업이 막혔거나 놓쳐도 재번역 없이 다시 받는다 */}
              <button
                onClick={() => downloadBlob(docxDone.blob, docxDone.fileName)}
                className="btn-gradient flex h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-[14px] font-bold"
              >
                <FileDown size={15} aria-hidden />
                {t('download')}
              </button>
            </div>
          ) : null}

          <button
            onClick={reset}
            disabled={docxBusy !== null}
            className="self-start text-[14px] font-semibold text-text-muted hover:text-text disabled:opacity-60"
          >
            {t('docxOther')}
          </button>
        </div>
      ) : null}

      {/* 업로드 영역 */}
      {!result && phase !== 'docxReady' ? (
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
              <button
                onClick={cancel}
                className="flex h-10 items-center gap-1.5 rounded-lg border border-border px-4 text-[13.5px] font-semibold text-text-muted hover:border-danger hover:text-danger"
              >
                <X size={15} aria-hidden />
                {t('cancel')}
              </button>
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
                  <FileText size={12} aria-hidden />
                  DOCX · HWPX
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

          {/*
            원본형 재구성 (방법 B) — 표·셀 색·구획을 살려 원본 모양에 가깝게 다시 그린다.
            PDF에만 띄운다. 비전 모델이 페이지를 보고 HTML로 재현하므로 1~2분 걸릴 수 있고,
            숫자·값은 그대로 두되 레이아웃은 "똑같이"가 아니라 "비슷하고 깔끔하게"가 목표다.
          */}
          {isPdfResult ? (
            <div className="flex flex-col gap-2.5 rounded-xl border border-accent/40 bg-accent-weak/20 px-5 py-4">
              <div className="flex items-center gap-2">
                <p className="text-[14px] font-semibold">{t('layoutTitle')}</p>
                <span className="rounded-sm bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold text-warn">
                  {t('layoutExperimental')}
                </span>
              </div>
              <p className="text-[13px] text-text-muted">{t('layoutLead')}</p>
              <div className="flex flex-wrap gap-2">
                {(['replace', 'bilingual'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => void runLayout(m)}
                    disabled={layoutBusy !== null}
                    className={`flex h-11 items-center gap-2 rounded-xl border px-4 text-[14px] font-semibold transition-colors disabled:opacity-60 ${
                      m === 'bilingual'
                        ? 'border-accent bg-accent text-accent-text'
                        : 'border-border hover:border-border-strong'
                    }`}
                  >
                    {layoutBusy === m ? (
                      <Loader2 size={15} className="animate-spin" aria-hidden />
                    ) : (
                      <Rows3 size={15} aria-hidden />
                    )}
                    {m === 'bilingual' ? t('layoutBilingual') : t('layoutReplace')}
                  </button>
                ))}
                {layoutBusy ? (
                  <button
                    onClick={cancel}
                    className="flex h-11 items-center gap-1.5 rounded-xl border border-border px-4 text-[13.5px] font-semibold text-text-muted hover:border-danger hover:text-danger"
                  >
                    <X size={15} aria-hidden />
                    {t('cancel')}
                  </button>
                ) : null}
              </div>
              {layoutBusy ? (
                <p className="text-[12.5px] text-text-faint">{t('layoutWorking')}</p>
              ) : null}
            </div>
          ) : null}

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

/**
 * 원본형 재구성 결과를 인쇄 창에 띄운다 (방법 B).
 * 각 페이지의 HTML 조각(비전 모델이 그린 표·박스)을 A4 페이지로 감싸 나란히 놓고,
 * 브라우저 인쇄로 PDF 저장하게 한다. 조각은 서버에서 이미 살균됐다(layout.ts sanitizeHtml).
 */
function openLayoutWindow(data: TranslateLayoutResponse, hint: string) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.opener = null; // 새 창이 이 페이지를 건드리지 못하게 끊는다
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const pages = data.pages
    .map((p) =>
      p.html.trim()
        ? `<section class="page">${p.html}</section>`
        : `<section class="page"><p class="miss">${esc(`${p.page}쪽 재구성 실패`)}</p></section>`,
    )
    .join('');
  const doc = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(data.fileName)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>
@page { size: A4; margin: 12mm; }
body { font-family:'Pretendard Variable',Pretendard,system-ui,sans-serif; color:#14172B; font-size:10.5pt; line-height:1.5; margin:0; }
.hint { background:#EDEAFD; color:#4B3FB5; padding:10px 14px; border-radius:8px; margin:14px; font-size:10pt; }
.page { padding:0 14px 24px; break-after:page; }
.page:last-child { break-after:auto; }
.page table { border-collapse:collapse; width:100%; }
.page td, .page th { border:1px solid #cfd3e0; padding:5px 7px; vertical-align:top; }
.miss { color:#b4472e; }
@media print { .hint { display:none; } }
</style></head><body>
<div class="hint">${esc(hint)}</div>
${pages}
<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},600);});</script>
</body></html>`;
  w.document.write(doc);
  w.document.close();
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
