import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CompanyJoinCard } from '@/components/company/CompanyJoinCard';
import { CompanyManageCard } from '@/components/company/CompanyManageCard';

/**
 * 설정 — 지금은 회사(Business) 관련 카드가 중심이다.
 *   · 회사 관리: Business 결제자(대표)에게만 보인다 (아니면 카드가 그려지지 않음)
 *   · 회사 합류: 누구나 — 회사명 검색 → 코드 입력으로 회사 지갑에 합류
 * 로그인은 (app) 레이아웃이 보장한다 (비로그인은 /login으로).
 */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('settings');

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-2">
      <div>
        <h1 className="text-[28px] font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-[14px] text-text-muted">{t('subtitle')}</p>
      </div>
      <CompanyManageCard />
      <CompanyJoinCard />
    </div>
  );
}
