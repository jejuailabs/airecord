import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { JsonLd } from '@/components/seo/JsonLd';
import { jsonLdFaqPage, jsonLdBreadcrumbList } from '@/lib/seo/jsonld';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'faqHub' });
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: {
      canonical: `/${locale}/faq`,
      languages: { ko: '/ko/faq', en: '/en/faq', 'x-default': '/ko/faq' },
    },
  };
}

export function generateStaticParams() {
  return [{ locale: 'ko' }, { locale: 'en' }];
}

export default async function FaqPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'faqHub' });

  const categories = t.raw('categories') as { title: string; items: { q: string; a: string }[] }[];
  const allFaqItems = categories.flatMap((c) => c.items.map((i) => ({ question: i.q, answer: i.a })));

  return (
    <>
      <JsonLd data={jsonLdFaqPage(allFaqItems)} />
      <JsonLd data={jsonLdBreadcrumbList([
        { name: 'InterLive', href: `/${locale}` },
        { name: t('hero.eyebrow'), href: `/${locale}/faq` },
      ])} />

      <div className="mx-auto max-w-4xl space-y-16 py-8">
        <section className="space-y-4">
          <span className="inline-block rounded-full bg-accent/10 px-3 py-1 text-[12px] font-semibold text-accent">{t('hero.eyebrow')}</span>
          <h1 className="text-[36px] font-bold leading-tight tracking-tight text-text">{t('hero.title')}</h1>
          <p className="max-w-2xl text-[16px] leading-relaxed text-text-muted">{t('hero.subtitle')}</p>
        </section>

        {categories.map((cat, ci) => (
          <section key={ci} className="space-y-4">
            <h2 className="text-[20px] font-bold text-text">{cat.title}</h2>
            <div className="divide-y divide-border rounded-xl border border-border bg-bg-card">
              {cat.items.map((item, i) => (
                <details key={i} className="px-6 py-5">
                  <summary className="cursor-pointer list-none text-[15px] font-semibold text-text marker:hidden">{item.q}</summary>
                  <p className="mt-3 text-[14px] leading-relaxed text-text-muted">{item.a}</p>
                </details>
              ))}
            </div>
          </section>
        ))}

        <section className="brand-panel rounded-xl p-8 text-center text-white">
          <h2 className="text-[22px] font-bold">{locale === 'ko' ? '더 궁금한 점이 있으신가요?' : 'Still have questions?'}</h2>
          <p className="mt-2 text-white/70">{locale === 'ko' ? '직접 체험해보세요.' : 'Try it for yourself.'}</p>
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
