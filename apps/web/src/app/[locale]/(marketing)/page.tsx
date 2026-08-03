import { cookies } from 'next/headers';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Check, Languages, Link2, Mic, ScrollText } from 'lucide-react';
import { Link, redirect } from '@/i18n/navigation';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { LiveCaptionDemo } from '@/components/landing/LiveCaptionDemo';
import { ZoomMockup } from '@/components/landing/ZoomMockup';
import { DashboardPreview } from '@/components/landing/DashboardPreview';
import { PricingSection } from '@/components/landing/PricingSection';

/**
 * 랜딩 (docs/06 라우트 트리의 (marketing) 루트).
 * 원칙: 내용을 늘어놓지 않는다 — 제품이 돌아가는 모습(자막 데모·줌 목업)이 곧 설명이다.
 */
export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // 이미 로그인했으면 랜딩을 볼 이유가 없다 — 바로 대시보드로 보낸다
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (cookie && (await verifySessionCookie(cookie).catch(() => null))) {
    redirect({ href: '/dashboard', locale });
  }

  const t = await getTranslations('landing');

  return (
    <div className="flex flex-col">
      {/* ── 히어로: InterLive 시안 — 그라데이션 패널 + 원형 CTA + 대시보드 목업 ── */}
      <section className="brand-panel grid items-center gap-8 overflow-hidden rounded-lg p-6 py-10 md:p-10 lg:grid-cols-[5fr_6fr]">
        <div className="flex flex-col gap-6 text-white">
          <img
            src="/main_logo_tra.png"
            alt="InterLive"
            className="h-10 w-auto self-start object-contain sm:h-12"
          />
          <span className="w-fit rounded-sm bg-white/10 px-2.5 py-1 text-[12px] font-semibold text-white/90">
            {t('hero.badge')}
          </span>
          <h1 className="whitespace-pre-line text-[40px] font-bold leading-[1.15] tracking-tight">
            {t('hero.title')}
          </h1>
          <p className="max-w-md whitespace-pre-line text-white/70">{t('hero.subtitle')}</p>

          {/* 원형 CTA 2개 — 어떤 폭에서도 한 줄에 둘, 각자 카드로 구분한다 */}
          <div className="grid grid-cols-2 gap-3 pt-2 sm:gap-4">
            <Link
              href="/live"
              className="group flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/[.04] px-3 py-5 text-center transition-[transform,background-color,border-color] duration-200 hover:-translate-y-1 hover:border-white/25 hover:bg-white/[.08]"
            >
              <span
                className="cta-orb-violet orb-float flex h-[68px] w-[68px] items-center justify-center rounded-full text-white sm:h-20 sm:w-20"
                style={{ ['--glow-color' as string]: 'rgb(124 77 255 / .55)' }}
                aria-hidden
              >
                <Mic size={26} />
              </span>
              <span>
                <span className="block text-[15px] font-bold">{t('hero.orbInPerson.title')}</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-white/55">
                  {t('hero.orbInPerson.subtitle')}
                </span>
              </span>
            </Link>
            <Link
              href="/meeting"
              className="group flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/[.04] px-3 py-5 text-center transition-[transform,background-color,border-color] duration-200 hover:-translate-y-1 hover:border-white/25 hover:bg-white/[.08]"
            >
              <span
                className="cta-orb-teal orb-float flex h-[68px] w-[68px] items-center justify-center rounded-full text-white sm:h-20 sm:w-20"
                style={{ ['--glow-color' as string]: 'rgb(45 212 191 / .55)' }}
                aria-hidden
              >
                <Link2 size={26} />
              </span>
              <span>
                <span className="block text-[15px] font-bold">{t('hero.orbMeeting.title')}</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-white/55">
                  {t('hero.orbMeeting.subtitle')}
                </span>
              </span>
            </Link>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              href="/try"
              className="flex h-11 items-center rounded-md bg-white px-5 text-sm font-semibold text-[#171243]"
            >
              {t('hero.tryCta')}
            </Link>
            <Link
              href="/login"
              className="flex h-11 items-center rounded-md border border-white/25 px-5 text-sm font-semibold text-white hover:border-white/50"
            >
              {t('hero.signupCta')}
            </Link>
            <a
              href="#pricing"
              className="flex h-11 items-center px-2 text-sm font-semibold text-white/70 hover:text-white"
            >
              {t('hero.pricingCta')}
            </a>
          </div>

          {/* 하단 배지 3 (시안) */}
          <div className="flex flex-wrap gap-4 border-t border-white/10 pt-4 text-[13px] text-white/70">
            {(['badgeRecord', 'badgeCaption', 'badgeSecure'] as const).map((k) => (
              <span key={k} className="flex items-center gap-1.5">
                <Check size={13} aria-hidden className="text-accent-2" />
                {t(`hero.${k}`)}
              </span>
            ))}
          </div>
        </div>
        <DashboardPreview />
      </section>

      {/* ── 살아있는 자막 데모 ── */}
      <section className="grid items-center gap-10 py-16 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h2 className="text-[28px] font-bold leading-tight">{t('captionDemo.title')}</h2>
          <p className="max-w-md text-text-muted">{t('captionDemo.body')}</p>
          <p className="text-[13px] text-text-faint">{t('hero.trialNote')}</p>
        </div>
        <LiveCaptionDemo />
      </section>

      {/* ── 줌 회의 실시간 번역 — 체험하기 어려운 장면을 눈앞에 ── */}
      <section className="grid items-center gap-10 border-t border-border py-16 lg:grid-cols-2">
        <div className="order-2 lg:order-1">
          <ZoomMockup />
        </div>
        <div className="order-1 flex flex-col gap-4 lg:order-2">
          <h2 className="text-[28px] font-bold leading-tight">{t('zoom.title')}</h2>
          <p className="max-w-md text-text-muted">{t('zoom.body')}</p>
          <ul className="flex flex-col gap-2 text-sm text-text-muted">
            <li>· {t('zoom.point1')}</li>
            <li>· {t('zoom.point2')}</li>
            <li>· {t('zoom.point3')}</li>
          </ul>
        </div>
      </section>

      {/* ── 핵심 기능 3 ── */}
      <section className="grid gap-4 border-t border-border py-16 md:grid-cols-3">
        {(
          [
            { icon: <Languages size={20} aria-hidden />, key: 'autoDetect' },
            { icon: <Mic size={20} aria-hidden />, key: 'voiceOut' },
            { icon: <ScrollText size={20} aria-hidden />, key: 'records' },
          ] as const
        ).map((f) => (
          <div key={f.key} className="flex flex-col gap-3 rounded-lg border border-border bg-bg-raised p-6">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-weak text-accent">
              {f.icon}
            </span>
            <h3 className="font-semibold">{t(`features.${f.key}.title`)}</h3>
            <p className="text-sm text-text-muted">{t(`features.${f.key}.body`)}</p>
          </div>
        ))}
      </section>

      {/* ── 요금제 ── */}
      <div className="border-t border-border">
        <PricingSection />
      </div>

      {/* ── 마지막 CTA ── */}
      <section className="flex flex-col items-center gap-4 border-t border-border py-16 text-center">
        <h2 className="text-[28px] font-bold">{t('finalCta.title')}</h2>
        <p className="text-sm text-text-muted">{t('finalCta.body')}</p>
        <Link
          href="/try"
          className="flex h-12 items-center rounded-md bg-accent px-8 font-semibold text-accent-text"
        >
          {t('hero.tryCta')}
        </Link>
      </section>
    </div>
  );
}
