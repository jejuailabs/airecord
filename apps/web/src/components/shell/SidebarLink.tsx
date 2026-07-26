'use client';

import { useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';

/**
 * 사이드바 항목 — 클릭 즉시 활성 표시와 스피너를 보여준다.
 * 서버 렌더가 늦어도 반응이 없는 것처럼 보이지 않게 한다.
 */
export function SidebarLink({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const highlighted = active || pending;

  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-busy={pending}
      onClick={() => {
        if (active) return;
        startTransition(() => router.push(href as never));
      }}
      className={`relative flex h-12 w-full items-center gap-3 rounded-lg px-3.5 text-left text-[15px] ${
        highlighted
          ? 'bg-white/[.07] font-semibold text-caption-target'
          : 'text-caption-source hover:bg-white/[.04] hover:text-caption-target'
      }`}
    >
      {highlighted ? (
        <span
          aria-hidden
          className="absolute right-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-l bg-accent"
        />
      ) : null}
      <span aria-hidden className={highlighted ? 'text-accent' : ''}>
        {pending ? <Loader2 size={19} className="animate-spin" /> : icon}
      </span>
      {label}
    </button>
  );
}
