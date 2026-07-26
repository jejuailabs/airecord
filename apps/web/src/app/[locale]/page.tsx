import { redirect } from '@/i18n/navigation';

export default async function LocaleRoot({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Phase 1: 랜딩 없이 바로 시작 화면으로 (docs/06 §2.1 — 3초 안에 통역 시작)
  redirect({ href: '/dashboard', locale });
}
