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
 * 핵심 구조 (다른 모드와 근본적으로 다른 점):
 *   · 세션이 **둘**이다. toB(langA→langB), toA(langB→langA). 같은 마이크를 둘 다에 물린다.
 *   · 각 세션은 들리는 모든 말을 자기 출력 언어로 번역한다. 그중 "같은 언어 통과분"은 버린다.
 *     예) toB(출력=영어)에 영어가 들어오면 영어→영어 통과 → 버림.
 *          toB에 한국어가 들어오면 한국어→영어 → 진짜 결과 → 영어 면에 표시.
 *   · 판정은 원문 글자의 문자 체계로 한다(guessScript). 한 면은 한국어, 한 면은 영어처럼
 *     문자가 다른 쌍에서 동작한다.
 *
 * 화면은 정확히 반으로 갈리고, 한 면(A)은 180° 회전해 마주 앉은 사람이 정방향으로 본다.
 *
 * ⚠ v1이다. 알려진 미해결 문제(개발 후 실측으로 다듬을 것):
 *   · 에코 폐루프 — 스피커로 나간 TTS가 마이크로 되들어와 반대 세션이 재번역할 수 있음.
 *   · 동시 발화 — 두 사람이 겹쳐 말하면 마이크 하나로는 분리 못 함.
 *   · TTS 충돌 — 두 방향 음성이 같은 스피커에서 겹칠 수 있음.
 */

type Phase = 'setup' | 'starting' | 'live' | 'ending' | 'ended';

/** 화면 한쪽에 쌓이는 줄 */
interface Row {
  seq: number;
  text: string;
  /** 원문(늦게 매칭될 수 있음) */
  source?: string;
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

const MAX_ROWS = 60;
const langOptions = INTERPRET_LANGUAGES.filter((l) => TRANSLATE_TARGET_LANGS.includes(l.code));

/** 한 면(패널)의 실시간 자막 + 라우팅된 줄을 그린다 */
function Panel({
  flip,
  myLang,
  onLangChange,
  onExit,
  live,
  rows,
  disabled,
}: {
  flip: boolean;
  myLang: LangCode;
  onLangChange: (l: LangCode) => void;
  onExit: () => void;
  /** 이 면 사람에게 지금 크게 보여줄 실시간 번역 (상대가 말하는 중) */
  live: string;
  rows: Row[];
  disabled: boolean;
}) {
  return (
    <section
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-caption-bg"
      style={flip ? { transform: 'rotate(180deg)' } : undefined}
    >
      {/* 투명 오버레이 컨트롤 — 중앙 경계 쪽에 둔다 */}
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

      {/* 늦게 매칭되어 쌓이는 기록 — 중앙 경계 쪽(위) */}
      <div className="flex max-h-[38%] flex-col-reverse gap-2 overflow-y-auto px-5 pb-2 pt-16">
        {[...rows].reverse().map((r) => (
          <div key={r.seq} className="shrink-0">
            <p className="text-[15px] font-semibold leading-snug text-caption-target">{r.text}</p>
            {r.source ? (
              <p className="text-[12.5px] leading-snug text-caption-source">{r.source}</p>
            ) : null}
          </div>
        ))}
      </div>

      {/* 실시간 번역 — 크게, 바깥쪽(사람이 보는 방향의 아래) */}
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

  const [rowsA, setRowsA] = useState<Row[]>([]); // langA 사람이 읽는 줄 (langB 발화의 번역)
  const [rowsB, setRowsB] = useState<Row[]>([]);
  const [liveA, setLiveA] = useState('');
  const [liveB, setLiveB] = useState('');

  const micRef = useRef<MediaStream | null>(null);
  const sessToBRef = useRef<BrowserTranslationSession | null>(null); // langA→langB
  const sessToARef = useRef<BrowserTranslationSession | null>(null); // langB→langA
  const audioBRef = useRef<HTMLAudioElement | null>(null);
  const audioARef = useRef<HTMLAudioElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const endingRef = useRef(false);
  /**
   * 저장 파이프라인 (표시와 분리) — 기록이 고아로 남고 세그먼트가 유실되던 걸 막는다.
   * startedAt으로 실제 타임스탬프를 찍고, 하트비트로 확정 발화를 증분 저장한다.
   * pending은 아직 서버가 못 받은 것, sent는 받았다고 확인된 것.
   */
  const startedAtRef = useRef(0);
  const saveSeqRef = useRef(0);
  const pendingRef = useRef<Map<string, { seq: number; atMs: number; source: string; target: string; speaker: 'A' | 'B' }>>(
    new Map(),
  );
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
   * 세그먼트를 어느 면에 놓을지 판정한다.
   *
   * dir='toB' 세션은 langB로 번역한다 → langA 발화일 때만 진짜 결과다(langA→langB).
   *   원문 문자가 langA의 문자와 다르면 "같은 언어 통과분"(langB→langB)이므로 버린다.
   *
   * 원문이 아직 안 와서 문자를 못 가릴 때는 **버리지 않고 통과**시킨다 —
   * 늦게 오는 원문 때문에 진짜 번역을 놓치는 게 더 나쁘다.
   */
  const pushSegment = useCallback((dir: 'toB' | 'toA', seg: EngineSegment) => {
    const speakerLang = dir === 'toB' ? langARef.current : langBRef.current;
    const speakerScript = scriptOfLang(speakerLang);
    const srcScript = guessScript(seg.sourceText);
    if (srcScript && srcScript !== speakerScript) return; // 반대 언어 통과분 — 버린다

    const text = seg.targetText.trim();
    if (!text) return;

    const setLive = dir === 'toB' ? setLiveB : setLiveA;
    const setRows = dir === 'toB' ? setRowsB : setRowsA;
    setLive(text);
    if (seg.isFinal) {
      setRows((prev) => {
        const idx = prev.findIndex((r) => r.seq === seg.seq);
        const row: Row = { seq: seg.seq, text, source: seg.sourceText.trim() || undefined };
        const next = idx >= 0 ? [...prev.slice(0, idx), row, ...prev.slice(idx + 1)] : [...prev, row];
        return next.slice(-MAX_ROWS);
      });

      /**
       * 저장 큐에도 넣는다(표시와 별개). 같은 조각이 갱신되면 덮어쓴다.
       * atMs는 첫 확정 때 한 번만 찍는다 — 나중 갱신으로 시각이 흔들리지 않게.
       */
      // 화자: toB 세션은 langA 발화(A), toA 세션은 langB 발화(B) — 전체 보기 색 구분에 쓴다
      const speaker: 'A' | 'B' = dir === 'toB' ? 'A' : 'B';
      const key = `${dir}:${seg.seq}`;
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

      // 실시간 영역은 잠시 뒤 비운다 (다음 발화 전까지 마지막 문장을 남겨두되 계속 쌓이진 않게)
      setTimeout(() => setLive((cur) => (cur === text ? '' : cur)), 2500);
    }
  }, []);

  /**
   * 확정 발화를 서버에 밀어 보낸다 (하트비트·종료 공용).
   * ⚠ 보내기 전에 큐를 비우지 않는다 — 받았다고 확인된 것만 뺀다(요청 실패 시 유실 방지).
   */
  const flush = useCallback(async (final: boolean) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    const rows = [...pendingRef.current.entries()]
      .sort((a, b) => a[1].seq - b[1].seq)
      .slice(0, 100);
    /**
     * ⚠ 보낼 게 없어도 하트비트는 반드시 보낸다.
     *   서버는 30초(HEARTBEAT_INTERVAL 10초 × 3) 동안 하트비트가 없으면 세션을 고아로 죽인다.
     *   예전엔 '보낼 세그먼트 없으면 return'이라, 발화 사이 침묵이 30초 넘으면 세션이 죽고
     *   그 뒤 말한 건 전부 버려졌다(실측: 5분 세션이 58초에서 끊김).
     *   하트비트는 '저장'만이 아니라 '살려두기'다 — 빈 배치라도 핑을 보내야 한다.
     */
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

      // 두 세션을 같은 마이크에 물린다
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

      // 유저 제스처 안에서 두 오디오를 한 번 재생해 모바일 자동재생 잠금을 푼다
      void audioBRef.current?.play().catch(() => undefined);
      void audioARef.current?.play().catch(() => undefined);

      setRowsA([]);
      setRowsB([]);
      setLiveA('');
      setLiveB('');

      // 저장 파이프라인 초기화 + 하트비트 시작 (고아 방지 · 증분 저장)
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

  // 오디오 엘리먼트는 항상 마운트 (setup 화면에서도) — iOS 잠금 해제 때문
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
            휴대폰을 두 사람 사이에 두세요. 양쪽이 각자 언어로 말하면 상대 면에 번역이 나오고 음성으로 읽어 줍니다.
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
          전체 기록과 AI 요약은 세션 기록에서 볼 수 있습니다.
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

  /**
   * live — 화면을 정확히 반으로.
   * 아래 절반은 정방향(폰을 든 내 쪽 = langA), 위 절반은 180° 회전(맞은편 = langB).
   * ⚠ 아래가 내 쪽이다 — 여기에 langB를 두면 내 언어가 상대편으로 가는 것처럼 보인다.
   */
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black">
      {audioEls}
      <Panel
        flip
        myLang={langB}
        onLangChange={setLangB}
        onExit={() => void exit()}
        live={liveB}
        rows={rowsB}
        disabled={false}
      />
      <div className="h-px shrink-0 bg-white/20" />
      <Panel
        flip={false}
        myLang={langA}
        onLangChange={setLangA}
        onExit={() => void exit()}
        live={liveA}
        rows={rowsA}
        disabled={false}
      />
    </div>
  );
}
