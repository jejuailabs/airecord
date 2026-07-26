import { cookies } from 'next/headers';
import { redirect } from '@/i18n/navigation';
import { adminDb, SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { AppSidebar, type SidebarAccount, type SidebarUsage } from '@/components/shell/AppSidebar';
import { AppTopbar } from '@/components/shell/AppTopbar';
import { getPlan } from '@sotong/shared/constants';

/** 사이드바 하단 카드에 쓸 워크스페이스 요약 — 실패해도 화면은 뜬다 */
async function loadShellData(
  uid: string,
  fallbackName: string,
): Promise<{ usage: SidebarUsage; account: SidebarAccount }> {
  const free = getPlan('free');
  const usage: SidebarUsage = { usedMinutes: 0, includedMinutes: free?.includedMinutes ?? 30 };
  const account: SidebarAccount = { name: fallbackName, role: 'owner' };
  try {
    const db = adminDb();
    const userSnap = await db.collection('users').doc(uid).get();
    const wsId = userSnap.get('lastWorkspaceId') as string | undefined;
    if (!wsId) return { usage, account };
    const ws = await db.collection('workspaces').doc(wsId).get();
    const billing = ws.get('billing') as
      | { includedMinutes?: number; usedMinutes?: number }
      | undefined;
    return {
      usage: {
        usedMinutes: billing?.usedMinutes ?? 0,
        includedMinutes: billing?.includedMinutes ?? usage.includedMinutes,
      },
      account: {
        name: (ws.get('name') as string) || fallbackName,
        role: (ws.get('ownerUid') as string) === uid ? 'owner' : 'member',
      },
    };
  } catch {
    return { usage, account };
  }
}

/**
 * (app) 그룹 — 인증 가드(docs/03 §1) + 사이드바 SaaS 셸.
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
    return null;
  }

  const { usage, account } = await loadShellData(
    user.uid,
    user.name ?? user.email ?? 'InterLive',
  );

  return (
    <div className="flex min-h-screen">
      <AppSidebar usage={usage} account={account} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar />
        <main className="w-full flex-1 px-5 py-7 md:px-8">{children}</main>
      </div>
    </div>
  );
}
