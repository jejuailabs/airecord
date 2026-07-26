import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { currentUid } from '@/lib/server/sessions-query';

export const runtime = 'nodejs';

const bodySchema = z.object({ title: z.string().trim().max(80) });

/** 세션 제목 수정 — AI가 붙인 가안도 여기서 바꾼다 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const uid = await currentUid();
  if (!uid) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const ref = adminDb().collection('sessions').doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.get('startedByUid') !== uid) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  await ref.set({ title: parsed.data.title || null, titleFromAi: false }, { merge: true });
  return NextResponse.json({ ok: true, title: parsed.data.title });
}
