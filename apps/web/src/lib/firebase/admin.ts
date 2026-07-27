/**
 * Firebase Admin SDK (서버 전용 — docs/03).
 * FIREBASE_ADMIN_* 환경변수는 절대 NEXT_PUBLIC_ 접두사를 붙이지 않는다.
 */
import { cache } from 'react';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function adminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('FIREBASE_ADMIN_* env vars are not set');
  }
  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

export function adminAuth() {
  return getAuth(adminApp());
}

export function adminDb() {
  return getFirestore(adminApp());
}

export const SESSION_COOKIE_NAME = '__session';
/** 세션 쿠키 유효기간 5일 (docs/03 §1) */
export const SESSION_COOKIE_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

export interface SessionUser {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
}

/**
 * 세션 쿠키 검증 — 실패 시 null (리다이렉트 판단은 호출부가).
 *
 * ⚠ checkRevoked는 기본으로 끈다.
 * 켜면 쿠키 서명 검증(로컬, 1ms 미만)에 더해 **Google Identity 왕복이 매 요청 붙는다.**
 * 실측(2026-07-27): Identity 왕복 323~409ms, Firestore 왕복 32~46ms.
 * 화면 하나에 레이아웃·페이지가 각각 불러 왕복이 두 번 = 0.7초가 그냥 날아갔다.
 *
 * 대가: 서버에서 세션을 강제 폐기해도 쿠키 만료(5일)까지는 유효하다.
 * 로그아웃은 쿠키를 지우므로 정상 경로에는 영향이 없다.
 * 폐기 확인이 꼭 필요한 자리에서만 checkRevoked를 켠다.
 *
 * ⚠ React cache로 감싸 **요청당 한 번만** 검증한다. 같은 요청에서 여러 번 불러도 왕복은 한 번이다.
 */
export const verifySessionCookie = cache(
  async (cookie: string | undefined, checkRevoked = false): Promise<SessionUser | null> => {
    if (!cookie) return null;
    try {
      const decoded = await adminAuth().verifySessionCookie(cookie, checkRevoked);
      return {
        uid: decoded.uid,
        email: decoded.email,
        name: (decoded as { name?: string }).name,
        picture: (decoded as { picture?: string }).picture,
      };
    } catch {
      return null;
    }
  },
);
