/**
 * Recall.ai 클라이언트 (docs/04 §4). 자체 봇 개발은 금지 — 기성 인프라를 산다 (core.md §3-4).
 * 단가: $0.50/시간, 초 단위 비례 (docs/07 §1.2 — 하드코딩 금지, 환경변수로 주입).
 *
 * ⚠ 구현은 여기 하나뿐이다. 웹(봇 생성·퇴장)과 워커(웹훅 검증)가 같은 파일을 쓴다.
 *
 * 확인된 규격 (2026-07-29, 공식 문서):
 *   · 인증: `Authorization: <key>` — `Token ` 접두사는 붙여도 되고 안 붙여도 된다
 *   · 실시간 오디오: `audio_mixed_raw.data` 이벤트를 **JSON**으로 보낸다.
 *     오디오는 `data.data.buffer`에 base64, 16kHz · 16bit · mono · PCM little-endian.
 *     바이너리 프레임이 아니다 — 이걸 놓치면 오디오를 전부 버린다.
 */
const base = () => {
  const region = process.env.RECALL_REGION ?? 'us-west-2';
  return `https://${region}.recall.ai/api/v1`;
};

const key = () => {
  const k = process.env.RECALL_API_KEY;
  if (!k) throw new Error('RECALL_API_KEY is not set');
  return k;
};

const headers = () => ({
  Authorization: `Token ${key()}`,
  'Content-Type': 'application/json',
});

export interface CreateBotOptions {
  meetingUrl: string;
  /** wss://<worker>/relay/{sessionId}?sig=... */
  audioDestinationWs: string;
  /** 참가자 목록에서 봇의 존재가 드러나야 한다 (docs/08 §2.2) */
  botName: string;
  /** 봇 입장 직후 회의 채팅에 1회만 게시 — 재전송 금지 (docs/04 §4) */
  chatMessage: string;
}

export async function createBot(opts: CreateBotOptions): Promise<{ botId: string }> {
  // ⚠ 끝 슬래시를 붙인다 — Recall API는 Django 계열이라 없으면 리다이렉트·404가 난다
  const res = await fetch(`${base()}/bot/`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      meeting_url: opts.meetingUrl,
      bot_name: opts.botName,
      chat: { on_bot_join: { send_to: 'everyone', message: opts.chatMessage } },
      recording_config: {
        /**
         * ⚠ 아티팩트를 먼저 켜야 그 실시간 이벤트를 구독할 수 있다 (실측 2026-08-01).
         *   이게 없으면 Recall이 400으로 거부한다:
         *   "Cannot specify realtime endpoint events for artifacts that are not configured: audio_mixed_raw".
         *   realtime_endpoints의 events(audio_mixed_raw.data)와 반드시 짝을 이뤄야 한다.
         */
        audio_mixed_raw: {},
        realtime_endpoints: [
          { type: 'websocket', url: opts.audioDestinationWs, events: ['audio_mixed_raw.data'] },
        ],
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Recall bot create failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { id: string };
  return { botId: json.id };
}

export async function leaveBot(botId: string): Promise<void> {
  const res = await fetch(`${base()}/bot/${botId}/leave_call/`, {
    method: 'POST',
    headers: headers(),
  });
  // 이미 나간 봇에 대한 404는 성공으로 본다 — 재시도로 에러를 만들 이유가 없다
  if (!res.ok && res.status !== 404) {
    throw new Error(`Recall bot leave failed: ${res.status}`);
  }
}

export type BotLifecycle = 'joining' | 'in_call' | 'done' | 'error';

/** 웹훅 status_changes 코드를 우리 상태로 좁힌다 — 벤더 코드를 화면까지 들이지 않는다 */
export function botLifecycleOf(code: string): BotLifecycle {
  if (code === 'in_call_recording' || code === 'in_call_not_recording' || code === 'in_call') {
    return 'in_call';
  }
  if (code === 'done' || code === 'call_ended') return 'done';
  if (code === 'fatal' || code === 'error') return 'error';
  return 'joining';
}
