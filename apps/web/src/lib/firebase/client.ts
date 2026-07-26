'use client';

/**
 * Firebase 클라이언트 (docs/03 §1) — Google 로그인 전용.
 * 이메일/비번 미지원. 회사 계정 = 구글 워크스페이스 가정.
 */
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  getRedirectResult,
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

/**
 * 모바일에서는 팝업이 차단되거나 닫힌 뒤 결과를 못 받는 경우가 많다.
 * 그래서 터치 기기·좁은 화면에서는 처음부터 리다이렉트 방식으로 간다.
 */
function shouldUseRedirect(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return coarse || window.innerWidth < 768;
}

/** 리다이렉트가 시작되면 이 페이지는 곧 떠난다 — 호출부는 로딩 상태를 유지해야 한다 */
export const REDIRECT_PENDING_KEY = 'interlive-auth-redirect';

/**
 * 로그인 시작.
 * 팝업 경로면 idToken을 돌려주고, 리다이렉트 경로면 null을 돌려준 뒤 페이지를 떠난다.
 */
export async function startGoogleSignIn(): Promise<string | null> {
  const auth = firebaseAuth();
  const provider = new GoogleAuthProvider();

  if (shouldUseRedirect()) {
    sessionStorage.setItem(REDIRECT_PENDING_KEY, '1');
    await signInWithRedirect(auth, provider);
    return null;
  }

  try {
    const cred = await signInWithPopup(auth, provider);
    return await cred.user.getIdToken();
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      sessionStorage.setItem(REDIRECT_PENDING_KEY, '1');
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw e;
  }
}

/**
 * 리다이렉트 로그인에서 돌아왔을 때 결과를 회수한다.
 * 결과가 있으면 idToken, 없으면 null.
 */
export async function completeRedirectSignIn(): Promise<string | null> {
  try {
    const result = await getRedirectResult(firebaseAuth());
    if (!result) return null;
    return await result.user.getIdToken();
  } catch {
    return null;
  } finally {
    sessionStorage.removeItem(REDIRECT_PENDING_KEY);
  }
}

/** 리다이렉트 로그인이 진행 중이었는지 — 복귀 직후 "로그인 중" 화면을 띄우기 위해 */
export function hasPendingRedirect(): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(REDIRECT_PENDING_KEY) === '1';
}
