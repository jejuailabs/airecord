import { NextResponse, after } from 'next/server';
import { sessionEndRequestSchema, type SessionEndResponse } from '@sotong/shared/schemas';
import { endSession, finalizeSessionDoc, saveSegments } from '@/lib/server/session-store';
import { generateAndStoreSummary } from '@/lib/server/summarize';

export const runtime = 'nodejs';

/** 세션 종료 → 마지막 세그먼트 저장 → 분 확정 → 요약 생성 (docs/01 §4.1 [7]) */
export async function POST(req: Request) {
  const parsed = sessionEndRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { sessionId, reason, segments } = parsed.data;

  const result = await endSession(sessionId, reason);
  if (!result) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const record = result.record;
  if (record.uid) {
    await saveSegments(sessionId, segments ?? []);
    // 이미 다른 경로(청소·중복 종료)가 마감했으면 요약도 이미 만들어졌다 — 다시 부르지 않는다
    const billed = await finalizeSessionDoc(record);
    // 요약은 응답을 붙잡지 않되 반드시 끝까지 실행돼야 한다.
    // 서버리스에서 그냥 void로 띄우면 응답 직후 함수가 종료돼 요약이 영원히 'running'에 멈춘다.
    if (billed) after(() => generateAndStoreSummary(sessionId, record.targetLang));
  }

  const body: SessionEndResponse = {
    billedSeconds: result.billedSeconds,
    segmentCount: result.segmentCount,
    saved: Boolean(record.uid),
  };
  return NextResponse.json(body);
}
