import { setRequestLocale } from 'next-intl/server';
import { LiveInterpreter } from '@/components/live/LiveInterpreter';

export default async function LivePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LiveInterpreter />;
}
