import { setRequestLocale } from 'next-intl/server';
import { FaceoffInterpreter } from '@/components/faceoff/FaceoffInterpreter';

/**
 * 마주통역 (모드 D) — 한 기기를 둘 사이에 두고 양방향 동시 통역.
 * 대면·대화·회의 모드와 완전히 분리된 화면·엔진 경로를 쓴다.
 */
export default async function FaceoffPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <FaceoffInterpreter />;
}
