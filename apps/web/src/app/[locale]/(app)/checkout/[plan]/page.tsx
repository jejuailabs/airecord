import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { getPlan } from '@sotong/shared/constants';
import { CheckoutClient } from '@/components/billing/CheckoutClient';

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ locale: string; plan: string }>;
}) {
  const { locale, plan: planId } = await params;
  setRequestLocale(locale);
  const plan = getPlan(planId);
  if (!plan || plan.id === 'free') notFound();

  return <CheckoutClient planId={plan.id} />;
}
