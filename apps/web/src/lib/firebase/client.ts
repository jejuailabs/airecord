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

/** 리다이렉트가 시작되면 이 페이지는 곧 떠난다 — 호출부는 로딩 상태를 유지해야 한다 */
export const REDIRECT_PENDING_KEY = 'interlive-auth-redirect';

/** 팝업이 막혔을 때만 쓰는 경로 — 인증 도메인이 앱 도메인과 달라 사파리에서 실패할 수 있다 */
const REDIRECT_FALLBACK_CODES = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
  'auth/cancelled-popup-request',
]);

/**
 * 로그인 시작.
 *
 * ⚠ 팝업을 우선한다. 모바일이라고 리다이렉트로 보내면
 * 인증 도메인(*.firebaseapp.com)이 앱 도메인과 달라 사파리가 저장소를 막아 결과가 사라진다.
 * 팝업이 실제로 막힌 경우에만 리다이렉트로 넘어간다.
 *
 * 팝업 경로면 idToken을 돌려주고, 리다이렉트 경로면 null을 돌려준 뒤 페이지를 떠난다.
 */
export async function startGoogleSignIn(): Promise<string | null> {
  const auth = firebaseAuth();
  const provider = new GoogleAuthProvider();

  try {
    const cred = await signInWithPopup(auth, provider);
    return await cred.user.getIdToken();
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    // 유저가 직접 닫은 경우는 실패로 취급하지 않는다
    if (code === 'auth/popup-closed-by-user') return null;
    if (REDIRECT_FALLBACK_CODES.has(code)) {
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
