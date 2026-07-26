import { NextResponse } from 'next/server';
import { detectMeetingPlatform, meetingJoinRequestSchema } from '@sotong/shared/schemas';

export const runtime = 'nodejs';

/**
 * 모드 A — 회의 봇 입장 (docs/01 §4.2, docs/04 §4). Phase 4에서 활성화.
 *
 * 활성화 시 흐름:
 *   1. URL 파싱 → platform 판별
 *   2. 잔여 분 확인 (부족하면 402)
 *   3. sessions/{id} 생성 (mode: 'meeting', status: 'joining') + viewerToken 발급
 *   4. Recall.ai 봇 생성 — 실시간 오디오 스트림 목적지 = wss://<worker>/relay/{sessionId}?sig=...
 *   5. 봇이 회의 채팅에 자막 링크(/v/{token}) 1회 게시
 *
 * 자체 봇 개발은 금지 (core.md §3-4) — Recall.ai를 산다.
 */
export async function POST(req: Request) {
  const parsed = meetingJoinRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const platform = detectMeetingPlatform(parsed.data.url);
  if (!platform) {
    return NextResponse.json({ error: 'unsupported_platform' }, { status: 400 });
  }

  const ready = Boolean(process.env.RECALL_API_KEY && process.env.WORKER_BASE_URL);
  if (!ready) {
    // Phase 4 전 — 구조는 준비됨, 인프라 연결만 남음을 명시적으로 알린다
    return NextResponse.json(
      { error: 'phase4_not_ready', platform },
      { status: 501 },
    );
  }

  // TODO(Phase 4): 위 흐름 구현. apps/worker/src/recall/client.ts 사용.
  return NextResponse.json({ error: 'phase4_not_ready', platform }, { status: 501 });
}
