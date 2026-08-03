import { cookies } from 'next/headers';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Info, LayoutDashboard, ChevronRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { getEntitlement } from '@/lib/server/entitlement';
import { listRecords, retentionDaysFor } from '@/lib/server/records';
import { MyPageRecords } from '@/components/records/MyPageRecords';

/**
 * 마이페이지 — 번역 결과 보관함 (사용자 지시 2026-08-03).
 * 파일·원본형·텍스트 번역 결과가 여기 쌓인다. 등급별 보관 기간을 안내하고,
 * Business는 무제한. (자동 삭제는 아직 안 하고 만료 표시만 — 사용자 지시)
 */
export default async function MyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('mypage');

  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie).catch(() => null);
  const [records, ent] = user
    ? await Promise.all([listRecords(user.uid), getEntitlement(user.uid, user.email)])
    : [[], null];

  const days = ent ? retentionDaysFor(ent.plan) : 7;
  const usageRemaining = ent
    ? ent.unlimited || ent.isAdmin
      ? null
      : Math.max(0, ent.includedMinutes - ent.usedMinutes) + ent.topupTokens
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[30px] font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-text-muted">{t('subtitle')}</p>
      </div>

      {/* 사용량 요약 바로가기 — 현황은 대시보드가 담당한다 (동선만 연결) */}
      <Link
        href="/dashboard"
        className="flex items-center gap-4 rounded-xl border border-border bg-bg-raised px-5 py-4 transition-colors duration-150 hover:border-accent"
      >
        <span className="icon-chip icon-chip-accent shrink-0" aria-hidden>
          <LayoutDashboard size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">{t('usageTitle')}</div>
          <div className="mt-0.5 text-[13.5px] text-text-muted">
            {usageRemaining == null
              ? t('usageUnlimited')
              : t('usageRemaining', { tokens: usageRemaining })}
          </div>
        </div>
        <ChevronRight size={18} aria-hidden className="shrink-0 text-text-faint" />
      </Link>

      {/* 보관 정책 안내 — 등급별로 다르다 */}
      <div className="flex items-start gap-3 rounded-xl border border-border bg-bg-raised px-5 py-4">
        <Info size={18} aria-hidden className="mt-0.5 shrink-0 text-accent" />
        <div className="text-[14px] text-text-muted">
          <p className="font-semibold text-text">
            {days == null ? t('policyUnlimited') : t('policyLimited', { days })}
          </p>
          <p className="mt-0.5">{t('policyNote')}</p>
        </div>
      </div>

      <MyPageRecords records={records} locale={locale} />
    </div>
  );
}
