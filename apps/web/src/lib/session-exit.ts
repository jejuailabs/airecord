/**
 * 통역 화면을 '종료 버튼 없이' 떠날 때의 마감 (탭 닫기·새로고침·메뉴 이동).
 *
 * 왜 필요한가 (실사용 확인 2026-10-03):
 *   종료 요청(/api/session/end)이 종료 버튼·시간 한도·연결 오류에서만 나갔다. 화면을 그냥 떠나면
 *   OpenAI 연결만 닫히고 서버엔 아무것도 안 가서, 그날 세션 15개 중 12개가 기록·청구에서 빠졌다.
 *
 * 페이지가 사라지는 중에는 fetch가 끝까지 간다는 보장이 없다 — sendBeacon만 보장된다.
 * 서버 쪽 청소(sweepStaleSessions)가 최종 안전망이고, 이건 '바로 정확하게' 끝내는 1차 경로다.
 */
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_MISS_LIMIT } from '@sotong/shared/constants';

/**
 * 하트비트가 이만큼 성공하지 못하면 서버는 세션을 끊긴 것으로 보고 거기까지만 청구한다.
 * 클라이언트도 같은 기준으로 OpenAI 연결을 스스로 끊는다 — 안 끊으면 청구되지 않는 통역이
 * 우리 돈으로 계속 돈다(OpenAI 연결은 브라우저 직결이라 서버가 끊을 수 없다).
 */
export const HEARTBEAT_STALE_MS = HEARTBEAT_INTERVAL_MS * HEARTBEAT_MISS_LIMIT;

/** 비콘 본문 한도(약 64KB)를 넘지 않게 — 넘으면 sendBeacon이 false를 돌려준다 */
const BEACON_MAX_SEGMENTS = 200;

export function sendEndBeacon(sessionId: string, segments: unknown[] = []): void {
  const post = (segs: unknown[]) => {
    try {
      const body = new Blob([JSON.stringify({ sessionId, reason: 'user', segments: segs })], {
        type: 'application/json',
      });
      return navigator.sendBeacon('/api/session/end', body);
    } catch {
      return false;
    }
  };
  // 자막까지 실어 보내고, 너무 커서 거절되면 종료 신호만이라도 보낸다 — 청구가 기록보다 중요하다
  if (!post(segments.slice(0, BEACON_MAX_SEGMENTS))) post([]);
}
