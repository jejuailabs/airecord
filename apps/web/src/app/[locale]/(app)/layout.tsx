import { cookies } from 'next/headers';
import { redirect } from '@/i18n/navigation';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { getEntitlement } from '@/lib/server/entitlement';
import { AppSidebar, type SidebarAccount, type SidebarUsage } from '@/components/shell/AppSidebar';
import { AppTopbar } from '@/components/shell/AppTopbar';
import { getPlan } from '@sotong/shared/constants';

/** 사이드바 하단 카드에 쓸 워크스페이스 요약 — 실패해도 화면은 뜬다 */
async function loadShellData(
  uid: string,
  fallbackName: string,
  email?: string | null,
): Promise<{ usage: SidebarUsage; account: SidebarAccount; isAdmin: boolean }> {
  const free = getPlan('free');
  const usage: SidebarUsage = {
    usedMinutes: 0,
    includedMinutes: free?.includedMinutes ?? 10,
    daily: (free?.cycle ?? 'daily') === 'daily',
  };
  const account: SidebarAccount = { name: fallbackName, role: 'owner' };
  try {
    // ⚠ 워크스페이스를 여기서 또 읽지 않는다 — getEntitlement가 이미 읽었고,
    //   같은 문서를 두 번 왕복하면 화면이 그만큼 늦게 뜬다 (실측 왕복 32~46ms).
    const ent = await getEntitlement(uid, email);
    return {
      usage: {
        usedMinutes: ent.usedMinutes,
        includedMinutes: ent.includedMinutes,
        // 운영자·무제한은 한도가 없다 — 41/30 같은 이상한 표시가 나오지 않게 한다
        unlimited: ent.isAdmin || ent.unlimited,
        daily: getPlan(ent.plan)?.cycle === 'daily',
      },
      account: {
        name: ent.workspaceName || fallbackName,
        role: ent.isAdmin ? 'admin' : ent.isOwner ? 'owner' : 'member',
      },
      isAdmin: ent.isAdmin,
    };
  } catch {
    return { usage, account, isAdmin: false };
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

  const { usage, account, isAdmin } = await loadShellData(
    user.uid,
    user.name ?? user.email ?? 'InterLive',
    user.email,
  );

  return (
    <div className="flex min-h-screen">
      <AppSidebar usage={usage} account={account} isAdmin={isAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar usage={usage} account={account} isAdmin={isAdmin} />
        <main className="w-full flex-1 px-5 py-7 md:px-8">{children}</main>
      </div>
    </div>
  );
}
