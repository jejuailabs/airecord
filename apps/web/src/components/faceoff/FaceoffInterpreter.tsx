'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Mic } from 'lucide-react';
import { connectBrowserSession, type BrowserTranslationSession } from '@sotong/shared/engine/browser';
import { scriptOfLang, type EngineSegment } from '@sotong/shared/engine';
import {
  INTERPRET_LANGUAGES,
  TRANSLATE_TARGET_LANGS,
  guessScript,
} from '@sotong/shared/constants';
import type { LangCode } from '@sotong/shared/types';

/**
 * 마주통역 (모드 D) — 한 기기를 둘 사이에 두고 양방향 동시 통역.
 *
 * 데이터 모델 (2026-08 재설계): 발화 하나 = 한 record.
 *   { speaker: 'A'|'B', atMs, original(화자 말), translated(번역) }
 *   이 하나가 셋을 동시에 푼다 —
 *     · 라이브: 화자 쪽엔 원문, 듣는 쪽엔 번역 (심플)
 *     · 타임스탬프: atMs = 세션 시작 이후 실제 경과 (예전엔 전부 0이었다)
 *     · 종료 기록: 화자별 색·대화·필터 (기록에 speaker를 함께 저장)
 *
 * 세션 구조: 번역 세션 **둘**(toB=A→B, toA=B→A)을 같은 마이크에 물린다.
 *   gpt-realtime-translate는 출력 언어가 세션당 하나라 양방향을 한 세션으로 못 낸다(실측).
 *   각 세션이 원문(sourceText)과 번역(targetText)을 함께 주므로, 원문/번역이 이미 다 있다.
 *
 * ⚠ 화면 아래 절반이 폰을 든 내 쪽(langA, 정방향), 위 절반이 맞은편(langB, 180° 회전).
 */

type Phase = 'setup' | 'starting' | 'live' | 'ending' | 'ended';

/** 발화 하나 */
interface Utterance {
  id: number;
  speaker: 'A' | 'B';
  atMs: number;
  original: string;
  translated: string;
}

interface SideGrant {
  ephemeralKey: string;
  model: string;
  provider: 'openai' | 'google';
  callUrl: string;
  keyExpiresAt: number;
  targetLang: LangCode;
  transcribe: {
    ephemeralKey: string;
    model: string;
    callUrl: string;
    keyExpiresAt: number;
    sourceLang: string;
  } | null;
}

interface StartResponse {
  sessionId: string;
  maxDurationSec: number;
  langA: LangCode;
  langB: LangCode;
  toB: SideGrant;
  toA: SideGrant;
}

const MAX_KEEP = 200;
const HEARTBEAT_MS = 5_000;
const langOptions = INTERPRET_LANGUAGES.filter((l) => TRANSLATE_TARGET_LANGS.includes(l.code));

/** 한 면(패널) — 큰 실시간 글 + 중앙 쪽에 대화 기록. 이 면 사람이 읽어야 할 텍스트만 그린다. */
function Panel({
  flip,
  myLang,
  onLangChange,
  onExit,
  live,
  rows,
}: {
  flip: boolean;
  myLang: LangCode;
  onLangChange: (l: LangCode) => void;
  onExit: () => void;
  /** 지금 크게 보여줄 글 (내가 말하면 내 원문, 상대가 말하면 번역) */
  live: string;
  /** 이 면 관점의 대화 기록 (내 말=원문, 상대 말=번역) */
  rows: Array<{ id: number; text: string; mine: boolean }>;
}) {
  return (
    <section
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-caption-bg"
      style={flip ? { transform: 'rotate(180deg)' } : undefined}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 p-3">
        <select
          value={myLang}
          onChange={(e) => onLangChange(e.target.value as LangCode)}
          className="pointer-events-auto rounded-lg border border-white/20 bg-black/30 px-3 py-1.5 text-[14px] font-semibold text-white backdrop-blur"
          aria-label="이 면의 언어"
        >
          {langOptions.map((l) => (
            <option key={l.code} value={l.code} className="text-black">
              {l.label}
            </option>
          ))}
        </select>
        <button
          onClick={onExit}
          className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-lg border border-white/20 bg-black/30 text-white backdrop-blur"
          aria-label="나가기"
        >
          <ArrowLeft size={17} />
        </button>
      </div>

      {/* 대화 기록 — 중앙 경계 쪽(위). 내 말은 흐리게, 상대 말(번역)은 진하게 */}
      <div className="flex max-h-[40%] flex-col-reverse gap-1.5 overflow-y-auto px-5 pb-2 pt-16">
        {[...rows].reverse().map((r) => (
          <p
            key={r.id}
            className={`shrink-0 leading-snug ${
              r.mine
                ? 'text-[13px] text-caption-source'
                : 'text-[15px] font-semibold text-caption-target'
            }`}
          >
            {r.text}
          </p>
        ))}
      </div>

      {/* 실시간 — 크게, 바깥쪽 */}
      <div className="flex flex-1 items-center justify-center px-6 py-4 text-center">
        <p className="text-[26px] font-bold leading-tight text-caption-target">
          {live || <span className="text-caption-source/50">…</span>}
        </p>
      </div>
    </section>
  );
}

export function FaceoffInterpreter() {
  const [phase, setPhase] = useState<Phase>('setup');
  const [error, setError] = useState<string | null>(null);
  const [langA, setLangA] = useState<LangCode>('ko');
  const [langB, setLangB] = useState<LangCode>('en');

  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [liveA, setLiveA] = useState('');
  const [liveB, setLiveB] = useState('');

  const micRef = useRef<MediaStream | null>(null);
  const sessToBRef = useRef<BrowserTranslationSession | null>(null);
  const sessToARef = useRef<BrowserTranslationSession | null>(null);
  const audioBRef = useRef<HTMLAudioElement | null>(null);
  const audioARef = useRef<HTMLAudioElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const endingRef = useRef(false);
  const startedAtRef = useRef(0);
  const idRef = useRef(1);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 아직 서버에 못 보낸 확정 발화 (하트비트/종료가 비워 간다) */
  const pendingRef = useRef<Map<number, Utterance>>(new Map());
  const sentRef = useRef<Set<number>>(new Set());
  const langARef = useRef<LangCode>('ko');
  const langBRef = useRef<LangCode>('en');
  useEffect(() => {
    langARef.current = langA;
  }, [langA]);
  useEffect(() => {
    langBRef.current = langB;
  }, [langB]);

  /**
   * 세그먼트 → 발화.
   * dir='toB' 세션은 langB 출력 → langA 발화일 때만 진짜(langA→langB). 반대 언어 통과분은 버린다.
   * 판정: 원문 문자 체계가 그 화자 언어와 맞아야 한다. 원문이 아직 없으면 통과(늦게 오는 원문 때문에 놓치지 않게).
   */
  const pushSegment = useCallback((dir: 'toB' | 'toA', seg: EngineSegment) => {
    const speaker: 'A' | 'B' = dir === 'toB' ? 'A' : 'B';
    const speakerLang = speaker === 'A' ? langARef.current : langBRef.current;
    const srcScript = guessScript(seg.sourceText);
    if (srcScript && srcScript !== scriptOfLang(speakerLang)) return; // 반대 언어 통과분

    const translated = seg.targetText.trim();
    const original = seg.sourceText.trim();
    if (!translated) return;

    // 라이브: 화자 쪽엔 원문, 듣는 쪽엔 번역. (원문이 아직 없으면 번역으로 대신 채운다)
    if (speaker === 'A') {
      setLiveA(original || translated);
      setLiveB(translated);
    } else {
      setLiveB(original || translated);
      setLiveA(translated);
    }

    if (!seg.isFinal) return;

    const u: Utterance = {
      id: idRef.current++,
      speaker,
      atMs: Math.max(0, Date.now() - startedAtRef.current),
      original,
      translated,
    };
    setUtterances((prev) => [...prev, u].slice(-MAX_KEEP));
    pendingRef.current.set(u.id, u);

    // 화자 쪽 실시간 글은 잠시 뒤 비운다(다음 발화 전까지 마지막만 남긴다)
    const clearSide = speaker === 'A' ? setLiveA : setLiveB;
    const shown = original || translated;
    setTimeout(() => clearSide((cur) => (cur === shown ? '' : cur)), 2500);
  }, []);

  /** 확정 발화를 세그먼트로 변환 (저장 형식) */
  const toSegment = (u: Utterance) => ({
    seq: u.id,
    startMs: u.atMs,
    endMs: u.atMs,
    sourceText: u.original,
    targetText: u.translated,
    kind: 'paired' as const,
    speaker: u.speaker,
  });

  /** 서버에 밀어 보낸다 (하트비트·종료 공용). 받았다고 확인된 것만 큐에서 뺀다. */
  const flush = useCallback(async (final: boolean) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    const rows = [...pendingRef.current.values()].sort((a, b) => a.id - b.id).slice(0, 100);
    if (rows.length === 0 && !final) return;
    try {
      const url = final ? '/api/session/end' : '/api/session/heartbeat';
      const body = final
        ? { sessionId, reason: 'user', segments: rows.map(toSegment) }
        : { sessionId, segments: rows.map(toSegment) };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        for (const r of rows) {
          pendingRef.current.delete(r.id);
          sentRef.current.add(r.id);
        }
      }
    } catch {
      /* 다음 주기에 다시 보낸다 */
    }
  }, []);

  const cleanup = useCallback(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = null;
    sessToBRef.current?.close();
    sessToARef.current?.close();
    sessToBRef.current = null;
    sessToARef.current = null;
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setPhase('starting');
    endingRef.current = false;
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micRef.current = mic;

      const res = await fetch('/api/faceoff/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ langA, langB, audioOut: true }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? 'start_failed');
        setPhase('setup');
        cleanup();
        return;
      }
      const grant = (await res.json()) as StartResponse;
      sessionIdRef.current = grant.sessionId;

      const [sB, sA] = await Promise.all([
        connectBrowserSession(
          {
            key: grant.toB.ephemeralKey,
            targetLang: grant.toB.targetLang,
            expiresAt: grant.toB.keyExpiresAt,
            model: grant.toB.model,
            provider: grant.toB.provider,
            callUrl: grant.toB.callUrl,
          },
          mic,
          {
            onSegment: (seg) => pushSegment('toB', seg),
            onAudioTrack: (stream) => {
              if (audioBRef.current) audioBRef.current.srcObject = stream;
            },
          },
          grant.toB.transcribe,
        ),
        connectBrowserSession(
          {
            key: grant.toA.ephemeralKey,
            targetLang: grant.toA.targetLang,
            expiresAt: grant.toA.keyExpiresAt,
            model: grant.toA.model,
            provider: grant.toA.provider,
            callUrl: grant.toA.callUrl,
          },
          mic,
          {
            onSegment: (seg) => pushSegment('toA', seg),
            onAudioTrack: (stream) => {
              if (audioARef.current) audioARef.current.srcObject = stream;
            },
          },
          grant.toA.transcribe,
        ),
      ]);
      sessToBRef.current = sB;
      sessToARef.current = sA;

      void audioBRef.current?.play().catch(() => undefined);
      void audioARef.current?.play().catch(() => undefined);

      startedAtRef.current = Date.now();
      idRef.current = 1;
      pendingRef.current.clear();
      sentRef.current.clear();
      setUtterances([]);
      setLiveA('');
      setLiveB('');
      setPhase('live');

      /**
       * 하트비트 — 확정 발화를 증분 저장하고 세션을 살려 둔다.
       * ⚠ 이게 없어서 예전엔 세션이 orphaned로 남고(billed 0) 세그먼트도 안 쌓였다.
       */
      heartbeatRef.current = setInterval(() => void flush(false), HEARTBEAT_MS);
    } catch {
      setError('start_failed');
      setPhase('setup');
      cleanup();
    }
  }, [langA, langB, cleanup, pushSegment, flush]);

  const exit = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    setPhase('ending');
    // 남은 번역이 도착할 짧은 시간을 준다
    await new Promise((r) => setTimeout(r, 1200));
    cleanup();
    await flush(true); // 남은 발화 전부 저장 + 세션 종료
    setPhase('ended');
  }, [cleanup, flush]);

  useEffect(() => () => cleanup(), [cleanup]);

  const audioEls = (
    <>
      <audio ref={audioBRef} autoPlay playsInline className="hidden" />
      <audio ref={audioARef} autoPlay playsInline className="hidden" />
    </>
  );

  if (phase === 'setup' || phase === 'starting') {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 py-8">
        {audioEls}
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">마주통역</h1>
          <p className="mt-1 text-[14px] text-text-muted">
            휴대폰을 두 사람 사이에 두세요. 각자 자기 언어로 말하면 상대 면에 번역이 나오고 음성으로 읽어 줍니다.
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border bg-bg-raised p-4">
          <label className="flex items-center justify-between gap-3">
            <span className="text-[14px] font-semibold">내 쪽 언어</span>
            <select
              value={langA}
              onChange={(e) => setLangA(e.target.value as LangCode)}
              className="h-11 min-w-[9rem] rounded-lg border border-border bg-bg-sunken px-3 text-[15px]"
            >
              {langOptions.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-[14px] font-semibold">맞은편 언어</span>
            <select
              value={langB}
              onChange={(e) => setLangB(e.target.value as LangCode)}
              className="h-11 min-w-[9rem] rounded-lg border border-border bg-bg-sunken px-3 text-[15px]"
            >
              {langOptions.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {langA === langB ? (
          <p className="text-[13.5px] text-warn">두 언어가 서로 달라야 합니다.</p>
        ) : null}
        {error ? (
          <p className="text-[13.5px] text-warn">
            {error === 'auth_required'
              ? '로그인이 필요합니다.'
              : error === 'quota_exhausted'
                ? '남은 통역 시간이 없습니다.'
                : error === 'unsupported_pair'
                  ? '지원하지 않는 언어 조합입니다.'
                  : '시작에 실패했습니다.'}
          </p>
        ) : null}

        <button
          onClick={() => void start()}
          disabled={langA === langB || phase === 'starting'}
          className="btn-gradient flex h-14 items-center justify-center gap-2 rounded-xl text-[17px] font-bold disabled:opacity-60"
        >
          {phase === 'starting' ? (
            <Loader2 size={19} className="animate-spin" aria-hidden />
          ) : (
            <Mic size={19} aria-hidden />
          )}
          {phase === 'starting' ? '연결 중…' : '시작'}
        </button>
      </div>
    );
  }

  if (phase === 'ending') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        {audioEls}
        <Loader2 size={24} className="animate-spin text-accent" aria-hidden />
        <p className="text-[16px] font-semibold">대화를 정리하고 있어요…</p>
      </div>
    );
  }

  if (phase === 'ended') {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-16 text-center">
        <p className="text-[20px] font-bold">대화가 정리되었습니다</p>
        <p className="text-[14px] text-text-muted">
          화자별로 구분된 전체 대화와 AI 요약은 세션 기록에서 볼 수 있습니다.
        </p>
        <div className="flex w-full flex-col gap-2">
          <a
            href={sessionIdRef.current ? `/sessions/${sessionIdRef.current}` : '/sessions'}
            className="btn-gradient flex h-12 items-center justify-center rounded-xl font-bold"
          >
            전체 보기
          </a>
          <a
            href={sessionIdRef.current ? `/api/sessions/${sessionIdRef.current}/pdf` : '#'}
            target="_blank"
            rel="noopener"
            className="flex h-12 items-center justify-center rounded-xl border border-border font-semibold"
          >
            PDF 다운로드
          </a>
        </div>
      </div>
    );
  }

  // 각 면 관점의 대화 기록: 내 말=원문(흐리게), 상대 말=번역(진하게)
  const rowsFor = (side: 'A' | 'B') =>
    utterances.slice(-30).map((u) => ({
      id: u.id,
      mine: u.speaker === side,
      text: u.speaker === side ? u.original || u.translated : u.translated,
    }));

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black">
      {audioEls}
      {/* 위: 맞은편(langB), 180° 회전 */}
      <Panel
        flip
        myLang={langB}
        onLangChange={setLangB}
        onExit={() => void exit()}
        live={liveB}
        rows={rowsFor('B')}
      />
      <div className="h-px shrink-0 bg-white/20" />
      {/* 아래: 내 쪽(langA), 정방향 */}
      <Panel
        flip={false}
        myLang={langA}
        onLangChange={setLangA}
        onExit={() => void exit()}
        live={liveA}
        rows={rowsFor('A')}
      />
    </div>
  );
}
