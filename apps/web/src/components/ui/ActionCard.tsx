'use client';

import { useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';

/**
 * 시작 카드 — 히어로형 세로 카드.
 * 클릭 즉시 눌린 상태와 스피너를 보여준다. 화면 전환이 늦어도 "눌렸나?" 싶은 구간을 만들지 않는다.
 */
export function ActionCard({
  href,
  icon,
  title,
  subtitle,
  cta,
  tone,
  compact = false,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  cta?: string;
  tone: 'teal' | 'violet';
  /** 2열 격자에 들어가는 작은 카드 — 오브를 줄이고 CTA 버튼을 뺀다 */
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const orb = tone === 'teal' ? 'cta-orb-teal' : 'cta-orb-violet';
  const glow = tone === 'teal' ? 'rgb(45 212 191 / .55)' : 'rgb(124 77 255 / .55)';
  const btn = tone === 'teal' ? 'btn-gradient' : 'btn-gradient-violet';

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.push(href as never))}
      aria-busy={pending}
      className={`group press-card relative flex w-full flex-col items-center rounded-2xl border border-border bg-bg-raised text-center transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-1 hover:border-border-strong hover:shadow-token ${
        compact ? 'gap-3 px-4 py-6' : 'gap-5 px-8 py-10'
      }`}
    >
      <span
        className={`${compact ? 'hero-glow-sm' : 'hero-glow orb-float'} ${orb} text-white`}
        style={{ ['--glow-color' as string]: glow }}
        aria-hidden
      >
        {pending ? (
          <Loader2 size={compact ? 26 : 40} className="animate-spin" />
        ) : (
          icon
        )}
      </span>

      <span>
        <span
          className={`block font-bold tracking-tight ${compact ? 'text-[17px]' : 'text-[22px]'}`}
        >
          {title}
        </span>
        <span
          className={`mt-1 block text-text-muted ${compact ? 'text-[13px]' : 'text-[15px]'}`}
        >
          {subtitle}
        </span>
      </span>

      {cta ? (
        <span
          className={`${btn} flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[16px] font-bold`}
        >
          {pending ? <Loader2 size={17} className="animate-spin" aria-hidden /> : null}
          {cta}
        </span>
      ) : null}
    </button>
  );
}
