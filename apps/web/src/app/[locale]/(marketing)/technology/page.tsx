import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { JsonLd } from '@/components/seo/JsonLd';
import { jsonLdSoftwareApplication, jsonLdFaqPage, jsonLdBreadcrumbList, jsonLdArticle } from '@/lib/seo/jsonld';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://aitr.kr';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'technology' });
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: {
      canonical: `/${locale}/technology`,
      languages: { ko: '/ko/technology', en: '/en/technology', 'x-default': '/ko/technology' },
    },
  };
}

export function generateStaticParams() {
  return [{ locale: 'ko' }, { locale: 'en' }];
}

export default async function TechnologyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'technology' });

  const faqItems = (t.raw('faq.items') as { q: string; a: string }[]).map((i) => ({ question: i.q, answer: i.a }));
  const stackItems = t.raw('stack.items') as { name: string; tech: string; desc: string }[];
  const pipelineSteps = t.raw('pipeline.steps') as { step: string; title: string; desc: string }[];

  return (
    <>
      <JsonLd data={jsonLdSoftwareApplication(locale)} />
      <JsonLd data={jsonLdFaqPage(faqItems)} />
      <JsonLd data={jsonLdArticle(t('meta.title'), t('meta.description'), `${BASE_URL}/${locale}/technology`, locale)} />
      <JsonLd data={jsonLdBreadcrumbList([
        { name: 'InterLive', href: `/${locale}` },
        { name: t('hero.eyebrow'), href: `/${locale}/technology` },
      ])} />

      <div className="mx-auto max-w-4xl space-y-16 py-8">
        <section className="space-y-4">
          <span className="inline-block rounded-full bg-accent/10 px-3 py-1 text-[12px] font-semibold text-accent">{t('hero.eyebrow')}</span>
          <h1 className="text-[36px] font-bold leading-tight tracking-tight text-text">{t('hero.title')}</h1>
          <p className="max-w-2xl text-[16px] leading-relaxed text-text-muted">{t('hero.subtitle')}</p>
        </section>

        <section className="rounded-xl border border-accent/20 bg-accent/5 p-6">
          <h2 className="mb-2 text-[15px] font-bold text-accent">{t('definition.title')}</h2>
          <p className="text-[14px] leading-relaxed text-text-muted">{t('definition.body')}</p>
        </section>

        {/* Pipeline */}
        <section className="space-y-5">
          <h2 className="text-[22px] font-bold text-text">{t('pipeline.title')}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {pipelineSteps.map((s) => (
              <div key={s.step} className="rounded-xl border border-border bg-bg-card p-5">
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-[13px] font-bold text-accent">{s.step}</div>
                <div className="font-semibold text-text">{s.title}</div>
                <div className="mt-1 text-[12px] leading-snug text-text-muted">{s.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Tech stack */}
        <section className="space-y-5">
          <h2 className="text-[22px] font-bold text-text">{t('stack.title')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {stackItems.map((item, i) => (
              <div key={i} className="rounded-xl border border-border bg-bg-card p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-text">{item.name}</div>
                  <span className="shrink-0 rounded-md bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">{item.tech}</span>
                </div>
                <div className="mt-2 text-[13px] leading-snug text-text-muted">{item.desc}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-5">
          <h2 className="text-[22px] font-bold text-text">{t('faq.title')}</h2>
          <div className="divide-y divide-border rounded-xl border border-border bg-bg-card">
            {faqItems.map((item, i) => (
              <details key={i} className="px-6 py-5">
                <summary className="cursor-pointer list-none text-[15px] font-semibold text-text marker:hidden">{item.question}</summary>
                <p className="mt-3 text-[14px] leading-relaxed text-text-muted">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="brand-panel rounded-xl p-8 text-center text-white">
          <h2 className="text-[22px] font-bold">{locale === 'ko' ? '지금 바로 시작하세요' : 'Start now'}</h2>
          <div className="mt-5 flex justify-center gap-3">
            <Link href="/try" className="rounded-lg bg-white px-6 py-2.5 text-[14px] font-semibold text-accent">
              {locale === 'ko' ? '무료 체험' : 'Try free'}
            </Link>
            <Link href="/features" className="rounded-lg border border-white/30 px-6 py-2.5 text-[14px] font-semibold text-white hover:border-white/60">
              {locale === 'ko' ? '기능 보기' : 'See features'}
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
