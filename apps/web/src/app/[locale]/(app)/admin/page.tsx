import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { currentAdmin } from '@/lib/server/admin';
import { AdminConsole } from '@/components/admin/AdminConsole';

/**
 * 운영 콘솔 (docs/06 §2.6).
 *
 * ⚠ 권한이 없으면 404를 낸다. 403이나 리다이렉트는 "여기 관리자 화면이 있다"를 알려준다.
 *   서버에서 먼저 막고, API에서 또 막는다 — 화면만 막으면 API를 직접 두드리면 뚫린다.
 */
export default async function AdminPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const admin = await currentAdmin();
  if (!admin) notFound();

  return <AdminConsole />;
}
