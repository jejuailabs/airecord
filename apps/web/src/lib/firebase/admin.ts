/**
 * Firebase Admin SDK (서버 전용 — docs/03).
 * FIREBASE_ADMIN_* 환경변수는 절대 NEXT_PUBLIC_ 접두사를 붙이지 않는다.
 */
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

/** 세션 쿠키 검증 — 실패 시 null (리다이렉트 판단은 호출부가) */
export async function verifySessionCookie(
  cookie: string | undefined,
): Promise<{ uid: string; email?: string; name?: string; picture?: string } | null> {
  if (!cookie) return null;
  try {
    const decoded = await adminAuth().verifySessionCookie(cookie, true);
    return {
      uid: decoded.uid,
      email: decoded.email,
      name: (decoded as { name?: string }).name,
      picture: (decoded as { picture?: string }).picture,
    };
  } catch {
    return null;
  }
}
