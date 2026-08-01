'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Mic, Square } from 'lucide-react';
import { connectBrowserSession, type BrowserTranslationSession } from '@sotong/shared/engine/browser';
import { scriptOfLang, type EngineSegment } from '@sotong/shared/engine';
import { INTERPRET_LANGUAGES, TRANSLATE_TARGET_LANGS, guessScript } from '@sotong/shared/constants';
import type { LangCode } from '@sotong/shared/types';

/**
 * 마주통역 1세션 (턴 방식) — 실험 모드 (어드민 테스트 플래그로 켜진다).
 *
 * 기본 마주(2세션)와의 차이:
 *   · 통역 세션이 **한 번에 하나만** 살아 있다. "지금 말하는 사람"을 탭으로 정하고,
 *     그 사람 언어→상대 언어 한 방향만 연결한다. 차례가 바뀌면 끊고 반대로 다시 연결한다.
 *   · 그래서 (1) 두 TTS가 겹치지 않고 (2) 화면 언어가 왔다갔다하지 않으며 (3) 토큰이 절반이다.
 *   · 대신 말할 차례를 사람이 버튼으로 넘겨야 한다(자동 감지는 첫 0.2~2초를 오판한다).
 *
 * 기록·하트비트·저장 파이프라인은 기본 마주와 동일하게 재사용한다.
 */

type Phase = 'setup' | 'starting' | 'live' | 'ending' | 'ended';
type Speaker = 'A' | 'B';

interface Row {
  seq: number;
  text: string;
  source?: string;
}

interface StartResponse {
  sessionId: string;
  maxDurationSec: number;
  langA: LangCode;
  langB: LangCode;
  single: true;
}

interface LegGrant {
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

const MAX_ROWS = 60;
const langOptions = INTERPRET_LANGUAGES.filter((l) => TRANSLATE_TARGET_LANGS.includes(l.code));

/** 한 면(패널) — 그 사람이 읽는 번역 + 자기 차례 컨트롤 */
function Panel({
  flip,
  myLang,
  onLangChange,
  onExit,
  isSpeaking,
  otherSpeaking,
  live,
  rows,
  connecting,
  onSpeak,
  onStop,
  disabled,
}: {
  flip: boolean;
  myLang: LangCode;
  onLangChange: (l: LangCode) => void;
  onExit: () => void;
  /** 이 면 사람이 지금 말하는 중인가 */
  isSpeaking: boolean;
  /** 맞은편이 말하는 중인가 (그러면 이 면에 번역이 크게 뜬다) */
  otherSpeaking: boolean;
  live: string;
  rows: Row[];
  connecting: boolean;
  onSpeak: () => void;
  onStop: () => void;
  disabled: boolean;
}) {
  return (
    <section
      className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${
        isSpeaking ? 'bg-accent/15' : 'bg-caption-bg'
      }`}
      style={flip ? { transform: 'rotate(180deg)' } : undefined}
    >
      {/* 상단(중앙 경계) 컨트롤 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 p-3">
        <select
          value={myLang}
          onChange={(e) => onLangChange(e.target.value as LangCode)}
          disabled={disabled}
          className="pointer-events-auto rounded-lg border border-white/20 bg-black/30 px-3 py-1.5 text-[14px] font-semibold text-white backdrop-blur disabled:opacity-50"
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

      {/* 늦게 쌓이는 기록 */}
      <div className="flex max-h-[32%] flex-col-reverse gap-2 overflow-y-auto px-5 pb-2 pt-16">
        {[...rows].reverse().map((r) => (
          <div key={r.seq} className="shrink-0">
            <p className="text-[15px] font-semibold leading-snug text-caption-target">{r.text}</p>
            {r.source ? (
              <p className="text-[12.5px] leading-snug text-caption-source">{r.source}</p>
            ) : null}
          </div>
        ))}
      </div>

      {/* 가운데 — 상대가 말하면 번역, 내가 말하면 '말하는 중' */}
      <div className="flex flex-1 items-center justify-center px-6 py-3 text-center">
        {isSpeaking ? (
          <p className="text-[18px] font-semibold text-accent">● 말하는 중…</p>
        ) : (
          <p className="text-[26px] font-bold leading-tight text-caption-target">
            {otherSpeaking ? live || <span className="text-caption-source/50">…</span> : ''}
          </p>
        )}
      </div>

      {/* 하단(사람이 보는 방향) — 큰 차례 버튼 */}
      <div className="flex items-center justify-center px-6 pb-5 pt-1">
        {isSpeaking ? (
          <button
            onClick={onStop}
            className="pointer-events-auto flex h-12 items-center gap-2 rounded-full bg-accent px-7 text-[16px] font-bold text-accent-text"
          >
            <Square size={16} aria-hidden fill="currentColor" /> 말 멈춤
          </button>
        ) : (
          <button
            onClick={onSpeak}
            disabled={connecting}
            className="pointer-events-auto flex h-12 items-center gap-2 rounded-full border-2 border-white/25 bg-black/30 px-7 text-[16px] font-bold text-white backdrop-blur disabled:opacity-50"
          >
            {connecting ? (
              <Loader2 size={17} className="animate-spin" aria-hidden />
            ) : (
              <Mic size={17} aria-hidden />
            )}
            내 차례 · 말하기
          </button>
        )}
      </div>
    </section>
  );
}

export function FaceoffSingleInterpreter() {
  const [phase, setPhase] = useState<Phase>('setup');
  const [error, setError] = useState<string | null>(null);
  const [langA, setLangA] = useState<LangCode>('ko');
  const [langB, setLangB] = useState<LangCode>('en');

  /** 지금 말하는 사람 (없으면 null = 대기) */
  const [turn, setTurn] = useState<Speaker | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [rowsA, setRowsA] = useState<Row[]>([]); // A가 읽는 줄 (B 발화의 번역)
  const [rowsB, setRowsB] = useState<Row[]>([]);
  const [liveA, setLiveA] = useState('');
  const [liveB, setLiveB] = useState('');

  const micRef = useRef<MediaStream | null>(null);
  const sessRef = useRef<BrowserTranslationSession | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const turnRef = useRef<Speaker | null>(null);
  const endingRef = useRef(false);

  // 저장 파이프라인 (기본 마주와 동일)
  const startedAtRef = useRef(0);
  const saveSeqRef = useRef(0);
  const pendingRef = useRef<
    Map<string, { seq: number; atMs: number; source: string; target: string; speaker: Speaker }>
  >(new Map());
  const sentKeysRef = useRef<Set<string>>(new Set());
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const langARef = useRef<LangCode>('ko');
  const langBRef = useRef<LangCode>('en');
  useEffect(() => {
    langARef.current = langA;
  }, [langA]);
  useEffect(() => {
    langBRef.current = langB;
  }, [langB]);

  /**
   * 확정 발화를 서버에 밀어 보낸다 (하트비트·종료 공용).
   * ⚠ 보낼 게 없어도 하트비트는 반드시 보낸다 — 30초 침묵이면 세션이 고아로 죽는다.
   */
  const flush = useCallback(async (final: boolean) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    const rows = [...pendingRef.current.entries()].sort((a, b) => a[1].seq - b[1].seq).slice(0, 100);
    const segments = rows.map(([, r]) => ({
      seq: r.seq,
      startMs: r.atMs,
      endMs: r.atMs,
      sourceText: r.source,
      targetText: r.target,
      kind: 'paired' as const,
      speaker: r.speaker,
    }));
    try {
      const res = await fetch(final ? '/api/session/end' : '/api/session/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(final ? { sessionId, reason: 'user', segments } : { sessionId, segments }),
      });
      if (res.ok) {
        for (const [key] of rows) {
          pendingRef.current.delete(key);
          sentKeysRef.current.add(key);
        }
      }
    } catch {
      /* 다음 주기에 다시 보낸다 */
    }
  }, []);

  /**
   * 활성 방향에서 온 세그먼트를 '듣는 사람' 면에 놓는다.
   * 말하는 사람(turn)이 A면 번역은 B가 읽는다(langB) → B 면에.
   * 원문 문자가 말하는 사람 언어와 다르면(=통과분) 버린다.
   */
  const pushSegment = useCallback((speaker: Speaker, seg: EngineSegment) => {
    const speakerLang = speaker === 'A' ? langARef.current : langBRef.current;
    const speakerScript = scriptOfLang(speakerLang);
    const srcScript = guessScript(seg.sourceText);
    if (srcScript && srcScript !== speakerScript) return; // 반대 언어 통과분 — 버린다

    const text = seg.targetText.trim();
    if (!text) return;

    // 듣는 면: A가 말하면 B가 읽고, B가 말하면 A가 읽는다
    const setLive = speaker === 'A' ? setLiveB : setLiveA;
    const setRows = speaker === 'A' ? setRowsB : setRowsA;
    setLive(text);
    if (seg.isFinal) {
      setRows((prev) => {
        const idx = prev.findIndex((r) => r.seq === seg.seq);
        const row: Row = { seq: seg.seq, text, source: seg.sourceText.trim() || undefined };
        const next = idx >= 0 ? [...prev.slice(0, idx), row, ...prev.slice(idx + 1)] : [...prev, row];
        return next.slice(-MAX_ROWS);
      });
      const key = `${speaker}:${seg.seq}`;
      const prevSave = pendingRef.current.get(key);
      if (!sentKeysRef.current.has(key)) {
        pendingRef.current.set(key, {
          seq: prevSave?.seq ?? saveSeqRef.current++,
          atMs: prevSave?.atMs ?? Math.max(0, Date.now() - startedAtRef.current),
          source: seg.sourceText.trim(),
          target: text,
          speaker,
        });
      }
      setTimeout(() => setLive((cur) => (cur === text ? '' : cur)), 2500);
    }
  }, []);

  /** 현재 살아 있는 방향 연결만 끊는다 (세션·마이크는 유지) */
  const closeLeg = useCallback(() => {
    sessRef.current?.close();
    sessRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
  }, []);

  /** 이 사람 차례로 전환 — 이전 방향을 끊고 이 방향을 새로 연결한다 */
  const speakAs = useCallback(
    async (speaker: Speaker) => {
      const mic = micRef.current;
      const sessionId = sessionIdRef.current;
      if (!mic || !sessionId || connecting) return;
      if (turnRef.current === speaker && sessRef.current) return; // 이미 이 사람 차례

      setConnecting(true);
      setError(null);
      closeLeg();

      const sourceLang = speaker === 'A' ? langARef.current : langBRef.current;
      const targetLang = speaker === 'A' ? langBRef.current : langARef.current;
      try {
        const res = await fetch('/api/faceoff/leg', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, sourceLang, targetLang }),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          setError(b.error ?? 'leg_failed');
          setConnecting(false);
          return;
        }
        const grant = (await res.json()) as LegGrant;
        const session = await connectBrowserSession(
          {
            key: grant.ephemeralKey,
            targetLang: grant.targetLang,
            expiresAt: grant.keyExpiresAt,
            model: grant.model,
            provider: grant.provider,
            callUrl: grant.callUrl,
          },
          mic,
          {
            onSegment: (seg) => pushSegment(speaker, seg),
            onAudioTrack: (stream) => {
              if (audioRef.current) audioRef.current.srcObject = stream;
            },
          },
          grant.transcribe,
        );
        // 전환 도중 유저가 이미 다른 걸 눌렀으면 방금 연 걸 닫는다
        if (turnRef.current !== null && turnRef.current !== speaker) {
          session.close();
          setConnecting(false);
          return;
        }
        sessRef.current = session;
        turnRef.current = speaker;
        setTurn(speaker);
        void audioRef.current?.play().catch(() => undefined);
      } catch {
        setError('leg_failed');
      } finally {
        setConnecting(false);
      }
    },
    [connecting, closeLeg, pushSegment],
  );

  /** 말 멈춤 — 방향 연결만 끊고 대기 상태로 (세션은 유지) */
  const stopSpeaking = useCallback(() => {
    closeLeg();
    turnRef.current = null;
    setTurn(null);
    setLiveA('');
    setLiveB('');
  }, [closeLeg]);

  const cleanup = useCallback(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = null;
    sessRef.current?.close();
    sessRef.current = null;
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
        body: JSON.stringify({ langA, langB, audioOut: true, single: true }),
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

      // iOS 자동재생 잠금은 유저 제스처(시작 버튼) 안에서 한 번 풀어 둔다
      void audioRef.current?.play().catch(() => undefined);

      setRowsA([]);
      setRowsB([]);
      setLiveA('');
      setLiveB('');
      turnRef.current = null;
      setTurn(null);

      startedAtRef.current = Date.now();
      saveSeqRef.current = 0;
      pendingRef.current.clear();
      sentKeysRef.current.clear();
      heartbeatRef.current = setInterval(() => void flush(false), 5_000);

      setPhase('live');
    } catch {
      setError('start_failed');
      setPhase('setup');
      cleanup();
    }
  }, [langA, langB, cleanup, flush]);

  const exit = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    setPhase('ending');
    closeLeg();
    await new Promise((r) => setTimeout(r, 1000));
    cleanup();
    await flush(true);
    setPhase('ended');
  }, [cleanup, flush, closeLeg]);

  useEffect(() => () => cleanup(), [cleanup]);

  const audioEl = <audio ref={audioRef} autoPlay playsInline className="hidden" />;

  if (phase === 'setup' || phase === 'starting') {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-6 py-10">
        {audioEl}
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">마주통역 · 1세션</h1>
          <p className="mt-1 text-[14px] text-text-muted">
            한 기기를 사이에 두고 번갈아 말합니다. 말할 사람이 「내 차례」를 누르고 말한 뒤,
            상대가 자기 차례를 눌러 이어갑니다. 한 번에 한 방향만 통역돼 음성이 겹치지 않습니다.
          </p>
          <span className="mt-2 inline-flex items-center rounded-md bg-warn/15 px-2 py-0.5 text-[12px] font-semibold text-warn">
            실험 기능
          </span>
        </div>

        <div className="flex items-center gap-3">
          <LangPick label="내 언어 (A)" value={langA} onChange={setLangA} />
          <span className="mt-5 text-text-faint">↔</span>
          <LangPick label="상대 언어 (B)" value={langB} onChange={setLangB} />
        </div>

        {langA === langB ? (
          <p className="text-[13px] text-warn">서로 다른 언어를 골라 주세요.</p>
        ) : null}
        {error ? (
          <p className="text-[13px] text-danger">
            시작하지 못했습니다{error === 'quota_exhausted' ? ' — 토큰이 모두 소진되었습니다.' : '.'}
          </p>
        ) : null}

        <button
          onClick={() => void start()}
          disabled={phase === 'starting' || langA === langB}
          className="flex h-12 items-center justify-center gap-2 rounded-md bg-accent font-semibold text-accent-text disabled:opacity-50"
        >
          {phase === 'starting' ? <Loader2 size={18} className="animate-spin" aria-hidden /> : null}
          시작
        </button>
      </div>
    );
  }

  if (phase === 'ended') {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
        <p className="text-[18px] font-semibold">통역을 마쳤습니다</p>
        <p className="text-[14px] text-text-muted">기록은 세션 목록에서 볼 수 있습니다.</p>
        <button
          onClick={() => setPhase('setup')}
          className="h-11 rounded-md border border-border px-6 font-semibold"
        >
          새 통역 시작
        </button>
      </div>
    );
  }

  // live / ending — 화면을 정확히 반으로. 위(A)는 180° 회전.
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black">
      {audioEl}
      <Panel
        flip
        myLang={langA}
        onLangChange={setLangA}
        onExit={() => void exit()}
        isSpeaking={turn === 'A'}
        otherSpeaking={turn === 'B'}
        live={liveA}
        rows={rowsA}
        connecting={connecting}
        onSpeak={() => void speakAs('A')}
        onStop={stopSpeaking}
        disabled
      />
      <div className="relative h-px bg-white/15">
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black px-3 py-0.5 text-[11px] font-semibold text-white/60">
          {turn ? (turn === 'A' ? 'A ▶ B' : 'B ▶ A') : '대기'}
        </span>
      </div>
      <Panel
        flip={false}
        myLang={langB}
        onLangChange={setLangB}
        onExit={() => void exit()}
        isSpeaking={turn === 'B'}
        otherSpeaking={turn === 'A'}
        live={liveB}
        rows={rowsB}
        connecting={connecting}
        onSpeak={() => void speakAs('B')}
        onStop={stopSpeaking}
        disabled
      />
    </div>
  );
}

function LangPick({
  label,
  value,
  onChange,
}: {
  label: string;
  value: LangCode;
  onChange: (l: LangCode) => void;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1.5">
      <span className="text-[12.5px] font-semibold text-text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as LangCode)}
        className="h-11 rounded-lg border border-border bg-bg-raised px-3 text-[15px] font-semibold"
      >
        {langOptions.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
