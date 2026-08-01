import { setRequestLocale } from 'next-intl/server';
import { FaceoffEntry } from '@/components/faceoff/FaceoffEntry';
import { getAppFlags } from '@/lib/server/app-flags';

/**
 * 마주통역 (모드 D) — 한 기기를 둘 사이에 두고 양방향 동시 통역.
 * 대면·대화·회의 모드와 완전히 분리된 화면·엔진 경로를 쓴다.
 *
 * '마주 1세션' 실험 플래그(운영 콘솔에서 토글)가 켜져 있으면 진입점에 방식 선택이 뜬다.
 */
export default async function FaceoffPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const flags = await getAppFlags();
  return <FaceoffEntry singleEnabled={flags.faceoffSingle} />;
}
