/**
 * OpenAI Realtime 어댑터.
 *
 * 모델명은 하드코딩하지 않는다 (core.md §3-7). 기본값 'gpt-realtime'은
 * 2026-07-26 조사 기준 docs/04 §2의 번역 전용 모델(`gpt-realtime-translate`)이
 * 계정에서 열려 있으면 TRANSLATION_MODEL_OPENAI 환경변수로 교체한다.
 */
import type {
  EphemeralGrant,
  OpenOpts,
  TranslationEngine,
  TranslationSession,
  EngineSegment,
  EngineError,
} from './types';
import { buildInterpreterInstructions } from './types';
import { createSegmentAssembler } from './segment-assembler';
import { INTERPRET_LANGUAGES, languageLabel } from '../constants';
import type { LangCode, SourceLangSetting } from '../types';

const env = (k: string): string | undefined =>
  typeof process !== 'undefined' ? process.env?.[k] : undefined;

const baseUrl = () => env('OPENAI_BASE_URL') ?? 'https://api.openai.com';
const modelName = () => env('TRANSLATION_MODEL_OPENAI') ?? 'gpt-realtime';
const apiKey = () => {
  const k = env('OPENAI_API_KEY');
  if (!k) throw new Error('OPENAI_API_KEY is not set');
  return k;
};

/** 세션 설정 — mint 시점에 서버가 굽는다. 브라우저는 지시문을 만지지 않는다. */
export function buildRealtimeSessionConfig(opts: OpenOpts) {
  return {
    type: 'realtime',
    model: modelName(),
    instructions: buildInterpreterInstructions(
      opts.sourceLang,
      opts.targetLang,
      languageLabel(opts.targetLang),
    ),
    output_modalities: opts.audioOut ? ['audio'] : ['text'],
    audio: {
      input: {
        transcription: { model: env('TRANSCRIPTION_MODEL') ?? 'gpt-4o-mini-transcribe' },
        turn_detection: {
          type: 'server_vad',
          silence_duration_ms: 400, // 짧게 — 자막 체감 지연을 줄인다 (docs/01 §5)
        },
      },
      output: { voice: env('TRANSLATION_VOICE') ?? 'marin' },
    },
  };
}

async function mintEphemeralKey(opts: OpenOpts): Promise<EphemeralGrant> {
  const res = await fetch(`${baseUrl()}/v1/realtime/client_secrets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // 수명 짧게, 세션 1회용 (docs/08 §3)
      expires_after: { anchor: 'created_at', seconds: 600 },
      session: buildRealtimeSessionConfig(opts),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI client_secrets failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { value: string; expires_at: number };
  return {
    key: json.value,
    expiresAt: json.expires_at * 1000,
    model: modelName(),
    provider: 'openai',
    callUrl: `${baseUrl()}/v1/realtime/calls`,
  };
}

/**
 * 서버 릴레이 세션 (모드 A — 워커 전용).
 * Node 22+ 전역 WebSocket 사용. 커스텀 헤더 불가 → 서브프로토콜 인증.
 */
async function openServerSession(opts: OpenOpts): Promise<TranslationSession> {
  const url = `${baseUrl().replace(/^http/, 'ws')}/v1/realtime?model=${encodeURIComponent(modelName())}`;
  const ws = new WebSocket(url, [
    'realtime',
    `openai-insecure-api-key.${apiKey()}`,
  ]);

  const segmentCbs: Array<(s: EngineSegment) => void> = [];
  const audioCbs: Array<(c: ArrayBuffer) => void> = [];
  const errorCbs: Array<(e: EngineError) => void> = [];
  const assembler = createSegmentAssembler(
    (s) => segmentCbs.forEach((cb) => cb(s)),
    (code, message) => errorCbs.forEach((cb) => cb({ code, message, fatal: false })),
  );

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('OpenAI realtime WS connect failed')), { once: true });
  });

  const { model: _m, type: _t, ...sessionPatch } = buildRealtimeSessionConfig(opts);
  ws.send(JSON.stringify({ type: 'session.update', session: { type: 'realtime', ...sessionPatch } }));

  ws.addEventListener('message', (ev) => {
    try {
      const evt = JSON.parse(String(ev.data));
      if (
        (evt.type === 'response.output_audio.delta' || evt.type === 'response.audio.delta') &&
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
      ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 }));
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
      try {
        ws.close();
      } catch {
        /* noop */
      }
    },
  };
}

const SUPPORTED = new Set<string>(INTERPRET_LANGUAGES.map((l) => l.code));

export const openaiRealtimeEngine: TranslationEngine = {
  provider: 'openai',
  capabilities: {
    audioOut: true,
    browserDirect: true,
    autoDetectSource: true,
    maxSessionSec: Number(env('SESSION_MAX_DURATION_SEC') ?? 7200),
  },
  supports(source: SourceLangSetting, target: LangCode) {
    // ⚠ 조사값(docs/04 §2): 출력 언어가 입력보다 적다. 실측 후 목록을 좁힐 것.
    return (source === 'auto' || SUPPORTED.has(source)) && SUPPORTED.has(target);
  },
  mintEphemeralKey,
  openServerSession,
};
