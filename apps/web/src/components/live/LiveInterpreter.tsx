'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Mic,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  Square,
  Globe,
  Play,
  Lock,
  CheckCircle2,
} from 'lucide-react';
import { FieldSelect, SettingRow, Toggle } from '@/components/ui/SettingRow';
import {
  INTERPRET_LANGUAGES,
  HEARTBEAT_INTERVAL_MS,
  TRANSLATE_TARGET_LANGS,
  TRIAL_CHAR_LIMIT,
  languageLabel,
} from '@sotong/shared/constants';
import type { LangCode, SourceLangSetting } from '@sotong/shared/types';
import type { EngineSegment } from '@sotong/shared/engine';
import {
  connectBrowserSession,
  type BrowserTranslationSession,
} from '@sotong/shared/engine/browser';
import type { SessionStartResponse } from '@sotong/shared/schemas';
import { Link } from '@/i18n/navigation';
import { useMicLevel } from '@/hooks/useMicLevel';
import { CaptionPanel } from '@/components/caption/CaptionPanel';

type Phase = 'setup' | 'starting' | 'live' | 'ended';
type CaptionSize = 'md' | 'lg' | 'xl';
type ErrorKey =
  | 'micPermission'
  | 'startFailed'
  | 'keyMissing'
  | 'connectionLost'
  | 'unsupportedPair'
  | 'guestQuota'
  | 'authRequired';

const SIZE_SCALE: Record<CaptionSize, number> = { md: 1.0, lg: 1.35, xl: 1.75 };
const LAST_PAIR_KEY = 'sotong-last-pair';
const CAP_WARNING_SEC = 30; // 예고 없이 끊지 않는다 (docs/07 §5.2)

function fmtSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function LiveInterpreter({ trial = false }: { trial?: boolean } = {}) {
  const t = useTranslations('live');
  const tTry = useTranslations('try');

  const [phase, setPhase] = useState<Phase>('setup');
  const [error, setError] = useState<ErrorKey | null>(null);

  // ── 설정 (유저가 만지는 값은 언어뿐 — core.md §3-1) ──
  const [sourceLang, setSourceLang] = useState<SourceLangSetting>('auto');
  const [targetLang, setTargetLang] = useState<LangCode>('en');
  const [audioOut, setAudioOut] = useState(false); // 자막이 1순위, 음성은 옵션 (core.md §3-2)

  // ── 마이크 ──
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const micLevel = useMicLevel(phase === 'setup' ? micStream : null);

  // ── 라이브 상태 ──
  const [segments, setSegments] = useState<EngineSegment[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const [captionSize, setCaptionSize] = useState<CaptionSize>('md');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [summary, setSummary] = useState<{ billedSeconds: number; segmentCount: number } | null>(
    null,
  );
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  /** 브라우저 자동재생 정책으로 play()가 막혔을 때 — 유저 클릭 한 번을 요청한다 */
  const [needsAudioGesture, setNeedsAudioGesture] = useState(false);
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  const [trialUsedChars, setTrialUsedChars] = useState(0);
  const [trialBudget, setTrialBudget] = useState(TRIAL_CHAR_LIMIT);

  const sessionRef = useRef<BrowserTranslationSession | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const maxDurationRef = useRef(0);
  /** 하트비트에 실어 보낼 확정 세그먼트 배치 (docs/01 §4.1 — 개별 쓰기 금지) */
  const pendingFinalsRef = useRef(new Map<number, EngineSegment>());
  /** 체험 모드 번역 글자수 — seq별 최신 길이를 합산한다(부분 전사가 덮어써도 중복 계수 안 되게) */
  const charsBySeqRef = useRef(new Map<number, number>());
  const charBudgetRef = useRef(TRIAL_CHAR_LIMIT);
  const segmentsLenRef = useRef(0);
  const audioElRef = useRef<HTMLAudioElement>(null);
  /** 트랙 도착 시점의 최신 음성 토글 값을 보기 위한 ref */
  const audioOutRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const endingRef = useRef(false);

  // 마지막 언어쌍 기억 → 다음에 미리 채움 (docs/06 §2.1)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAST_PAIR_KEY);
      if (saved) {
        const { s, tgt } = JSON.parse(saved) as { s: SourceLangSetting; tgt: LangCode };
        if (s) setSourceLang(s);
        if (tgt) setTargetLang(tgt);
      }
    } catch {
      /* noop */
    }
  }, []);

  const requestMic = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      setMicStream(stream);
    } catch {
      setError('micPermission');
    }
  }, []);

  const stopTimers = useCallback(() => {
    if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
    if (clockTimerRef.current) clearInterval(clockTimerRef.current);
    heartbeatTimerRef.current = null;
    clockTimerRef.current = null;
  }, []);

  const doEnd = useCallback(
    async (reason: 'user' | 'cap' | 'error') => {
      if (endingRef.current) return;
      endingRef.current = true;
      stopTimers();
      sessionRef.current?.close();
      sessionRef.current = null;
      micStream?.getTracks().forEach((tr) => tr.stop());

      let billed = 0;
      let saved = false;
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        // 아직 하트비트로 못 보낸 확정 세그먼트를 함께 넘긴다 (기록 유실 방지)
        const tail = [...pendingFinalsRef.current.values()].map((s) => ({
          seq: s.seq,
          startMs: s.startMs,
          endMs: s.endMs,
          sourceText: s.sourceText,
          targetText: s.targetText,
          detectedLang: s.detectedLang,
        }));
        pendingFinalsRef.current.clear();
        try {
          const res = await fetch('/api/session/end', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, reason, segments: tail }),
          });
          if (res.ok) {
            const json = (await res.json()) as { billedSeconds: number; saved?: boolean };
            billed = json.billedSeconds;
            saved = Boolean(json.saved);
          }
        } catch {
          /* 종료 보고 실패 — 서버 orphan 청소가 마무리한다 (docs/01 §6) */
        }
      }
      setSavedSessionId(saved ? sessionId : null);
      setSummary({ billedSeconds: billed, segmentCount: segmentsLenRef.current });
      if (reason === 'error') setError('connectionLost');
      setPhase('ended');
      setMicStream(null);
      if (document.fullscreenElement) void document.exitFullscreen();
    },
    [micStream, stopTimers],
  );

  const start = useCallback(async () => {
    if (!micStream) return;
    setError(null);
    setPhase('starting');
    endingRef.current = false;
    try {
      localStorage.setItem(LAST_PAIR_KEY, JSON.stringify({ s: sourceLang, tgt: targetLang }));
    } catch {
      /* noop */
    }

    let grant: SessionStartResponse;
    try {
      const res = await fetch('/api/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'inperson', sourceLang, targetLang, audioOut, trial }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          body.error === 'key_missing'
            ? 'keyMissing'
            : body.error === 'unsupported_pair'
              ? 'unsupportedPair'
              : body.error === 'guest_quota_exhausted'
                ? 'guestQuota'
                : body.error === 'auth_required'
                  ? 'authRequired'
                  : 'startFailed',
        );
        setPhase('setup');
        return;
      }
      grant = (await res.json()) as SessionStartResponse;
    } catch {
      setError('startFailed');
      setPhase('setup');
      return;
    }

    sessionIdRef.current = grant.sessionId;
    maxDurationRef.current = grant.maxDurationSec;
    // 서버가 내려준 예산(월 잔여 반영)을 따른다 — 클라이언트 상수보다 우선
    charBudgetRef.current = grant.charBudget ?? TRIAL_CHAR_LIMIT;
    charsBySeqRef.current.clear();
    setTrialBudget(charBudgetRef.current);
    setTrialUsedChars(0);

    try {
      const session = await connectBrowserSession(
        {
          key: grant.ephemeralKey,
          expiresAt: grant.keyExpiresAt,
          model: grant.model,
          provider: grant.provider,
          callUrl: grant.callUrl,
        },
        micStream,
        {
          onSegment: (seg) => {
            setSegments((prev) => {
              const idx = prev.findIndex((p) => p.seq === seg.seq);
              const next = idx >= 0 ? [...prev.slice(0, idx), seg, ...prev.slice(idx + 1)] : [...prev, seg];
              segmentsLenRef.current = next.length;
              return next;
            });
            if (seg.isFinal) pendingFinalsRef.current.set(seg.seq, seg);
            if (trial) {
              // 부분 전사도 즉시 계수한다 — 한도를 넘긴 뒤에 끊으면 이미 돈이 나간 뒤다
              charsBySeqRef.current.set(seg.seq, seg.targetText.length);
              let used = 0;
              for (const n of charsBySeqRef.current.values()) used += n;
              setTrialUsedChars(used);
              if (used >= charBudgetRef.current) void doEnd('cap');
            }
          },
          // ⚠ 이 시점에는 아직 phase가 'starting'이라 <audio> 엘리먼트가 마운트되지 않았다.
          // 스트림을 state로 보관했다가 아래 useEffect에서 엘리먼트에 붙인다.
          onAudioTrack: (stream) => setRemoteStream(stream),
          onError: (e) => {
            if (e.fatal) void doEnd('error');
          },
          onStateChange: (state) => {
            if (state === 'failed' || state === 'closed') {
              if (!endingRef.current && phaseRef.current === 'live') void doEnd('error');
            }
          },
        },
      );
      sessionRef.current = session;
    } catch {
      setError('startFailed');
      setPhase('setup');
      return;
    }

    startedAtRef.current = Date.now();
    setElapsedSec(0);
    setRemainingSec(grant.maxDurationSec);
    setSegments([]);
    segmentsLenRef.current = 0;
    setPhase('live');

    // 서버 하드 캡과 별개로 클라이언트도 자체 종료한다 — 한쪽만 있으면 뚫린다 (docs/07 §5.1)
    clockTimerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsedSec(elapsed);
      const remain = maxDurationRef.current - elapsed;
      setRemainingSec(remain);
      if (remain <= 0) void doEnd('cap');
    }, 1000);

    heartbeatTimerRef.current = setInterval(async () => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      const batch = [...pendingFinalsRef.current.values()].map((s) => ({
        seq: s.seq,
        startMs: s.startMs,
        endMs: s.endMs,
        sourceText: s.sourceText,
        targetText: s.targetText,
        detectedLang: s.detectedLang,
      }));
      pendingFinalsRef.current.clear();
      try {
        const res = await fetch('/api/session/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, segments: batch, trial }),
        });
        if (res.ok) {
          const json = (await res.json()) as { terminate: boolean; remainingSec: number };
          if (json.terminate) void doEnd('cap');
        }
      } catch {
        /* 하트비트 유실 — 서버가 3회 유실 시 orphan 처리 */
      }
    }, HEARTBEAT_INTERVAL_MS);
  }, [audioOut, doEnd, micStream, sourceLang, targetLang]);

  // doEnd 클로저에서 최신 phase를 보기 위한 ref
  const phaseRef = useRef<Phase>('setup');
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    audioOutRef.current = audioOut;
  }, [audioOut]);

  /**
   * 번역 오디오 트랙을 <audio>에 연결한다.
   * 트랙은 연결 직후(phase='starting') 도착하고 엘리먼트는 phase='live'에서 마운트되므로,
   * 양쪽이 모두 준비된 시점에 붙여야 한다.
   */
  useEffect(() => {
    const el = audioElRef.current;
    if (!el || !remoteStream) return;
    if (el.srcObject !== remoteStream) el.srcObject = remoteStream;
    el.muted = !audioOut;
    if (!audioOut) return;
    void el
      .play()
      .then(() => setNeedsAudioGesture(false))
      .catch(() => setNeedsAudioGesture(true)); // 자동재생 차단 — 클릭 유도
  }, [remoteStream, audioOut, phase]);

  // 언마운트 시 정리 — 분(minute)은 곧 돈이다 (core.md §3-6)
  useEffect(() => {
    return () => {
      stopTimers();
      sessionRef.current?.close();
      micStream?.getTracks().forEach((tr) => tr.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 음성 출력은 재생 측 음소거로만 제어한다.
   * 번역 세션에 session.update를 보내면 출력 언어 설정이 깨져 번역이 멈춘다.
   */
  const toggleAudioOut = useCallback((on: boolean) => {
    setAudioOut(on);
    const el = audioElRef.current;
    if (!el) return;
    el.muted = !on;
    if (on) {
      void el
        .play()
        .then(() => setNeedsAudioGesture(false))
        .catch(() => setNeedsAudioGesture(true));
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      setIsFullscreen(false);
    } else if (containerRef.current) {
      await containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    }
  }, []);

  const [confirmEnd, setConfirmEnd] = useState(false);

  // ─────────────────────── 렌더 ───────────────────────

  if (phase === 'ended' && summary && trial) {
    // 체험 종료 — 여기가 가입 전환 지점이다
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-6 py-16 text-center">
        <h1 className="text-[28px] font-bold">{tTry('ended.title')}</h1>
        <p className="text-text-muted">{tTry('ended.body')}</p>
        <dl className="flex w-full flex-col gap-2 rounded-lg border border-border bg-bg-raised p-6">
          <div className="flex items-center justify-between">
            <dt className="text-sm text-text-muted">{t('ended.duration')}</dt>
            <dd className="tabular font-semibold">{fmtSec(summary.billedSeconds)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-sm text-text-muted">
              {t('ended.segments', { count: summary.segmentCount })}
            </dt>
            <dd />
          </div>
        </dl>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/login"
            className="flex h-12 items-center justify-center rounded-md bg-accent px-6 font-semibold text-accent-text"
          >
            {tTry('ended.signup')}
          </Link>
          <Link
            href="/#pricing"
            className="flex h-12 items-center justify-center rounded-md border border-border px-6 font-semibold"
          >
            {tTry('ended.pricing')}
          </Link>
        </div>
        <p className="text-[13px] text-text-faint">{tTry('ended.freeNote')}</p>
      </div>
    );
  }

  if (phase === 'ended' && summary) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-6 py-16 text-center">
        <h1 className="text-[28px] font-bold">{t('ended.title')}</h1>
        {error ? <ErrorBanner k={error} /> : null}
        <dl className="flex w-full flex-col gap-2 rounded-lg border border-border bg-bg-raised p-6">
          <div className="flex items-center justify-between">
            <dt className="text-sm text-text-muted">{t('ended.duration')}</dt>
            <dd className="tabular font-semibold">{fmtSec(summary.billedSeconds)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-sm text-text-muted">
              {t('ended.segments', { count: summary.segmentCount })}
            </dt>
            <dd />
          </div>
        </dl>
        <div className="flex flex-wrap justify-center gap-3">
          {savedSessionId ? (
            <Link
              href={`/sessions/${savedSessionId}`}
              className="flex h-11 items-center rounded-md bg-accent px-6 font-semibold text-accent-text"
            >
              {t('ended.viewRecord')}
            </Link>
          ) : null}
          <button
            onClick={() => {
              setSummary(null);
              setError(null);
              setSegments([]);
              setPhase('setup');
            }}
            className={`h-11 rounded-md px-6 font-semibold ${
              savedSessionId ? 'border border-border' : 'bg-accent text-accent-text'
            }`}
          >
            {t('ended.again')}
          </button>
          <Link
            href="/dashboard"
            className="flex h-11 items-center rounded-md border border-border px-6 font-semibold"
          >
            {t('ended.toDashboard')}
          </Link>
        </div>
      </div>
    );
  }

  if (phase === 'setup' || phase === 'starting') {
    const langOptions = INTERPRET_LANGUAGES;
    const micActive = micLevel > 0.03;
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 py-2">
        {/* 히어로 — 아이콘 + 제목 나란히 */}
        <div className="flex flex-col items-center gap-6 pt-6 sm:flex-row sm:justify-center">
          <span
            className="hero-glow cta-orb-teal text-white"
            style={{ ['--glow-color' as string]: 'rgb(45 212 191 / .55)' }}
            aria-hidden
          >
            <Mic size={46} />
          </span>
          <div className="text-center sm:text-left">
            <h1 className="text-[40px] font-bold leading-tight tracking-tight">{t('title')}</h1>
            <p className="mt-1 text-[16px] text-text-muted">{t('setup.lead')}</p>
          </div>
        </div>

        {error ? <ErrorBanner k={error} /> : null}

        {/* 설정 카드 — 행 하나당 아이콘 칩 하나 */}
        <section className="row-divide overflow-hidden rounded-2xl border border-border bg-bg-raised">
          {/* 마이크 */}
          <SettingRow
            icon={<Mic size={20} />}
            tone={micActive ? 'teal' : 'default'}
            label={t('setup.micTitle')}
            right={
              micStream ? (
                <span
                  className={`flex items-center gap-1.5 text-[13.5px] font-semibold ${
                    micActive ? 'text-accent-2' : 'text-text-faint'
                  }`}
                >
                  <CheckCircle2 size={15} aria-hidden />
                  {micActive ? t('setup.micReady') : t('setup.micSilent')}
                </span>
              ) : (
                <button
                  onClick={requestMic}
                  className="h-10 rounded-lg bg-accent px-4 text-[14px] font-semibold text-accent-text"
                >
                  {t('setup.micRequest')}
                </button>
              )
            }
          >
            {micStream ? (
              <div className="flex h-8 items-center gap-[3px]">
                {Array.from({ length: 44 }).map((_, i) => {
                  const on = micLevel * 44 > i;
                  return (
                    <span
                      key={i}
                      className={`w-[3px] rounded-full transition-all duration-75 ${
                        on ? 'bg-accent-2' : 'bg-border'
                      }`}
                      style={{ height: on ? `${20 + ((i * 37) % 14)}px` : '4px' }}
                    />
                  );
                })}
              </div>
            ) : (
              <p className="text-[13.5px] text-text-faint">{t('setup.micNeed')}</p>
            )}
          </SettingRow>

          {/* 입력 언어 — 자동 감지 기본 */}
          <SettingRow
            icon={<Globe size={20} />}
            label={t('setup.sourceLang')}
            hint={sourceLang === 'auto' ? t('setup.autoDetectHint') : undefined}
          >
            <FieldSelect
              id="source-lang"
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value as SourceLangSetting)}
            >
              <option value="auto">{t('setup.autoDetect')}</option>
              {langOptions.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </FieldSelect>
          </SettingRow>

          {/* 표시 언어 — 유저가 고르는 유일한 값 (core.md §3-1) */}
          <SettingRow
            icon={<span className="text-[17px] font-bold">A</span>}
            tone="accent"
            label={t('setup.targetLang')}
            hint={t('setup.targetHint')}
          >
            <FieldSelect
              id="target-lang"
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value as LangCode)}
            >
              {/* 출력 언어는 엔진 지원 목록만 노출 (docs/04 §2) */}
              {langOptions
                .filter((l) => TRANSLATE_TARGET_LANGS.includes(l.code))
                .map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
            </FieldSelect>
          </SettingRow>

          {/* 음성 출력 — 옵션 채널. 사과하지 말고 사실만 적는다 (docs/04 §3) */}
          <SettingRow
            icon={audioOut ? <Volume2 size={20} /> : <VolumeX size={20} />}
            tone={audioOut ? 'teal' : 'default'}
            label={t('setup.audioOut')}
            hint={audioOut ? t('setup.headsetHint') : t('setup.audioOutHint')}
            right={<Toggle checked={audioOut} onChange={setAudioOut} label={t('setup.audioOut')} />}
          />
        </section>

        <div className="flex flex-col gap-3">
          <button
            onClick={start}
            disabled={!micStream || phase === 'starting'}
            className="btn-gradient flex h-16 items-center justify-center gap-2.5 rounded-xl text-[19px] font-bold transition-opacity duration-150 disabled:cursor-not-allowed"
          >
            <Play size={20} aria-hidden fill="currentColor" />
            {phase === 'starting' ? t('running.connecting') : t('setup.start')}
          </button>
          {/* 고지 — 시작이 곧 동의 (docs/08 §2.2) */}
          <p className="flex items-center justify-center gap-1.5 text-[13.5px] text-text-faint">
            <Lock size={13} aria-hidden />
            {t('consentNotice')}
          </p>
        </div>
      </div>
    );
  }

  // ── LIVE ──
  const capWarning =
    remainingSec !== null && remainingSec <= CAP_WARNING_SEC && remainingSec > 0;

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-4 bg-bg"
      style={{ height: isFullscreen ? '100vh' : 'calc(100vh - 9.5rem)' }}
    >
      {/* 상태 바 (docs/05 §4) */}
      <div className="flex h-16 shrink-0 items-center gap-4 rounded-xl border border-border bg-bg-raised px-5">
        <span className="flex items-center gap-2 text-[16px] font-bold text-accent">
          <span aria-hidden className="live-dot inline-block h-2.5 w-2.5 rounded-full bg-accent" />
          {t('running.live')}
        </span>
        <span className="hidden items-center gap-2 text-[16px] text-text-muted sm:flex">
          <span>{sourceLang === 'auto' ? t('setup.autoDetect') : languageLabel(sourceLang)}</span>
          <span aria-hidden className="text-text-faint">→</span>
          <span className="font-semibold text-text">{languageLabel(targetLang)}</span>
        </span>
        {trial ? (
          <span className="tabular ml-auto rounded-md bg-accent-weak px-3 py-1 text-[15px] font-semibold text-accent">
            {tTry('counter', { used: Math.min(trialUsedChars, trialBudget), max: trialBudget })}
          </span>
        ) : null}
        <span className={`tabular text-[22px] font-bold ${trial ? '' : 'ml-auto'}`}>
          {fmtSec(elapsedSec)}
        </span>
      </div>

      {capWarning ? (
        <div className="shrink-0 rounded-lg bg-warn-weak px-5 py-3 text-[16px] font-semibold text-warn">
          {t('running.capWarning', { sec: remainingSec })}
        </div>
      ) : null}

      {/* 자동재생이 막힌 경우 — 클릭 한 번으로 소리를 켠다 */}
      {audioOut && needsAudioGesture ? (
        <button
          onClick={() => {
            const el = audioElRef.current;
            if (!el) return;
            el.muted = false;
            void el
              .play()
              .then(() => setNeedsAudioGesture(false))
              .catch(() => undefined);
          }}
          className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-accent-weak px-5 py-3 text-[16px] font-semibold text-accent"
        >
          <Volume2 size={18} aria-hidden />
          {t('running.enableSound')}
        </button>
      ) : null}

      {/* 음성은 켰는데 트랙이 아직 없을 때 — 원인을 알려준다 */}
      {audioOut && !remoteStream ? (
        <p className="shrink-0 rounded-lg bg-bg-sunken px-5 py-2.5 text-[14px] text-text-muted">
          {t('running.audioWaiting')}
        </p>
      ) : null}

      <CaptionPanel segments={segments} scale={SIZE_SCALE[captionSize]} live />

      {/* 컨트롤 4개를 넘지 않는다: 종료 / 음성 출력 / 자막 크기 / 전체화면 (docs/06 §2.2) */}
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <button
          onClick={() => setConfirmEnd(true)}
          className="flex h-14 items-center gap-2.5 rounded-xl bg-danger px-8 text-[17px] font-bold text-white"
        >
          <Square size={16} aria-hidden fill="currentColor" />
          {t('running.end')}
        </button>
        <button
          onClick={() => toggleAudioOut(!audioOut)}
          aria-pressed={audioOut}
          className={`flex h-14 items-center gap-2.5 rounded-xl border-2 px-6 text-[16px] font-semibold transition-colors duration-150 ${
            audioOut
              ? 'border-accent-2 bg-accent-2-weak text-accent-2'
              : 'border-border text-text-muted'
          }`}
        >
          {audioOut ? <Volume2 size={19} aria-hidden /> : <VolumeX size={19} aria-hidden />}
          {t('running.audioOut')}
        </button>
        <div
          role="radiogroup"
          aria-label={t('running.captionSize')}
          className="flex h-14 items-center rounded-xl border border-border p-1"
        >
          {(['md', 'lg', 'xl'] as const).map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={captionSize === s}
              onClick={() => setCaptionSize(s)}
              className={`h-12 rounded-lg px-4 text-[16px] transition-colors duration-150 ${
                captionSize === s
                  ? 'bg-accent font-bold text-accent-text'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {s === 'md' ? t('running.sizeMd') : s === 'lg' ? t('running.sizeLg') : t('running.sizeXl')}
            </button>
          ))}
        </div>
        <button
          onClick={toggleFullscreen}
          className="ml-auto flex h-14 items-center gap-2.5 rounded-xl border border-border px-6 text-[16px] font-semibold text-text-muted"
        >
          {isFullscreen ? <Minimize2 size={19} aria-hidden /> : <Maximize2 size={19} aria-hidden />}
          <span className="hidden sm:inline">
            {isFullscreen ? t('running.exitFullscreen') : t('running.fullscreen')}
          </span>
        </button>
      </div>

      {/*
        번역 오디오 — WebRTC 라이브 트랙이라 밀린 음성이 쌓이지 않고 실시간을 따라간다.
        display:none이면 재생을 막는 브라우저가 있어 화면 밖으로만 밀어낸다.
      */}
      <audio
        ref={audioElRef}
        autoPlay
        playsInline
        className="pointer-events-none absolute h-px w-px opacity-0"
        aria-hidden
      />

      {confirmEnd ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-lg bg-bg-raised p-6 shadow-token">
            <h2 className="text-[20px] font-semibold">{t('endDialog.title')}</h2>
            <p className="text-sm text-text-muted">{t('endDialog.body')}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmEnd(false)}
                className="h-10 rounded-md border border-border px-4 text-sm font-semibold"
              >
                {t('endDialog.cancel')}
              </button>
              <button
                onClick={() => {
                  setConfirmEnd(false);
                  void doEnd('user');
                }}
                className="h-10 rounded-md bg-danger px-4 text-sm font-semibold text-white"
              >
                {t('endDialog.confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 오류는 "무엇이 잘못됐고 어떻게 고치는지"를 항상 쌍으로 (core.md §6) */
function ErrorBanner({ k }: { k: ErrorKey }) {
  const t = useTranslations('live.errors');
  return (
    <div className="w-full rounded-md bg-danger-weak px-4 py-3 text-left">
      <p className="font-semibold text-danger">{t(`${k}.title`)}</p>
      <p className="text-sm text-text-muted">{t(`${k}.action`)}</p>
    </div>
  );
}
