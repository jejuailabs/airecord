/**
 * Vercel ↔ Worker 요청 서명 (docs/01 §3.2 — Vercel이 발급한 서명 토큰만 신뢰).
 * sig = HMAC-SHA256(WORKER_SHARED_SECRET, sessionId) hex.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export function signRelay(sessionId: string, secret = process.env.WORKER_SHARED_SECRET): string {
  if (!secret) throw new Error('WORKER_SHARED_SECRET is not set');
  return createHmac('sha256', secret).update(sessionId).digest('hex');
}

export function verifyRelaySignature(sessionId: string, sig: string): boolean {
  try {
    const expected = signRelay(sessionId);
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(sig, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
