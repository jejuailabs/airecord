import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { Radio } from 'lucide-react';

/**
 * 자막 뷰어 (docs/06 §2.4) — 회의 참가자가 링크만으로 들어와 자막을 보는 공개 화면.
 * 로그인 유도 없음. 뷰어 UI 언어는 Accept-Language로 판단한다 (docs/06 §1).
 *
 * Phase 4에서 Firestore onSnapshot 구독(sessions/{id}/segments)이 붙는다.
 * 지금은 구조와 고지 배너만 있다 — 빈 상태가 다음 단계를 정직하게 안내한다.
 */
export default async function ViewerPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await params; // token은 Phase 4에서 viewerTokens/{token} 검증에 쓴다
  const acceptLanguage = (await headers()).get('accept-language') ?? '';
  const locale = acceptLanguage.toLowerCase().startsWith('ko') ? 'ko' : 'en';
  const t = await getTranslations({ locale, namespace: 'viewer' });
  const tc = await getTranslations({ locale, namespace: 'common' });

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-12 items-center px-4">
        <span className="flex items-center gap-2 text-sm font-bold tracking-tight">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-accent" />
          {tc('appName')}
        </span>
      </header>

      <main className="flex flex-1 flex-col p-4">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg bg-caption-bg p-8 text-center">
          <Radio size={28} aria-hidden className="text-caption-source" />
          <p className="text-[20px] font-semibold text-caption-target">{t('notReady.title')}</p>
          <p className="max-w-md text-[15px] text-caption-source">{t('notReady.hint')}</p>
        </div>
      </main>

      {/* 첫 진입 고지 배너 (docs/08 §2.2) */}
      <footer className="border-t border-border px-4 py-3 text-center text-[13px] text-text-faint">
        {t('consentNotice')}
      </footer>
    </div>
  );
}
