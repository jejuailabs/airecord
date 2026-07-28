/**
 * 원문 자막 전용 전사 레그.
 *
 * ⚠ 통역 모델(`gpt-realtime-translate`)은 여기서 건드리지 않는다.
 * 이건 통역 옆에 나란히 붙는 **별도 세션**이고, 하는 일은 원문 자막 하나뿐이다.
 *
 * 왜 분리했나 (실측 2026-07-28, 같은 열화 오디오 = 폰 스피커→노트북 마이크 근사):
 *   통역 모델에 딸린 부가 전사(gpt-realtime-whisper) … 144초에 30자 (사실상 사망)
 *   전용 레그(gpt-4o-mini-transcribe)             … 45초에 741자 (전 구간 유지)
 * 부가 전사는 전용 세션 설정조차 거부한다("Turn detection is not supported").
 *
 * 모델 선택도 취향이 아니라 서버가 정한다. 전사 세션이 받아주는 값은 이게 전부다(실측):
 *   whisper-1 / gpt-realtime-whisper / gpt-4o-transcribe / gpt-4o-mini-transcribe(+스냅샷)
 * 최신 realtime-2.1·gpt-audio 계열은 전부 invalid_value로 거부된다.
 */
const env = (k: string): string | undefined =>
  typeof process !== 'undefined' ? process.env?.[k] : undefined;

const baseUrl = () => env('OPENAI_BASE_URL') ?? 'https://api.openai.com';

/** 전사 세션이 실제로 받아주는 모델 (실측 확인된 목록) */
const ALLOWED = new Set([
  'whisper-1',
  'gpt-realtime-whisper',
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe',
  'gpt-4o-mini-transcribe-2025-03-20',
  'gpt-4o-mini-transcribe-2025-12-15',
]);

/** 품질·원가 실측 결과 mini가 큰 모델과 동률이라 mini 최신 스냅샷을 쓴다 (분당 $0.003) */
const DEFAULT_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe-2025-12-15';

const modelName = () => {
  const configured = env('SOURCE_TRANSCRIBE_MODEL');
  if (!configured) return DEFAULT_TRANSCRIBE_MODEL;
  if (!ALLOWED.has(configured)) {
    console.warn(
      `[transcribe] SOURCE_TRANSCRIBE_MODEL="${configured}" is not accepted by the transcription session; ` +
        `falling back to "${DEFAULT_TRANSCRIBE_MODEL}".`,
    );
    return DEFAULT_TRANSCRIBE_MODEL;
  }
  return configured;
};

/**
 * 원문 언어 힌트.
 *
 * ⚠ 없으면 전사 모델이 **발화마다 언어를 새로 추측한다.** 긴 문장은 잘 맞히지만
 * 짧은 발화("아 네", "그쵸")에서는 자주 틀려 한국어를 중국어·태국어로 받아적는다.
 *
 * 실측(2026-07-28, 짧은 조각 26개):
 *   자동 감지   → 다른 언어 4개, 한글 없는 발화 9개  ("哈,瞻" "夜魔?" "Um, kusal.")
 *   language=ko → 다른 언어 0개, 한글 없는 발화 1개
 *
 * 통역 모델(gpt-realtime-translate)은 입력 언어 파라미터를 아예 받지 않지만,
 * 전사 세션은 받는다 — 여기서만 쓸 수 있는 손잡이다.
 */
export interface MintTranscriptionOptions {
  /** 'auto'이거나 없으면 힌트를 넣지 않는다 (모델 자동 감지) */
  sourceLang?: string;
}

export interface TranscriptionGrant {
  ephemeralKey: string;
  model: string;
  callUrl: string;
  keyExpiresAt: number;
  /** 이 키에 구워진 언어 힌트. 'auto'면 클라이언트가 첫 발화들을 보고 스스로 잠근다. */
  sourceLang: string;
}

/**
 * 전사 세션 1회용 키.
 * 실패해도 통역은 그대로 진행돼야 하므로 절대 예외를 던지지 않는다 — null이면 부가 전사로 돌아간다.
 */
export async function mintTranscriptionKey(
  opts: MintTranscriptionOptions = {},
): Promise<TranscriptionGrant | null> {
  const apiKey = env('OPENAI_API_KEY');
  if (!apiKey) return null;
  try {
    const res = await fetch(`${baseUrl()}/v1/realtime/client_secrets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: 600 },
        session: {
          type: 'transcription',
          audio: {
            input: {
              transcription: {
                model: modelName(),
                // 알면 반드시 넣는다 — 짧은 발화의 언어 오판을 막는 유일한 손잡이다
                ...(opts.sourceLang && opts.sourceLang !== 'auto'
                  ? { language: opts.sourceLang }
                  : {}),
              },
              // 발화 경계를 서버가 잡아준다 — 통역 엔드포인트엔 없는 신호라 자막 끊기 품질이 올라간다
              turn_detection: { type: 'server_vad' },
            },
          },
        },
      }),
    });
    if (!res.ok) {
      console.error('[transcribe] client_secrets failed', res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const json = (await res.json()) as { value: string; expires_at: number };
    return {
      ephemeralKey: json.value,
      model: modelName(),
      // 전사 세션은 통역 전용 경로가 아니라 일반 realtime calls 엔드포인트를 쓴다 (실측 SDP 201)
      callUrl: `${baseUrl()}/v1/realtime/calls`,
      keyExpiresAt: json.expires_at * 1000,
      sourceLang: opts.sourceLang ?? 'auto',
    };
  } catch (e) {
    console.error('[transcribe] mint failed', e);
    return null;
  }
}
