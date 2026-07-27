import { TranslateTabs } from '@/components/translate/TranslateTabs';

/** 텍스트 번역과 파일 번역은 한 화면 안에서 서로 오갈 수 있어야 한다 */
export default function TranslateLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <TranslateTabs />
      {children}
    </div>
  );
}
