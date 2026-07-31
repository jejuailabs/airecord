/**
 * Vercel ↔ Worker 요청 서명.
 *
 * ⚠ 구현은 packages/shared/src/meeting/relay-auth.ts 하나뿐이다.
 *   예전에는 여기에 같은 HMAC을 따로 두었는데, 한쪽만 고쳐지면
 *   봇이 붙자마자 401로 끊기고 로그만 보면 원인이 안 보인다.
 */
export { signRelay, verifyRelaySignature, relayWsUrl } from '@sotong/shared/meeting/relay-auth';
