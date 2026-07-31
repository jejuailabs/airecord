/**
 * Vercel ↔ Worker 요청 서명 (docs/01 §3.2 — Vercel이 발급한 서명만 신뢰).
 *
 * ⚠ 서명을 만드는 쪽(웹)과 검증하는 쪽(워커)이 **같은 코드**를 써야 한다.
 *   따로 두면 한쪽만 고쳐졌을 때 봇이 붙자마자 401로 끊기고,
 *   그 원인은 로그만 보면 절대 안 보인다.
 *
 * sig = HMAC-SHA256(WORKER_SHARED_SECRET, sessionId) hex
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

function secretOf(explicit?: string): string {
  const s = explicit ?? process.env.WORKER_SHARED_SECRET;
  if (!s) throw new Error('WORKER_SHARED_SECRET is not set');
  return s;
}

export function signRelay(sessionId: string, secret?: string): string {
  return createHmac('sha256', secretOf(secret)).update(sessionId).digest('hex');
}

export function verifyRelaySignature(sessionId: string, sig: string, secret?: string): boolean {
  try {
    const a = Buffer.from(signRelay(sessionId, secret), 'hex');
    const b = Buffer.from(sig, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * 봇 오디오가 향할 워커 주소.
 * WORKER_BASE_URL은 https/http로 적어 두고 여기서 ws/wss로 바꾼다 — 두 벌 관리하지 않는다.
 */
export function relayWsUrl(baseUrl: string, sessionId: string, secret?: string): string {
  const ws = baseUrl.replace(/^http/, 'ws').replace(/\/+$/, '');
  return `${ws}/relay/${sessionId}?sig=${signRelay(sessionId, secret)}`;
}
