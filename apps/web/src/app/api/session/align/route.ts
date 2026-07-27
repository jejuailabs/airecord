import { NextResponse } from 'next/server';
import { z } from 'zod';
import { alignTranscripts } from '@sotong/shared/translate/align';

export const runtime = 'nodejs';
/** 정렬은 추론 모델을 쓸 수 있어 여유를 둔다 */
export const maxDuration = 60;

const rowSchema = z.object({
  seq: z.number().int().nonnegative(),
  text: z.string().min(1).max(600),
});

const bodySchema = z.object({
  /** 아직 짝이 안 지어진 구간만 보낸다 — 매번 전문을 보내면 비용이 눈덩이가 된다 */
  source: z.array(rowSchema).max(60),
  target: z.array(rowSchema).max(60),
});

/**
 * 원문 ↔ 번역 정렬 (2층).
 * 실시간 자막은 이 응답을 기다리지 않는다 — 실패해도 화면은 그대로 흐른다.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { source, target } = parsed.data;
  if (source.length === 0 || target.length === 0) {
    return NextResponse.json({ pairs: [], unmatchedSource: [], unmatchedTarget: [] });
  }

  const result = await alignTranscripts(source, target);
  if (!result) {
    // 정렬 실패는 조용히 넘어간다 — 다음 주기에 다시 시도한다
    return NextResponse.json({ pairs: [], unmatchedSource: [], unmatchedTarget: [] });
  }
  return NextResponse.json(result);
}
