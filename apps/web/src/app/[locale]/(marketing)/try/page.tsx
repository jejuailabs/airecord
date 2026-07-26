import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LiveInterpreter } from '@/components/live/LiveInterpreter';

/**
 * 비회원 체험 — 로그인 없이 실제 통역 성능을 그대로 보여준다.
 * 제한: 문장 10개 + 서버 하드 캡(TRIAL_MAX_DURATION_SEC). 끝나면 로그인 유도.
 */
export default async function TryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'try' });

  return (
    <div className="flex flex-col gap-2">
      <p className="rounded-md bg-accent-weak px-4 py-2 text-center text-[13px] text-accent">
        {t('banner')}
      </p>
      <LiveInterpreter trial />
    </div>
  );
}
