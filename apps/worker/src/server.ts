/**
 * Realtime Worker — 모드 A 오디오 릴레이 (docs/01 §3.2).
 *
 * 책임: 봇 오디오 ↔ 번역 모델 릴레이, 세그먼트 Firestore 배치 기록, 하드 캡 감시, 봇 웹훅.
 * 하지 않는 것: UI 서빙, 유저 인증(서명 토큰만 신뢰), 비즈니스 로직.
 */
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { verifyRelaySignature } from './auth.js';
import { botLifecycleOf } from './recall/client.js';
import { runRelay } from './relay/relay.js';
import { setBotState } from './firestore.js';

const PORT = Number(process.env.PORT ?? 8080);

/**
 * Recall 웹훅 서명 검증 (Svix 형식).
 * 시크릿이 설정돼 있지 않으면 웹훅을 아예 받지 않는다 —
 * 검증 없이 열어 두면 아무나 세션 상태를 바꿀 수 있다.
 */
function verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean {
  const secret = process.env.RECALL_WEBHOOK_SECRET;
  if (!secret) return false;
  const id = String(headers['svix-id'] ?? headers['webhook-id'] ?? '');
  const ts = String(headers['svix-timestamp'] ?? headers['webhook-timestamp'] ?? '');
  const sigHeader = String(headers['svix-signature'] ?? headers['webhook-signature'] ?? '');
  if (!id || !ts || !sigHeader) return false;

  // 재전송 공격 방지 — 5분보다 오래된 서명은 버린다
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest('base64');
  // 헤더에는 "v1,<sig> v1,<sig2>" 형태로 여러 개가 올 수 있다
  return sigHeader.split(' ').some((part) => {
    const sig = part.includes(',') ? part.split(',')[1]! : part;
    const a = Buffer.from(sig, 'base64');
    const b = Buffer.from(expected, 'base64');
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }

  /**
   * 봇 상태 이벤트 — 화면이 "입장 중 / 통역 중 / 끝남"을 알 수 있게 세션 문서에 남긴다.
   * 이게 없으면 유저는 봇이 회의에 못 들어갔는지 조용히 실패한 건지 구분할 수 없다.
   */
  if (req.method === 'POST' && req.url === '/webhook/recall') {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1_000_000) req.destroy(); // 폭탄 방지
    });
    req.on('end', () => {
      if (!verifyWebhook(raw, req.headers)) {
        res.writeHead(401);
        res.end();
        return;
      }
      try {
        const body = JSON.parse(raw) as {
          event?: string;
          data?: { bot?: { id?: string }; status?: { code?: string }; code?: string };
        };
        const botId = body.data?.bot?.id;
        const code = body.data?.status?.code ?? body.data?.code ?? '';
        if (botId && code) {
          void setBotState(botId, botLifecycleOf(code), code);
        }
      } catch {
        /* 형식이 바뀌어도 200을 준다 — 재전송 폭풍을 만들지 않는다 */
      }
      res.writeHead(200);
      res.end();
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // 봇 오디오 스트림 목적지: wss://<worker>/relay/{sessionId}?sig=... (docs/04 §4)
  const match = /^\/relay\/([\w-]+)$/.exec(url.pathname);
  const sig = url.searchParams.get('sig');

  if (!match || !match[1] || !sig || !verifyRelaySignature(match[1], sig)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  const sessionId = match[1];
  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    void runRelay(sessionId, ws);
  });
});

server.listen(PORT, () => {
  console.log(`[worker] listening on :${PORT}`);
});
