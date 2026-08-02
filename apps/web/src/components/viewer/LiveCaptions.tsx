'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Radio, Volume2, VolumeX } from 'lucide-react';

/**
 * 회의 자막 뷰어 (docs/06 §2.4).
 *
 * 링크만으로 들어온 참가자가 보는 화면이다. 로그인 유도 없음 — 읽기(+선택적 음성)만.
 *
 * 대면(live)과 같은 체감을 준다:
 *   · 확정 줄은 이어 받아 쌓고(`after=마지막 seq`),
 *   · 아직 확정 전 "쌓이는 중" 번역은 livePartial로 받아 맨 아래 실시간 줄로 보여준다.
 *   · 음성 버튼을 켜면 새로 확정되는 번역을 브라우저 음성으로 읽어준다.
 */
const POLL_MS = 1_000;
/** 화면에 남기는 최대 줄 수 — 무한히 쌓으면 폰에서 스크롤이 무거워진다 */
const MAX_ROWS = 300;
/**
 * 원문↔번역 정렬 주기 — 대면(LiveInterpreter)과 같은 12초.
 * 정렬은 화면을 기다리게 하지 않는다: raw 줄은 즉시 흐르고, 정렬이 따라잡으면
 * 그 줄들이 "번역+원문 한 묶음"으로 합쳐진다.
 */
const ALIGN_MS = 12_000;
/** 한 번에 정렬기에 보내는 최대 줄 수 (align API 스키마 상한 60, 대면은 40) */
const ALIGN_WINDOW = 40;

/** 표시 언어 → 음성(TTS) 로케일. 없으면 원래 코드를 그대로 쓴다. */
const TTS_LOCALE: Record<string, string> = {
  ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN', es: 'es-ES', fr: 'fr-FR',
  de: 'de-DE', pt: 'pt-BR', it: 'it-IT', ru: 'ru-RU', ar: 'ar-SA', hi: 'hi-IN',
  id: 'id-ID', vi: 'vi-VN', th: 'th-TH',
};

interface Row {
  seq: number;
  sourceText: string;
  targetText: string;
}

export function LiveCaptions({
  token,
  initialLang,
  langOptions,
  labels,
}: {
  token: string;
  /**
   * 이 뷰어의 시작 표시 언어 — 서버가 브라우저 언어·세션 언어쌍으로 자동 판단한다.
   * 상대방은 아무것도 고르지 않아도 자기 언어로 보인다 (사용자 지시 2026-08-02).
   */
  initialLang: string;
  /** 표시 언어 선택지 — 제3의 언어 참가자용 보조 수단 */
  langOptions: Array<{ code: string; label: string }>;
  labels: {
    waiting: string;
    ended: string;
    invalid: string;
    save: string;
    saveName: string;
    speakOn: string;
    speakOff: string;
    langLabel: string;
  };
}) {
  const [lang, setLang] = useState(initialLang);
  const [rows, setRows] = useState<Row[]>([]);
  const [live, setLive] = useState(''); // 쌓이는 중 번역 줄
  const [status, setStatus] = useState<'live' | 'ended' | 'invalid'>('live');
  const [speaking, setSpeaking] = useState(false);
  const lastSeq = useRef(-1);
  const bottom = useRef<HTMLDivElement | null>(null);
  /** 다운로드용 전체 누적 — 화면(rows)은 300줄로 잘라도 저장은 회의 전체를 담는다. */
  const allRows = useRef<Map<number, Row>>(new Map());
  /** 음성 상태·이미 읽은 줄 — tick 클로저에서 최신값을 보려고 ref로 둔다 */
  const speakingRef = useRef(false);
  const spokenSeqs = useRef<Set<number>>(new Set());
  /**
   * 원문↔번역 정렬(대면과 동일한 2층).
   * paired — 정렬기가 짝지어 합친 줄. consumed — 짝으로 소비돼 raw 표시에서 빠지는 seq들.
   * 정렬 실패는 조용히 넘어간다: raw 줄이 그대로 남아 있으니 화면은 항상 흐른다.
   */
  const [paired, setPaired] = useState<Row[]>([]);
  const consumedRef = useRef<Set<number>>(new Set());
  const alignBusyRef = useRef(false);
  const statusRef = useRef<'live' | 'ended' | 'invalid'>('live');

  const speak = (text: string) => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth || !text.trim()) return;
    const u = new SpeechSynthesisUtterance(text);
    // 음성도 내가 보는 언어로 읽는다 — 기본 언어가 아니라 선택된 표시 언어
    u.lang = TTS_LOCALE[lang] ?? lang;
    synth.speak(u);
  };

  const toggleSpeak = () => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    const next = !speaking;
    setSpeaking(next);
    speakingRef.current = next;
    if (next) {
      // 지금까지 쌓인 줄(백로그)은 읽지 않는다 — 지금부터 확정되는 줄만 읽는다
      for (const seq of allRows.current.keys()) spokenSeqs.current.add(seq);
      synth?.resume?.(); // 사용자 제스처 안에서 잠금 해제
    } else {
      synth?.cancel();
    }
  };

  const download = () => {
    const sorted = [...allRows.current.values()].sort((a, b) => a.seq - b.seq);
    if (sorted.length === 0) return;
    const body = sorted
      .map((r) => (r.sourceText ? `${r.targetText}\n(${r.sourceText})` : r.targetText))
      .join('\n\n');
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([`﻿${body}\n`], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${labels.saveName}-${stamp}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    /**
     * 표시 언어가 바뀌면 처음부터 다시 받는다 — 서버가 그 언어로 재번역해 내려준다.
     * (캐시 덕에 이미 한 번 본 언어는 재과금 없이 즉시 온다)
     */
    lastSeq.current = -1;
    allRows.current.clear();
    consumedRef.current.clear();
    spokenSeqs.current.clear();
    setRows([]);
    setPaired([]);
    setLive('');

    const tick = async () => {
      try {
        const res = await fetch(`/api/viewer/${token}?after=${lastSeq.current}&lang=${lang}`, {
          cache: 'no-store',
        });
        if (!alive) return;
        if (res.status === 404) {
          setStatus('invalid');
          statusRef.current = 'invalid';
          return;
        }
        if (res.ok) {
          const json = (await res.json()) as {
            status: string;
            segments: Array<{ seq: number; sourceText: string; targetText: string }>;
            livePartial: { text: string; seq: number } | null;
          };
          if (json.segments.length > 0) {
            lastSeq.current = json.segments[json.segments.length - 1]!.seq;
            for (const s of json.segments) allRows.current.set(s.seq, s);
            setRows((prev) => [...prev, ...json.segments].slice(-MAX_ROWS));
            // 음성이 켜져 있으면 새로 확정된 번역(target)만 읽는다
            if (speakingRef.current) {
              for (const s of json.segments) {
                if (s.targetText && !spokenSeqs.current.has(s.seq)) {
                  spokenSeqs.current.add(s.seq);
                  speak(s.targetText);
                }
              }
            }
          }
          setLive(json.livePartial?.text ?? '');
          const next = json.status === 'ended' ? ('ended' as const) : ('live' as const);
          setStatus(next);
          statusRef.current = next;
          if (json.status === 'ended' && json.segments.length === 0) return;
        }
      } catch {
        /* 네트워크 흔들림 — 다음 주기에 다시 시도한다 */
      }
      if (alive) timer = setTimeout(() => void tick(), POLL_MS);
    };

    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, lang]);

  /**
   * 정렬 루프 — 대면(LiveInterpreter.finalAlign)과 같은 방식.
   * 12초마다 아직 짝 없는 원문·번역 줄(마지막 40개)을 /api/session/align에 보내
   * "몇 번 원문 ↔ 몇 번 번역" 대응표만 받아 합친다. 텍스트는 이어 붙이기만 한다 —
   * 고쳐 쓰면 실제 발화와 달라진다(align.ts의 원칙).
   * 회의가 끝나면 마지막 한 번 더 맞추고 멈춘다.
   */
  useEffect(() => {
    let alive = true;
    let finalDone = false;

    const alignTick = async () => {
      if (!alive || alignBusyRef.current) return;
      if (statusRef.current === 'invalid') return;
      if (statusRef.current === 'ended') {
        if (finalDone) return;
        finalDone = true; // 종료 후 마지막 1회
      }
      const unconsumed = [...allRows.current.values()].filter(
        (r) => !consumedRef.current.has(r.seq),
      );
      const src = unconsumed.filter((r) => r.sourceText.trim() && !r.targetText.trim());
      // 원문이 이미 붙어 있는 줄(워커가 짝지어 저장한 paired 문서)은 다시 정렬하지 않는다
      const tgt = unconsumed.filter((r) => r.targetText.trim() && !r.sourceText.trim());
      if (src.length === 0 || tgt.length === 0) return;

      alignBusyRef.current = true;
      try {
        const res = await fetch('/api/session/align', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: src.slice(-ALIGN_WINDOW).map((r) => ({ seq: r.seq, text: r.sourceText.slice(0, 600) })),
            target: tgt.slice(-ALIGN_WINDOW).map((r) => ({ seq: r.seq, text: r.targetText.slice(0, 600) })),
          }),
        });
        if (!alive || !res.ok) return;
        const body = (await res.json()) as {
          pairs?: Array<{ sourceSeqs: number[]; targetSeqs: number[] }>;
        };
        const pairs = body.pairs ?? [];
        if (pairs.length === 0) return;

        const merged: Row[] = [];
        const consumed: number[] = [];
        for (const p of pairs) {
          const srcRows = p.sourceSeqs.map((n) => allRows.current.get(n)).filter(Boolean) as Row[];
          const tgtRows = p.targetSeqs.map((n) => allRows.current.get(n)).filter(Boolean) as Row[];
          if (srcRows.length === 0 || tgtRows.length === 0) continue;
          merged.push({
            seq: tgtRows[0]!.seq,
            sourceText: srcRows.map((r) => r.sourceText).join(' ').trim(),
            targetText: tgtRows.map((r) => r.targetText).join(' ').trim(),
          });
          consumed.push(...p.sourceSeqs, ...p.targetSeqs);
        }
        if (merged.length === 0) return;
        for (const n of consumed) consumedRef.current.add(n);
        setPaired((prev) => {
          const seqs = new Set(merged.map((m) => m.seq));
          return [...prev.filter((p2) => !seqs.has(p2.seq)), ...merged].sort((a, b) => a.seq - b.seq);
        });
      } catch {
        /* 정렬 실패 — raw 줄이 그대로 있으니 다음 주기에 다시 */
      } finally {
        alignBusyRef.current = false;
      }
    };

    const iv = setInterval(() => void alignTick(), ALIGN_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // 새 줄·라이브 줄이 오면 아래로 따라간다
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [rows.length, paired.length, live]);

  if (status === 'invalid') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg bg-caption-bg p-8 text-center">
        <p className="text-[17px] font-semibold text-caption-target">{labels.invalid}</p>
      </div>
    );
  }

  /**
   * 표시 목록 — 짝지어진 줄이 raw 줄(소비된 것 제외)을 대체하며 제자리에 들어간다.
   * 정렬이 늦어도 raw가 먼저 흐르고 있으므로 화면이 비는 순간은 없다.
   */
  const displayRows = [
    ...paired,
    ...rows.filter((r) => !consumedRef.current.has(r.seq)),
  ]
    .sort((a, b) => a.seq - b.seq)
    .slice(-MAX_ROWS);

  const hasContent = displayRows.length > 0 || live;
  if (!hasContent) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg bg-caption-bg p-8 text-center">
        <Radio size={28} aria-hidden className="animate-pulse text-caption-source" />
        <p className="text-[17px] font-semibold text-caption-target">
          {status === 'ended' ? labels.ended : labels.waiting}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* 도구 — 표시 언어 + 음성 토글 + 자막 저장 (로그인 없이) */}
      <div className="flex justify-end gap-2">
        {/* 기본값은 서버가 자동으로 맞춰준다 — 제3의 언어 참가자만 바꾸면 된다 */}
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          aria-label={labels.langLabel}
          className="h-9 rounded-lg border border-border bg-bg-raised px-2 text-[13px] font-semibold text-text-muted"
        >
          {langOptions.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
        <button
          onClick={toggleSpeak}
          aria-pressed={speaking}
          className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold ${
            speaking
              ? 'border-accent bg-accent-weak text-accent'
              : 'border-border text-text-muted hover:text-text'
          }`}
        >
          {speaking ? <Volume2 size={14} aria-hidden /> : <VolumeX size={14} aria-hidden />}
          {speaking ? labels.speakOn : labels.speakOff}
        </button>
        <button
          onClick={download}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-semibold text-text-muted hover:text-text"
        >
          <Download size={14} aria-hidden />
          {labels.save}
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto rounded-lg bg-caption-bg p-4">
        {/*
          대면과 같은 위계 — 번역(알아들을 언어)은 크고 밝게, 원문은 작지만 **읽히게**.
          예전엔 원문을 text-caption-source/60로 너무 죽여 검은 배경에서 안 보였다(사용자 지적).
          두 스트림을 실시간에 묶지 않으므로 번역만 있는 줄·원문만 있는 줄이 따로 흐른다.
        */}
        {displayRows.map((r) =>
          r.targetText ? (
            <div key={r.seq} className="flex flex-col gap-0.5">
              <p className="text-[20px] font-semibold leading-relaxed text-caption-target">
                {r.targetText}
              </p>
              {r.sourceText ? (
                <p className="text-[13.5px] leading-relaxed text-caption-source">{r.sourceText}</p>
              ) : null}
            </div>
          ) : (
            <p key={r.seq} className="text-[14px] leading-relaxed text-caption-source">
              {r.sourceText}
            </p>
          ),
        )}

        {/* 쌓이는 중 번역 — 대면처럼 실시간으로 흐르는 줄 (확정되면 위로 올라간다) */}
        {live && status === 'live' ? (
          <p className="flex items-start gap-2 text-[20px] font-semibold leading-relaxed text-caption-target/85">
            <span
              aria-hidden
              className="mt-2 inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent"
            />
            {live}
          </p>
        ) : null}

        {status === 'ended' ? (
          <p className="py-2 text-center text-[13px] text-caption-source">{labels.ended}</p>
        ) : null}
        <div ref={bottom} />
      </div>
    </div>
  );
}
