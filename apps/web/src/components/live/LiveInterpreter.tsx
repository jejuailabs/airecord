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
  AlertTriangle,
  Clock,
  Captions,
  Languages,
  Sparkles,
  RotateCcw,
  LayoutDashboard,
  CreditCard,
  ChevronRight,
  Loader2,
  Pause,
  ArrowLeft,
} from 'lucide-react';
import { FieldSelect } from '@/components/ui/SettingRow';
import { SetupStepper, type StepDef } from '@/components/live/SetupStepper';
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

/** 'wrapping' — 입력은 끊었지만 남은 번역이 도착하길 기다리는 구간 */
type Phase = 'setup' | 'starting' | 'live' | 'wrapping' | 'ended';
type CaptionSize = 'md' | 'lg' | 'xl';
type ErrorKey =
  | 'micPermission'
  | 'startFailed'
  | 'keyMissing'
  | 'connectionLost'
  | 'unsupportedPair'
  | 'guestQuota'
  | 'quotaExhausted'
  | 'authRequired';

const SIZE_SCALE: Record<CaptionSize, number> = { md: 1.0, lg: 1.3, xl: 1.7 };
const LAST_PAIR_KEY = 'sotong-last-pair';
const CAP_WARNING_SEC = 30; // 예고 없이 끊지 않는다 (docs/07 §5.2)
/** 종료 시 남은 번역을 기다리는 최대 시간 — 이 시간도 과금되므로 짧게 잡는다 */
const WRAP_MAX_MS = 5_000;
/** 이 시간 동안 자막 갱신이 없으면 더 기다리지 않고 닫는다 */
const WRAP_IDLE_MS = 1_500;

function fmtSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function LiveInterpreter({ trial = false }: { trial?: boolean } = {}) {
  const t = useTranslations('live');
  const tTry = useTranslations('try');

  const [phase, setPhase] = useState<Phase>('setup');
  /** 시작 화면 단계 (1 마이크 → 2 입력 언어 → 3 표시 언어) */
  const [step, setStep] = useState(1);
  /** 세션 제목 — 비워두면 AI 요약이 제목을 만들어 채운다 */
  const [title, setTitle] = useState('');
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
  /** 일시정지 — 마이크 트랙만 끊는다. 세션은 살아 있어 재개가 즉시 된다. */
  const [paused, setPaused] = useState(false);
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
  /** seq → 화면에 처음 뜬 시각. 번역이 끝내 오지 않는 덩어리를 찾는 데 쓴다. */
  const seenAtRef = useRef(new Map<number, number>());
  /** 이미 텍스트 번역으로 메운(또는 메우는 중인) seq */
  const recoveredRef = useRef(new Set<number>());
  /** 마지막으로 세그먼트가 갱신된 시각 — 종료 시 남은 번역을 기다리는 판단에 쓴다 */
  const lastSegmentAtRef = useRef(0);
  /** 타이머 콜백에서 최신 자막 목록을 보기 위한 ref */
  const segmentsRef = useRef<EngineSegment[]>([]);
  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

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
      setStep(2); // 허용되면 바로 다음 단계로 — 유저가 한 번 더 누를 이유가 없다
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

      /**
       * 입력을 먼저 끊고, 남은 번역이 도착할 시간을 조금 준다.
       * 세션을 즉시 닫으면 마지막 몇 문장의 번역과 통역 음성이 통째로 잘린다
       * (실측 2026-07: 입력이 끊긴 뒤 마지막 번역 +3.1초).
       * 세션이 열려 있는 동안은 계속 과금되므로 최대 대기 시간을 짧게 못 박는다.
       */
      if (reason !== 'error') {
        micStream?.getAudioTracks().forEach((tr) => {
          tr.enabled = false;
        });
        setPhase('wrapping');
        const deadline = Date.now() + WRAP_MAX_MS;
        while (Date.now() < deadline && Date.now() - lastSegmentAtRef.current < WRAP_IDLE_MS) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }

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
        body: JSON.stringify({
          mode: 'inperson',
          sourceLang,
          targetLang,
          audioOut,
          trial,
          title: title.trim() || undefined,
        }),
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
                : body.error === 'quota_exhausted'
                  ? 'quotaExhausted'
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
          targetLang,
          expiresAt: grant.keyExpiresAt,
          model: grant.model,
          provider: grant.provider,
          callUrl: grant.callUrl,
        },
        micStream,
        {
          onSegment: (seg) => {
            lastSegmentAtRef.current = Date.now();
            if (!seenAtRef.current.has(seg.seq)) seenAtRef.current.set(seg.seq, Date.now());
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
    seenAtRef.current.clear();
    recoveredRef.current.clear();
    lastSegmentAtRef.current = Date.now();
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

  /**
   * 번역이 끝내 오지 않은 덩어리를 텍스트 번역 엔진으로 메운다.
   *
   * 실측(2026-07): 입력이 문장 도중에 끊기면(유튜브 일시정지 등) 원문 전사는 끝까지 오는데
   * 그 마지막 발화의 번역은 통역 모델이 영영 내보내지 않는다. 세션은 살아 있으므로
   * 화면에는 원문만 남고 자막이 멈춘 것처럼 보인다.
   * 통역 모델을 기다리게 둘 수 없으니, 일정 시간이 지나면 같은 문장을 텍스트 번역으로 채운다.
   */
  useEffect(() => {
    if (phase !== 'live' || trial) return;
    const RECOVER_AFTER_MS = 4_000;
    const id = setInterval(() => {
      const now = Date.now();
      for (const seg of segmentsRef.current) {
        if (seg.sameAsTarget) continue;
        if (seg.targetText.trim()) continue;
        if (seg.sourceText.trim().length < 2) continue;
        if (recoveredRef.current.has(seg.seq)) continue;
        const seenAt = seenAtRef.current.get(seg.seq) ?? now;
        if (now - seenAt < RECOVER_AFTER_MS) continue;

        recoveredRef.current.add(seg.seq);
        const source = seg.sourceText;
        void fetch('/api/translate/text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: source, sourceLang: 'auto', targetLang, tone: 'plain' }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((body: { translated?: string } | null) => {
            const translated = body?.translated?.trim();
            if (!translated) return;
            setSegments((prev) =>
              prev.map((p) =>
                // 그 사이 통역 모델이 번역을 보냈다면 그쪽을 존중한다
                p.seq === seg.seq && !p.targetText.trim()
                  ? { ...p, targetText: translated, isFinal: true, recovered: true }
                  : p,
              ),
            );
            const patched = segmentsRef.current.find((p) => p.seq === seg.seq);
            if (patched) {
              pendingFinalsRef.current.set(seg.seq, {
                ...patched,
                targetText: translated,
                isFinal: true,
              });
            }
          })
          .catch(() => {
            /* 복구 실패 — 원문만이라도 남는다 */
          });
      }
    }, 1_200);
    return () => clearInterval(id);
  }, [phase, targetLang, trial]);

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

  /**
   * 일시정지: 마이크 트랙을 비활성화한다.
   * 세션을 닫지 않으므로 재개할 때 재연결 대기가 없다.
   * ⚠ 세션이 열려 있는 동안은 계속 과금되므로 (core.md §3-6) 하드 캡·하트비트는 그대로 돈다.
   */
  const togglePause = useCallback(() => {
    setPaused((prev) => {
      const next = !prev;
      micStream?.getAudioTracks().forEach((tr) => {
        tr.enabled = !next;
      });
      // 일시정지 중에는 번역 음성도 멈춘다
      const el = audioElRef.current;
      if (el) el.muted = next ? true : !audioOutRef.current;
      return next;
    });
  }, [micStream]);

  /**
   * 전체화면.
   * iOS 사파리는 일반 요소의 requestFullscreen을 지원하지 않아 버튼이 아무 반응도 없었다.
   * 네이티브 API가 있으면 그걸 쓰고, 없으면 화면을 덮는 몰입 모드로 대체한다.
   */
  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    const supported = typeof el?.requestFullscreen === 'function';
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsFullscreen(false);
        return;
      }
      if (supported && el) {
        await el.requestFullscreen();
        setIsFullscreen(true);
        return;
      }
    } catch {
      /* 브라우저가 거부하면 아래 몰입 모드로 떨어진다 */
    }
    setIsFullscreen((v) => !v);
  }, []);

  // 네이티브 전체화면을 ESC 등으로 빠져나온 경우 상태를 맞춘다
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && document.fullscreenEnabled) setIsFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const [confirmEnd, setConfirmEnd] = useState(false);

  // ─────────────────────── 렌더 ───────────────────────

  if (phase === 'ended' && summary && trial) {
    // 체험 종료 — 여기가 가입 전환 지점이다
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-8 py-2">
        <div className="w-full">
          <Link
            href="/"
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-border px-4 text-[15px] font-semibold text-text-muted hover:text-text"
          >
            <ArrowLeft size={17} aria-hidden />
            {tTry('ended.backToMain')}
          </Link>
        </div>

        <div className="flex flex-col items-center gap-5 text-center">
          <span
            className="hero-glow cta-orb-teal text-white"
            style={{ ['--glow-color' as string]: 'rgb(45 212 191 / .55)' }}
            aria-hidden
          >
            <CheckCircle2 size={46} />
          </span>
          <div>
            <h1 className="text-[36px] font-bold tracking-tight">{tTry('ended.title')}</h1>
            <p className="mt-1.5 max-w-lg text-[16px] text-text-muted">{tTry('ended.body')}</p>
          </div>
        </div>

        <dl className="grid w-full gap-3 sm:grid-cols-3">
          <SummaryStat
            icon={<Clock size={20} />}
            label={t('ended.duration')}
            value={fmtSec(summary.billedSeconds)}
          />
          <SummaryStat
            icon={<Captions size={20} />}
            label={t('ended.segmentsLabel')}
            value={String(summary.segmentCount)}
          />
          <SummaryStat
            icon={<Languages size={20} />}
            label={t('ended.langPair')}
            value={`${sourceLang === 'auto' ? t('setup.autoDetect') : languageLabel(sourceLang)} → ${languageLabel(targetLang)}`}
            small
          />
        </dl>

        <div className="flex w-full flex-col gap-3 sm:flex-row">
          <Link
            href="/login"
            className="btn-gradient flex h-14 flex-1 items-center justify-center gap-2.5 rounded-xl text-[17px] font-bold"
          >
            <Sparkles size={19} aria-hidden />
            {tTry('ended.signup')}
          </Link>
          <Link
            href="/#pricing"
            className="flex h-14 flex-1 items-center justify-center gap-2.5 rounded-xl border border-border text-[17px] font-semibold"
          >
            <CreditCard size={19} aria-hidden />
            {tTry('ended.pricing')}
          </Link>
        </div>
        <p className="flex items-center gap-1.5 text-[14px] text-text-faint">
          <Lock size={13} aria-hidden />
          {tTry('ended.freeNote')}
        </p>
      </div>
    );
  }

  if (phase === 'ended' && summary) {
    const restart = () => {
      setSummary(null);
      setError(null);
      setSegments([]);
      setRemoteStream(null);
      setPhase('setup');
    };
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-8 py-2">
        {/* 상단 좌측 — 메인으로 돌아가기 */}
        <div className="w-full">
          <Link
            href="/dashboard"
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-border px-4 text-[15px] font-semibold text-text-muted hover:text-text"
          >
            <ArrowLeft size={17} aria-hidden />
            {t('ended.backToMain')}
          </Link>
        </div>

        {/* 완료 히어로 */}
        <div className="flex flex-col items-center gap-5 text-center">
          <span
            className={`hero-glow ${error ? 'bg-danger' : 'cta-orb-teal'} text-white`}
            style={{
              ['--glow-color' as string]: error
                ? 'rgb(196 60 44 / .45)'
                : 'rgb(45 212 191 / .55)',
            }}
            aria-hidden
          >
            {error ? <AlertTriangle size={46} /> : <CheckCircle2 size={46} />}
          </span>
          <div>
            <h1 className="text-[36px] font-bold tracking-tight">{t('ended.title')}</h1>
            <p className="mt-1.5 text-[16px] text-text-muted">
              {savedSessionId ? t('ended.savedNote') : t('ended.notSavedNote')}
            </p>
          </div>
        </div>

        {error ? <ErrorBanner k={error} /> : null}

        {/* 요약 지표 */}
        <dl className="grid w-full gap-3 sm:grid-cols-3">
          <SummaryStat
            icon={<Clock size={20} />}
            label={t('ended.duration')}
            value={fmtSec(summary.billedSeconds)}
          />
          <SummaryStat
            icon={<Captions size={20} />}
            label={t('ended.segmentsLabel')}
            value={String(summary.segmentCount)}
          />
          <SummaryStat
            icon={<Languages size={20} />}
            label={t('ended.langPair')}
            value={`${sourceLang === 'auto' ? t('setup.autoDetect') : languageLabel(sourceLang)} → ${languageLabel(targetLang)}`}
            small
          />
        </dl>

        {/* 다음 행동 */}
        <div className="flex w-full flex-col gap-3 sm:flex-row">
          {savedSessionId ? (
            <Link
              href={`/sessions/${savedSessionId}`}
              className="btn-gradient flex h-14 flex-1 items-center justify-center gap-2.5 rounded-xl text-[17px] font-bold"
            >
              <Sparkles size={19} aria-hidden />
              {t('ended.viewRecord')}
            </Link>
          ) : null}
          <button
            onClick={restart}
            className={`flex h-14 flex-1 items-center justify-center gap-2.5 rounded-xl text-[17px] font-bold ${
              savedSessionId ? 'border border-border text-text' : 'btn-gradient'
            }`}
          >
            <RotateCcw size={19} aria-hidden />
            {t('ended.again')}
          </button>
          <Link
            href="/dashboard"
            className="flex h-14 items-center justify-center gap-2.5 rounded-xl border border-border px-6 text-[17px] font-semibold text-text-muted sm:flex-none"
          >
            <LayoutDashboard size={19} aria-hidden />
            {t('ended.toDashboard')}
          </Link>
        </div>
      </div>
    );
  }

  if (phase === 'setup' || phase === 'starting') {
    const langOptions = INTERPRET_LANGUAGES;
    const micActive = micLevel > 0.03;
    const micReady = Boolean(micStream);

    /**
     * 입력 언어 단계는 두지 않는다.
     * 이 엔진은 입력 언어 파라미터를 받지 않고 항상 자동 감지하므로(실측 확인),
     * 유저가 고르게 하면 "골랐는데 왜 반영이 안 되지?"라는 혼란만 생긴다.
     */
    const steps: StepDef[] = [
      {
        id: 1,
        icon: <Mic size={24} />,
        label: t('setup.steps.mic'),
        done: micReady,
        locked: false,
      },
      {
        id: 2,
        icon: <span className="text-[19px] font-bold">A</span>,
        label: t('setup.steps.target'),
        done: false,
        locked: !micReady,
      },
    ];

    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 py-2">
        {/* 제목 + 음성 토글 — 제목과 같은 무게로 마주 보게 둔다 */}
        <div className="flex items-center gap-3">
          <span
            className="cta-orb-teal flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white"
            style={{
              boxShadow:
                '0 8px 20px -8px rgb(45 212 191 / .6), inset 0 1px 0 rgb(255 255 255 / .3)',
            }}
            aria-hidden
          >
            <Mic size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] font-bold leading-tight tracking-tight sm:text-[30px]">
              {t('title')}
            </h1>
            <p className="text-[14px] text-text-muted">{t('setup.lead')}</p>
          </div>

          {/* 음성 번역 토글 — 스위치 모양 + 아래 라벨. 아이콘만 두면 무슨 기능인지 모른다. */}
          <button
            type="button"
            role="switch"
            aria-checked={audioOut}
            onClick={() => setAudioOut(!audioOut)}
            title={audioOut ? t('setup.headsetHint') : t('setup.audioOutHint')}
            className="flex w-[68px] shrink-0 flex-col items-center gap-1.5"
          >
            <span
              className={`relative flex h-9 w-full items-center rounded-full border transition-colors duration-200 ${
                audioOut ? 'border-transparent bg-accent-2-weak' : 'border-border bg-bg-sunken'
              }`}
              aria-hidden
            >
              <span
                className={`absolute flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200 ${
                  audioOut
                    ? 'cta-orb-teal left-[calc(100%-32px)] text-white'
                    : 'left-[4px] bg-bg-raised text-text-faint shadow-token'
                }`}
              >
                {audioOut ? <Volume2 size={15} /> : <VolumeX size={15} />}
              </span>
            </span>
            <span
              className={`text-center text-[10.5px] font-semibold leading-tight ${
                audioOut ? 'text-accent-2' : 'text-text-muted'
              }`}
            >
              {t('setup.audioOutStacked')}
            </span>
          </button>
        </div>

        <SetupStepper steps={steps} current={step} onSelect={(id) => setStep(id)} />

        {error ? <ErrorBanner k={error} /> : null}

        {/* 현재 단계 패널 — 한 번에 하나만 보여 과정이 늘어지지 않게 한다 */}
        <section className="rounded-2xl border border-border bg-bg-raised p-5">
          {step === 1 ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span
                  className={`icon-chip ${micActive ? 'icon-chip-teal' : ''}`}
                  aria-hidden
                >
                  <Mic size={20} />
                </span>
                <div className="min-w-0">
                  <h2 className="whitespace-nowrap text-[17px] font-semibold">
                    {t('setup.micTitle')}
                  </h2>
                  <p className="text-[13.5px] text-text-faint">
                    {micReady
                      ? micActive
                        ? t('setup.micReady')
                        : t('setup.micSilent')
                      : t('setup.micNeed')}
                  </p>
                </div>
                {micReady ? (
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[13.5px] font-semibold text-accent-2">
                    <CheckCircle2 size={16} aria-hidden />
                    {t('setup.micAllowed')}
                  </span>
                ) : null}
              </div>

              {micReady ? (
                <>
                  <div className="flex h-10 items-center gap-[3px]">
                    {Array.from({ length: 40 }).map((_, i) => {
                      const on = micLevel * 40 > i;
                      return (
                        <span
                          key={i}
                          className={`flex-1 rounded-full transition-all duration-75 ${
                            on ? 'bg-accent-2' : 'bg-border'
                          }`}
                          style={{ height: on ? `${18 + ((i * 37) % 16)}px` : '4px' }}
                        />
                      );
                    })}
                  </div>
                  <button
                    onClick={() => setStep(2)}
                    className="flex h-12 items-center justify-center gap-1.5 rounded-xl bg-accent text-[15px] font-bold text-accent-text"
                  >
                    {t('setup.next')}
                    <ChevronRight size={17} aria-hidden />
                  </button>
                </>
              ) : (
                <button
                  onClick={requestMic}
                  className="btn-gradient flex h-12 items-center justify-center gap-2 rounded-xl text-[15px] font-bold"
                >
                  <Mic size={17} aria-hidden />
                  {t('setup.micRequest')}
                </button>
              )}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="icon-chip icon-chip-accent" aria-hidden>
                  <span className="text-[17px] font-bold">A</span>
                </span>
                <div>
                  <h2 className="text-[17px] font-semibold">{t('setup.targetLang')}</h2>
                  <p className="text-[13.5px] text-text-faint">{t('setup.targetHint')}</p>
                </div>
              </div>
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

              {/* 제목은 선택 사항 — 비워두면 AI가 요약할 때 붙여준다 */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="session-title" className="text-[14px] font-semibold">
                  {t('setup.titleLabel')}
                </label>
                <input
                  id="session-title"
                  type="text"
                  value={title}
                  maxLength={80}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t('setup.titlePlaceholder')}
                  className="h-12 rounded-lg border border-border bg-bg-sunken px-4 text-[15px]"
                />
                <p className="text-[13px] text-text-faint">{t('setup.titleHint')}</p>
              </div>

              {/* 입력 언어는 엔진이 발화마다 자동 감지한다 (지정 파라미터가 없다) */}
              <p className="flex items-start gap-2 rounded-lg bg-bg-sunken px-4 py-2.5 text-[13.5px] text-text-muted">
                <Globe size={15} aria-hidden className="mt-0.5 shrink-0 text-accent" />
                {t('setup.autoDetectFixed', { target: languageLabel(targetLang) })}
              </p>
            </div>
          ) : null}
        </section>

        {/* 음성을 켰을 때만 주의사항 한 줄 (docs/04 §3 — 사과하지 말고 사실만) */}
        {audioOut ? (
          <p className="rounded-lg bg-warn-weak px-4 py-2.5 text-[13px] text-warn">
            {t('setup.headsetHint')}
          </p>
        ) : null}

        <div className="flex flex-col gap-2.5">
          <button
            onClick={start}
            disabled={!micReady || phase === 'starting'}
            className="btn-gradient flex h-16 items-center justify-center gap-2.5 rounded-xl text-[19px] font-bold transition-opacity duration-150 disabled:cursor-not-allowed"
          >
            {phase === 'starting' ? (
              <Loader2 size={20} className="animate-spin" aria-hidden />
            ) : (
              <Play size={20} aria-hidden fill="currentColor" />
            )}
            {phase === 'starting' ? t('running.connecting') : t('setup.start')}
          </button>
          {/* 고지 — 시작이 곧 동의 (docs/08 §2.2) */}
          <p className="flex items-center justify-center gap-1.5 text-[13px] text-text-faint">
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
      className={`flex flex-col gap-3 bg-bg ${
        isFullscreen ? 'fixed inset-0 z-50 p-3' : ''
      }`}
      style={{ height: isFullscreen ? '100dvh' : 'calc(100dvh - 6.5rem)' }}
    >
      {/* 상태 바 (docs/05 §4) */}
      <div className="flex h-14 shrink-0 items-center gap-3 rounded-xl border border-border bg-bg-raised px-4">
        {phase === 'wrapping' ? (
          <span className="flex items-center gap-2 text-[16px] font-bold text-text-muted">
            <Loader2 size={15} aria-hidden className="animate-spin" />
            {t('running.wrapping')}
          </span>
        ) : paused ? (
          <span className="flex items-center gap-2 text-[16px] font-bold text-warn">
            <Pause size={15} aria-hidden fill="currentColor" />
            {t('running.paused')}
          </span>
        ) : (
          <span className="flex items-center gap-2 text-[16px] font-bold text-accent">
            <span aria-hidden className="live-dot inline-block h-2.5 w-2.5 rounded-full bg-accent" />
            {t('running.live')}
          </span>
        )}
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
      {/* 컨트롤 한 줄 — 좁은 화면에서는 보조 버튼을 아이콘만 남긴다 (docs/06 §2.2) */}
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={() => setConfirmEnd(true)}
          disabled={phase === 'wrapping'}
          className="flex h-12 shrink-0 items-center gap-2 rounded-xl bg-danger px-4 text-[15px] font-bold text-white disabled:opacity-50 sm:px-5"
        >
          <Square size={14} aria-hidden fill="currentColor" />
          {t('running.end')}
        </button>
        <button
          onClick={togglePause}
          disabled={phase === 'wrapping'}
          aria-pressed={paused}
          className={`flex h-12 shrink-0 items-center gap-2 rounded-xl border px-4 text-[15px] font-semibold transition-colors duration-150 ${
            paused ? 'border-warn bg-warn-weak text-warn' : 'border-border text-text'
          }`}
        >
          {paused ? (
            <Play size={16} aria-hidden fill="currentColor" />
          ) : (
            <Pause size={16} aria-hidden fill="currentColor" />
          )}
          {paused ? t('running.resume') : t('running.pause')}
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            onClick={() => toggleAudioOut(!audioOut)}
            aria-pressed={audioOut}
            aria-label={t('running.audioOut')}
            title={t('running.audioOut')}
            className={`flex h-12 w-12 items-center justify-center rounded-xl border transition-colors duration-150 ${
              audioOut
                ? 'border-accent-2 bg-accent-2-weak text-accent-2'
                : 'border-border text-text-muted'
            }`}
          >
            {audioOut ? <Volume2 size={18} aria-hidden /> : <VolumeX size={18} aria-hidden />}
          </button>

          <button
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? t('running.exitFullscreen') : t('running.fullscreen')}
            title={isFullscreen ? t('running.exitFullscreen') : t('running.fullscreen')}
            className="flex h-12 w-12 items-center justify-center rounded-xl border border-border text-text-muted"
          >
            {isFullscreen ? <Minimize2 size={18} aria-hidden /> : <Maximize2 size={18} aria-hidden />}
          </button>
        </div>
      </div>

      {/* 글자 크기 — 가운데 아래로 내려 화면 밖으로 밀리지 않게 한다 */}
      <div className="flex shrink-0 justify-center">
        <div
          role="radiogroup"
          aria-label={t('running.captionSize')}
          className="flex h-12 items-center gap-1 rounded-xl border border-border px-1.5"
        >
          {(['md', 'lg', 'xl'] as const).map((s, i) => (
            <button
              key={s}
              role="radio"
              aria-checked={captionSize === s}
              onClick={() => setCaptionSize(s)}
              className={`flex h-10 items-center gap-1.5 rounded-lg px-3 transition-colors duration-150 ${
                captionSize === s
                  ? 'bg-accent text-accent-text'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              <span className="font-bold" style={{ fontSize: `${12 + i * 4}px` }}>
                가
              </span>
              <span className="text-[13px] font-semibold">
                {s === 'md'
                  ? t('running.sizeMd')
                  : s === 'lg'
                    ? t('running.sizeLg')
                    : t('running.sizeXl')}
              </span>
            </button>
          ))}
        </div>
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
    <div className="flex w-full items-start gap-3.5 rounded-xl bg-danger-weak px-5 py-4 text-left">
      <AlertTriangle size={20} aria-hidden className="mt-0.5 shrink-0 text-danger" />
      <div>
        <p className="text-[16px] font-semibold text-danger">{t(`${k}.title`)}</p>
        <p className="mt-0.5 text-[14.5px] text-text-muted">{t(`${k}.action`)}</p>
      </div>
    </div>
  );
}

/** 종료 화면 지표 카드 */
function SummaryStat({
  icon,
  label,
  value,
  small,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-border bg-bg-raised px-5 py-4">
      <span className="icon-chip icon-chip-accent" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-[13px] text-text-muted">{label}</dt>
        <dd
          className={`tabular truncate font-bold ${small ? 'text-[16px]' : 'text-[24px] leading-tight'}`}
        >
          {value}
        </dd>
      </div>
    </div>
  );
}
