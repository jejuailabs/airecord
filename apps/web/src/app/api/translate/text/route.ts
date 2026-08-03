import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { cookies } from 'next/headers';
import { translateTextStream } from '@sotong/shared/translate';
import { translateTextRequestSchema } from '@sotong/shared/schemas';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { consumeChars, guestKey, remainingChars } from '@/lib/server/guest-quota';
import { getEntitlement } from '@/lib/server/entitlement';
import { saveRecord } from '@/lib/server/records';
import { saveRecordObject } from '@/lib/server/records-storage';
import { textArtifact } from '@/lib/server/record-artifact';

/** 이보다 짧은 번역은 마이페이지에 남기지 않는다 — 한두 단어 조회까지 쌓이면 목록이 지저분해진다 */
const RECORD_MIN_CHARS = 20;

export const runtime = 'nodejs';
/** 추론형 모델이라 응답이 길어질 수 있다 */
export const maxDuration = 60;

/**
 * 텍스트 번역 (실시간 통역과 별개 엔진) — **스트리밍**.
 *
 * 예전엔 번역 전체가 끝나야 JSON으로 돌려줬다 — 긴 문단이면 수 초간 화면이 비었다.
 * 지금은 생성되는 글자를 text/plain으로 바로 흘린다(체감 첫 글자 <1초).
 * 오류는 스트림 시작 전에 JSON으로 돌려주므로 클라이언트는 res.ok로 가른다.
 * 비회원 잔여 글자수는 스트림에 실을 수 없어 X-Remaining-Chars 헤더로 준다.
 */
export async function POST(req: Request) {
  const parsed = translateTextRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { text, sourceLang, targetLang, tone } = parsed.data;
  if (!text.trim()) {
    return new Response('', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie).catch(() => null);

  const key = guestKey(req);
  if (!user) {
    const left = remainingChars(key);
    if (left <= 0) {
      return NextResponse.json({ error: 'guest_quota_exhausted' }, { status: 429 });
    }
    if (text.length > left) {
      return NextResponse.json({ error: 'guest_quota_too_long', remaining: left }, { status: 429 });
    }
    // 스트림이 시작되면 청구를 되돌릴 수 없으므로 여기서 소진한다
    consumeChars(key, text.length);
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'key_missing' }, { status: 500 });
  }

  const encoder = new TextEncoder();
  let full = '';
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await translateTextStream({ text, sourceLang, targetLang, tone }, (delta) => {
          full += delta;
          controller.enqueue(encoder.encode(delta));
        });
        controller.close();
      } catch (e) {
        console.error('[translate/text]', e instanceof Error ? e.message : e);
        controller.error(e);
      }
    },
  });

  /**
   * 로그인 사용자면 결과를 마이페이지에 남긴다 (스트림이 끝난 뒤 after에서, 응답을 늦추지 않게).
   * 비회원·너무 짧은 번역은 저장하지 않는다.
   */
  if (user && text.length >= RECORD_MIN_CHARS) {
    after(async () => {
      if (!full.trim()) return;
      try {
        const ent = await getEntitlement(user.uid, user.email);
        const art = textArtifact(text, full);
        const id = crypto.randomUUID();
        const path = await saveRecordObject(user.uid, id, art.body, art.contentType, art.ext);
        await saveRecord({
          uid: user.uid,
          workspaceId: ent.workspaceId,
          plan: ent.plan,
          kind: 'text',
          title: text.slice(0, 60),
          sourceLang,
          targetLang,
          preview: full.slice(0, 300),
          storagePath: path,
          downloadName: art.downloadName,
          contentType: art.contentType,
          charCount: text.length,
        });
      } catch (e) {
        console.error('[translate/text] save record failed', e instanceof Error ? e.message : e);
      }
    });
  }

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(user ? {} : { 'X-Remaining-Chars': String(remainingChars(key)) }),
    },
  });
}
