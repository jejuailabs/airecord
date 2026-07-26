import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';

export const runtime = 'nodejs';

/** 헤더 등 클라이언트가 로그인 상태를 확인하는 가벼운 엔드포인트 */
export async function GET() {
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie);
  if (!user) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: { uid: user.uid, email: user.email ?? null, name: user.name ?? null },
  });
}
