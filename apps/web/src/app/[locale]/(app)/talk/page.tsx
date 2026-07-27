import { setRequestLocale } from 'next-intl/server';
import { LiveInterpreter } from '@/components/live/LiveInterpreter';

/**
 * 대화 통역(무전기) — 대면 통역과 엔진은 같고 화면만 다르다.
 * 대면 통역은 상대 말을 계속 받아 읽는 단방향, 이쪽은 짧게 주고받는 양방향이다.
 */
export default async function TalkPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LiveInterpreter variant="talk" />;
}
