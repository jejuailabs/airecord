/**
 * Realtime Worker — 모드 A 오디오 릴레이 (docs/01 §3.2, Phase 4에 Cloud Run 배포).
 *
 * 책임: 봇 오디오 ↔ 번역 모델 릴레이, 세그먼트 Firestore 배치 기록, 하드 캡 감시, 봇 웹훅.
 * 하지 않는 것: UI 서빙, 유저 인증(서명 토큰만 신뢰), 비즈니스 로직.
 */
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { verifyRelaySignature } from './auth.js';
import { runRelay } from './relay/relay.js';

const PORT = Number(process.env.PORT ?? 8080);

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  // TODO(Phase 4): POST /webhook/recall — 봇 상태 이벤트 수신 (RECALL_WEBHOOK_SECRET 검증)
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
