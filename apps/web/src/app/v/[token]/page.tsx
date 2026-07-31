import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { LiveCaptions } from '@/components/viewer/LiveCaptions';

/**
 * 자막 뷰어 (docs/06 §2.4) — 회의 참가자가 링크만으로 들어와 자막을 보는 공개 화면.
 * 로그인 유도 없음. 뷰어 UI 언어는 Accept-Language로 판단한다 (docs/06 §1).
 *
 * 자막은 /api/viewer/{token} 폴링으로 받는다. 클라이언트에 DB 접근권을 주지 않는다 —
 * 토큰 만료·폐기 검증을 서버에서만 하기 위해서다(lib/server/viewer.ts 주석 참고).
 */
export default async function ViewerPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
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
        <LiveCaptions
          token={token}
          labels={{
            waiting: t('waiting'),
            ended: t('ended'),
            invalid: t('invalidLink'),
          }}
        />
      </main>

      {/* 첫 진입 고지 배너 (docs/08 §2.2) */}
      <footer className="border-t border-border px-4 py-3 text-center text-[13px] text-text-faint">
        {t('consentNotice')}
      </footer>
    </div>
  );
}
