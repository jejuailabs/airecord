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
  targetLang,
  labels,
}: {
  token: string;
  targetLang: string;
  labels: {
    waiting: string;
    ended: string;
    invalid: string;
    save: string;
    saveName: string;
    speakOn: string;
    speakOff: string;
  };
}) {
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

  const speak = (text: string) => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth || !text.trim()) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = TTS_LOCALE[targetLang] ?? targetLang;
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

    const tick = async () => {
      try {
        const res = await fetch(`/api/viewer/${token}?after=${lastSeq.current}`, {
          cache: 'no-store',
        });
        if (!alive) return;
        if (res.status === 404) {
          setStatus('invalid');
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
          setStatus(json.status === 'ended' ? 'ended' : 'live');
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
  }, [token]);

  // 새 줄·라이브 줄이 오면 아래로 따라간다
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [rows.length, live]);

  if (status === 'invalid') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg bg-caption-bg p-8 text-center">
        <p className="text-[17px] font-semibold text-caption-target">{labels.invalid}</p>
      </div>
    );
  }

  const hasContent = rows.length > 0 || live;
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
      {/* 도구 — 음성 토글 + 자막 저장 (로그인 없이) */}
      <div className="flex justify-end gap-2">
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
        {rows.map((r) =>
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
