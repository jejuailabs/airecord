/**
 * OpenAI 통역 전용 모델 어댑터 — `gpt-realtime-translate` (2026-05-07 출시).
 *
 * 선택 근거 (2026-07 조사·비교 후 결정):
 * - 분당 $0.034 정액 → 원가 모델(docs/07)과 일치
 * - 소스 언어 자동 감지 내장(입력 70+), 출력 13개 언어
 * - 턴 없는 연속 스트림 → 드리프트 최소화 (core.md §3-2)
 * - 번역만 출력하도록 학습됨 → 범용 모델의 "질문에 대답" 리스크 제거
 *
 * 모델명·전사 모델은 환경변수로 교체 가능 (core.md §3-7).
 */
import type {
  EphemeralGrant,
  OpenOpts,
  TranslationEngine,
  TranslationSession,
  EngineSegment,
  EngineError,
} from './types';
import { createSegmentAssembler } from './segment-assembler';
import { TRANSLATE_TARGET_LANGS } from '../constants';
import type { LangCode, SourceLangSetting } from '../types';

const env = (k: string): string | undefined =>
  typeof process !== 'undefined' ? process.env?.[k] : undefined;

const baseUrl = () => env('OPENAI_BASE_URL') ?? 'https://api.openai.com';
const modelName = () => env('TRANSLATION_MODEL_OPENAI') ?? 'gpt-realtime-translate';
const apiKey = () => {
  const k = env('OPENAI_API_KEY');
  if (!k) throw new Error('OPENAI_API_KEY is not set');
  return k;
};

/**
 * 번역 전용 세션 설정.
 * 소스 언어는 지정하지 않는다 — 모델이 발화마다 자동 감지한다.
 * 커스텀 지시문·음성 선택은 지원하지 않는다(전용 모델 특성).
 */
export function buildTranslateSessionConfig(opts: OpenOpts) {
  return {
    model: modelName(),
    audio: {
      output: { language: opts.targetLang },
      input: {
        // 원문 자막용 입력 전사 — 실청구에 별도 가산되는지 실측 시 확인 (docs/07 §6)
        transcription: { model: env('TRANSCRIPTION_MODEL') ?? 'gpt-realtime-whisper' },
      },
    },
  };
}

async function mintEphemeralKey(opts: OpenOpts): Promise<EphemeralGrant> {
  const res = await fetch(`${baseUrl()}/v1/realtime/translations/client_secrets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // 수명 짧게, 세션 1회용 (docs/08 §3)
      expires_after: { anchor: 'created_at', seconds: 600 },
      session: buildTranslateSessionConfig(opts),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI translate client_secrets failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { value: string; expires_at: number };
  return {
    key: json.value,
    expiresAt: json.expires_at * 1000,
    model: modelName(),
    provider: 'openai',
    callUrl: `${baseUrl()}/v1/realtime/translations/calls`,
  };
}

/**
 * 서버 릴레이 세션 (모드 A — 워커 전용).
 * Node 22+ 전역 WebSocket. 커스텀 헤더 불가 → 서브프로토콜 인증.
 */
async function openServerSession(opts: OpenOpts): Promise<TranslationSession> {
  const url = `${baseUrl().replace(/^http/, 'ws')}/v1/realtime/translations?model=${encodeURIComponent(modelName())}`;
  const ws = new WebSocket(url, ['realtime', `openai-insecure-api-key.${apiKey()}`]);

  const segmentCbs: Array<(s: EngineSegment) => void> = [];
  const audioCbs: Array<(c: ArrayBuffer) => void> = [];
  const errorCbs: Array<(e: EngineError) => void> = [];
  const assembler = createSegmentAssembler(
    (s) => segmentCbs.forEach((cb) => cb(s)),
    (code, message) => errorCbs.forEach((cb) => cb({ code, message, fatal: false })),
  );

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('OpenAI translate WS connect failed')), {
      once: true,
    });
  });

  const { model: _m, ...sessionPatch } = buildTranslateSessionConfig(opts);
  ws.send(JSON.stringify({ type: 'session.update', session: sessionPatch }));
  const dispose = () => assembler.dispose();

  ws.addEventListener('message', (ev) => {
    try {
      const evt = JSON.parse(String(ev.data));
      if (
        (evt.type === 'response.output_audio.delta' ||
          evt.type === 'session.output_audio.delta' ||
          evt.type === 'response.audio.delta') &&
        typeof evt.delta === 'string'
      ) {
        const bin = Uint8Array.from(atob(evt.delta), (ch) => ch.charCodeAt(0));
        audioCbs.forEach((cb) => cb(bin.buffer));
        return;
      }
      assembler.handle(evt);
    } catch {
      /* 비JSON 프레임 무시 */
    }
  });
  ws.addEventListener('close', () => {
    errorCbs.forEach((cb) => cb({ code: 'closed', message: 'engine connection closed', fatal: true }));
  });

  return {
    provider: 'openai',
    model: modelName(),
    pushAudio(chunk) {
      if (ws.readyState !== WebSocket.OPEN) return;
      const b64 = btoa(String.fromCharCode(...new Uint8Array(chunk)));
      // ⚠ 번역 엔드포인트는 클라이언트 이벤트에 session. 접두사가 붙는다 (실측 확인).
      // 접두사 없이 보내면 서버가 invalid_value로 거부하고 오디오가 전달되지 않는다.
      ws.send(JSON.stringify({ type: 'session.input_audio_buffer.append', audio: b64 }));
    },
    onSegment(cb) {
      segmentCbs.push(cb);
    },
    onAudio(cb) {
      audioCbs.push(cb);
    },
    onError(cb) {
      errorCbs.push(cb);
    },
    async close() {
      dispose();
      try {
        ws.close();
      } catch {
        /* noop */
      }
    },
  };
}

const TARGETS = new Set<string>(TRANSLATE_TARGET_LANGS);

export const openaiRealtimeEngine: TranslationEngine = {
  provider: 'openai',
  capabilities: {
    audioOut: true,
    browserDirect: true,
    autoDetectSource: true, // 모델 내장 — 프롬프트 불필요
    maxSessionSec: Number(env('SESSION_MAX_DURATION_SEC') ?? 7200),
  },
  supports(source: SourceLangSetting, target: LangCode) {
    // 입력은 70+ 자동 감지라 사실상 제한 없음. 출력만 13개 (2026-07 조사값)
    void source;
    return TARGETS.has(target);
  },
  mintEphemeralKey,
  openServerSession,
};
