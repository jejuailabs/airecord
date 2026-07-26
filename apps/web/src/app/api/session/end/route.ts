import { NextResponse } from 'next/server';
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

  const result = endSession(sessionId, reason);
  if (!result) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const record = result.record;
  if (record?.uid) {
    await saveSegments(sessionId, segments ?? []);
    await finalizeSessionDoc(record);
    // 요약은 부산물이므로 응답을 붙잡지 않는다
    void generateAndStoreSummary(sessionId, record.targetLang);
  }

  const body: SessionEndResponse = {
    billedSeconds: result.billedSeconds,
    segmentCount: result.segmentCount,
    saved: Boolean(record?.uid),
  };
  return NextResponse.json(body);
}
