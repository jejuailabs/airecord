/**
 * Recall.ai 클라이언트 (docs/04 §4). 자체 봇 개발은 금지 — 기성 인프라를 산다 (core.md §3-4).
 * 단가: $0.50/시간, 초 단위 비례 (docs/07 §1.2 — 2026-07-26 조사값, 하드코딩 금지).
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

export interface CreateBotOptions {
  meetingUrl: string;
  sessionId: string;
  /** wss://<worker>/relay/{sessionId}?sig=... */
  audioDestinationWs: string;
  /** 참가자 목록에서 봇의 존재가 드러나야 한다 (docs/08 §2.2) */
  botName: string;
  /** 봇 입장 직후 회의 채팅에 1회만 게시 — 재전송 금지 (docs/04 §4) */
  chatMessage: string;
}

export async function createBot(opts: CreateBotOptions): Promise<{ botId: string }> {
  const res = await fetch(`${base()}/bot`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${key()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      meeting_url: opts.meetingUrl,
      bot_name: opts.botName,
      chat: { on_bot_join: { send_to: 'everyone', message: opts.chatMessage } },
      recording_config: {
        // 실시간 오디오 스트림 목적지 = Worker WS (docs/01 §4.2)
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
  const res = await fetch(`${base()}/bot/${botId}/leave_call`, {
    method: 'POST',
    headers: { Authorization: `Token ${key()}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Recall bot leave failed: ${res.status}`);
  }
}
