import { setRequestLocale } from 'next-intl/server';
import { MeetingStart } from '@/components/meeting/MeetingStart';

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <MeetingStart />;
}
