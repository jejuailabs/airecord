'use client';

/**
 * Firebase 클라이언트 (docs/03 §1) — Google 로그인 전용.
 * 이메일/비번 미지원. 회사 계정 = 구글 워크스페이스 가정.
 */
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  signInWithPopup,
  signInWithRedirect,
  type Auth,
} from 'firebase/auth';

function app(): FirebaseApp {
  const existing = getApps()[0];
  if (existing) return existing;
  return initializeApp({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  });
}

export function firebaseAuth(): Auth {
  return getAuth(app());
}

/** 팝업 우선, 차단 환경이면 리다이렉트 폴백 (docs/03 §1) */
export async function signInWithGoogle(): Promise<string> {
  const auth = firebaseAuth();
  const provider = new GoogleAuthProvider();
  try {
    const cred = await signInWithPopup(auth, provider);
    return cred.user.getIdToken();
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code === 'auth/popup-blocked') {
      await signInWithRedirect(auth, provider);
      // 리다이렉트는 페이지를 떠난다 — 도달하지 않음
      return new Promise(() => undefined);
    }
    throw e;
  }
}
