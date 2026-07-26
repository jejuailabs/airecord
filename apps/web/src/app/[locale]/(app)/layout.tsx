import { cookies } from 'next/headers';
import { redirect } from '@/i18n/navigation';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { AppSidebar } from '@/components/shell/AppSidebar';
import { AppTopbar } from '@/components/shell/AppTopbar';

/**
 * (app) 그룹 — 인증 가드(docs/03 §1) + InterLive 시안의 사이드바 SaaS 셸.
 * /v/[token], /try, 랜딩은 이 그룹 밖이라 검사받지 않는다.
 */
export default async function AppGroupLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie).catch(() => null);
  if (!user) {
    redirect({ href: '/login', locale });
  }

  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar />
        <main className="w-full flex-1 px-5 py-7 md:px-8">{children}</main>
      </div>
    </div>
  );
}
