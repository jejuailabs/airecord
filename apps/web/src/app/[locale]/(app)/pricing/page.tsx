import { setRequestLocale } from 'next-intl/server';
import { PricingSection } from '@/components/landing/PricingSection';

/**
 * 인앱 요금제 화면.
 * 예전엔 사이드바 '요금제'가 마케팅 홈(/#pricing)으로 튕겨 앱 밖으로 나갔다.
 * 같은 PricingSection을 앱 셸 안에서 보여줘 흐름이 끊기지 않게 한다.
 */
export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="mx-auto w-full max-w-5xl">
      <PricingSection />
    </div>
  );
}
