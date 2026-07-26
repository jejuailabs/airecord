import { AppHeader } from '@/components/AppHeader';

/** 마케팅 영역(랜딩·로그인·체험) — 상단 헤더 셸 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6">{children}</main>
    </>
  );
}
