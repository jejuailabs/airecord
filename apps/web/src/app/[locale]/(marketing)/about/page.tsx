import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { JsonLd } from '@/components/seo/JsonLd';
import {
  jsonLdSoftwareApplication,
  jsonLdOrganization,
  jsonLdFaqPage,
  jsonLdBreadcrumbList,
} from '@/lib/seo/jsonld';
import {
  Globe,
  FileText,
  Cpu,
  Briefcase,
  BookOpen,
  CreditCard,
  BookMarked,
  HelpCircle,
} from 'lucide-react';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'about' });
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: {
      canonical: `/${locale}/about`,
      languages: { ko: '/ko/about', en: '/en/about', 'x-default': '/ko/about' },
    },
  };
}

const CLUSTER_ICONS = {
  interpretation: Globe,
  translation: FileText,
  technology: Cpu,
  useCases: Briefcase,
  guide: BookOpen,
  pricing: CreditCard,
  glossary: BookMarked,
  faq: HelpCircle,
} as const;

const CLUSTER_HREFS = {
  interpretation: '/features',
  translation: '/features/translation',
  technology: '/technology',
  useCases: '/use-cases',
  guide: '/guide',
  pricing: '/pricing',
  glossary: '/glossary',
  faq: '/faq',
} as const;

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'about' });

  const faqItems = (t.raw('faq.items') as { q: string; a: string }[]).map((item) => ({
    question: item.q,
    answer: item.a,
  }));

  return (
    <>
      <JsonLd data={jsonLdSoftwareApplication(locale)} />
      <JsonLd data={jsonLdOrganization()} />
      <JsonLd data={jsonLdFaqPage(faqItems)} />
      <JsonLd
        data={jsonLdBreadcrumbList([
          { name: 'InterLive', href: `/${locale}` },
          { name: t('hero.title'), href: `/${locale}/about` },
        ])}
      />

      <div className="mx-auto max-w-4xl space-y-16 py-8">
        {/* ── Hero ── */}
        <section className="space-y-5">
          <span className="inline-block rounded-full bg-accent/10 px-3 py-1 text-[12px] font-semibold text-accent">
            {t('hero.eyebrow')}
          </span>
          <h1 className="text-[36px] font-bold leading-tight tracking-tight text-text">
            {t('hero.title')}
          </h1>
          <p className="max-w-2xl text-[16px] leading-relaxed text-text-muted">
            {t('hero.definition')}
          </p>
        </section>

        {/* ── Stats bar ── */}
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(['languages', 'modes', 'formats', 'token'] as const).map((key) => (
            <div
              key={key}
              className="rounded-xl border border-border bg-bg-card p-5 text-center"
            >
              <div className="text-[28px] font-bold tracking-tight text-accent">
                {t(`stats.${key}.value`)}
              </div>
              <div className="mt-1 text-[12px] text-text-muted">{t(`stats.${key}.label`)}</div>
            </div>
          ))}
        </section>

        {/* ── Cluster links ── */}
        <section className="space-y-5">
          <h2 className="text-[22px] font-bold text-text">{t('clusters.title')}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(Object.keys(CLUSTER_ICONS) as (keyof typeof CLUSTER_ICONS)[]).map((key) => {
              const Icon = CLUSTER_ICONS[key];
              return (
                <Link
                  key={key}
                  href={CLUSTER_HREFS[key]}
                  className="group flex flex-col gap-3 rounded-xl border border-border bg-bg-card p-5 transition-colors hover:border-accent/40 hover:bg-bg-hover"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <Icon size={18} aria-hidden />
                  </div>
                  <div>
                    <div className="font-semibold text-text">{t(`clusters.${key}.title`)}</div>
                    <div className="mt-0.5 text-[12px] leading-snug text-text-muted">
                      {t(`clusters.${key}.desc`)}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="space-y-5">
          <h2 className="text-[22px] font-bold text-text">{t('faq.title')}</h2>
          <div className="divide-y divide-border rounded-xl border border-border bg-bg-card">
            {faqItems.map((item, i) => (
              <details key={i} className="group px-6 py-5">
                <summary className="cursor-pointer list-none text-[15px] font-semibold text-text marker:hidden">
                  {item.question}
                </summary>
                <p className="mt-3 text-[14px] leading-relaxed text-text-muted">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="brand-panel rounded-xl p-8 text-center text-white">
          <h2 className="text-[24px] font-bold">
            {locale === 'ko' ? '지금 바로 시작하세요' : 'Get started now'}
          </h2>
          <p className="mt-2 text-white/70">
            {locale === 'ko'
              ? '로그인 없이 500자 무료 체험, 가입 후 월 20분 무료.'
              : 'Try 500 characters free without login. 20 free minutes per month after sign-up.'}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href="/try"
              className="rounded-lg bg-white px-6 py-2.5 text-[14px] font-semibold text-accent"
            >
              {locale === 'ko' ? '무료 체험' : 'Try free'}
            </Link>
            <Link
              href="/login"
              className="rounded-lg border border-white/30 px-6 py-2.5 text-[14px] font-semibold text-white hover:border-white/60"
            >
              {locale === 'ko' ? '가입하기' : 'Sign up'}
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
