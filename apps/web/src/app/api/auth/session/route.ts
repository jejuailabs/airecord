import { NextResponse } from 'next/server';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import {
  adminAuth,
  adminDb,
  SESSION_COOKIE_MAX_AGE_MS,
  SESSION_COOKIE_NAME,
} from '@/lib/firebase/admin';
import { cycleKey, getPlan } from '@sotong/shared/constants';

export const runtime = 'nodejs';

const bodySchema = z.object({ idToken: z.string().min(1) });

/** 공개 이메일 도메인 — 회사 도메인 자동 합류 대상에서 제외 (docs/03 §1) */
const PUBLIC_DOMAINS = new Set(['gmail.com', 'naver.com', 'daum.net', 'kakao.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com']);

/**
 * ID 토큰 → __session HttpOnly 쿠키 교환 (docs/03 §1, 유효기간 5일).
 * 최초 로그인 시 users/{uid} + 개인 워크스페이스 자동 생성 (Free 플랜).
 * 워크스페이스 개념은 유저에게 노출하지 않는다 — 혼자 쓰는 사람에게는 없는 것처럼.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  try {
    const auth = adminAuth();
    const decoded = await auth.verifyIdToken(parsed.data.idToken);
    const sessionCookie = await auth.createSessionCookie(parsed.data.idToken, {
      expiresIn: SESSION_COOKIE_MAX_AGE_MS,
    });

    // 최초 로그인 자동 처리
    const db = adminDb();
    const userRef = db.collection('users').doc(decoded.uid);
    const snap = await userRef.get();
    if (!snap.exists) {
      const email = decoded.email ?? '';
      const domain = email.split('@')[1]?.toLowerCase();
      const free = getPlan('free');
      const wsRef = db.collection('workspaces').doc();
      const now = FieldValue.serverTimestamp();

      const batch = db.batch();
      batch.set(wsRef, {
        name: decoded.name ?? email,
        ownerUid: decoded.uid,
        emailDomain: domain && !PUBLIC_DOMAINS.has(domain) ? domain : null,
        plan: 'free',
        billing: {
          includedMinutes: free?.includedMinutes ?? 10,
          usedMinutes: 0,
          overageMinutes: 0,
          overageEnabled: false, // 기본 꺼짐 — 예상치 못한 청구서 방지 (docs/07 §5.3)
          // 무료는 매일 갱신 — 이 키가 바뀌면 사용량이 0으로 돌아간다
          cycleKey: cycleKey(free?.cycle ?? 'daily'),
          cycleStart: now,
        },
        retentionDays: free?.retentionDays ?? 7,
        storeAudio: false,
        createdAt: now,
      });
      batch.set(wsRef.collection('members').doc(decoded.uid), {
        uid: decoded.uid,
        email,
        displayName: decoded.name ?? '',
        role: 'owner',
        joinedAt: now,
      });
      batch.set(userRef, {
        uid: decoded.uid,
        email,
        displayName: decoded.name ?? '',
        photoURL: decoded.picture ?? null,
        uiLocale: 'ko',
        theme: 'system',
        workspaceIds: [wsRef.id],
        lastWorkspaceId: wsRef.id,
        createdAt: now,
      });
      await batch.commit();
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_COOKIE_MAX_AGE_MS / 1000,
      path: '/',
    });
    return res;
  } catch (e) {
    console.error('[auth/session]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'auth_failed' }, { status: 401 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, '', { maxAge: 0, path: '/' });
  return res;
}
