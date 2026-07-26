'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import {
  completeRedirectSignIn,
  hasPendingRedirect,
  startGoogleSignIn,
} from '@/lib/firebase/client';

type Phase = 'checking' | 'idle' | 'signing' | 'exchanging' | 'failed';

export function GoogleLoginButton({ next = '/dashboard' }: { next?: string }) {
  const t = useTranslations('login');
  const router = useRouter();
  // 리다이렉트로 돌아온 직후일 수 있으므로 버튼부터 보여주지 않는다
  const [phase, setPhase] = useState<Phase>('checking');

  /** idToken을 세션 쿠키로 교환하고 앱으로 들어간다 */
  const enter = useCallback(
    async (idToken: string) => {
      setPhase('exchanging');
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) throw new Error('session exchange failed');
      router.replace(next as never);
      router.refresh();
    },
    [next, router],
  );

  // 리다이렉트 복귀 처리 — 여기서 결과를 회수하지 않으면
  // 로그인에 성공하고도 로그인 버튼이 다시 보인다.
  useEffect(() => {
    let alive = true;
    (async () => {
      const pending = hasPendingRedirect();
      const idToken = await completeRedirectSignIn();
      if (!alive) return;
      if (idToken) {
        try {
          await enter(idToken);
        } catch {
          setPhase('failed');
        }
        return;
      }
      // 리다이렉트를 시도했는데 결과가 없다 = 취소했거나 실패
      setPhase(pending ? 'failed' : 'idle');
    })();
    return () => {
      alive = false;
    };
  }, [enter]);

  const login = async () => {
    setPhase('signing');
    try {
      const idToken = await startGoogleSignIn();
      if (idToken) {
        await enter(idToken);
        return;
      }
      // null = 리다이렉트로 넘어갔거나(페이지를 곧 떠남) 유저가 팝업을 닫았다.
      // 리다이렉트 중이면 로딩을 유지하고, 아니면 조용히 버튼으로 되돌린다.
      if (!hasPendingRedirect()) setPhase('idle');
    } catch {
      setPhase('failed');
    }
  };

  // 로그인 진행 중에는 버튼을 감추고 진행 상태만 보여준다
  if (phase === 'checking' || phase === 'signing' || phase === 'exchanging') {
    const message =
      phase === 'exchanging' ? t('progress.finishing') : t('progress.signingIn');
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex w-full flex-col items-center gap-3 rounded-xl border border-border bg-bg-raised px-6 py-8"
      >
        <Loader2 size={26} className="animate-spin text-accent" aria-hidden />
        <p className="text-[16px] font-semibold">{message}</p>
        <p className="text-[13.5px] text-text-muted">{t('progress.hint')}</p>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <button
        onClick={login}
        className="flex h-14 w-full items-center justify-center gap-3 rounded-xl border border-border bg-bg-raised text-[16px] font-semibold transition-colors duration-150 hover:border-border-strong"
      >
        <svg width="19" height="19" viewBox="0 0 48 48" aria-hidden>
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        {t('google')}
      </button>
      {phase === 'failed' ? (
        <div className="rounded-xl bg-danger-weak px-4 py-3 text-left">
          <p className="text-[15px] font-semibold text-danger">{t('failed.title')}</p>
          <p className="text-[13.5px] text-text-muted">{t('failed.action')}</p>
        </div>
      ) : null}
    </div>
  );
}
