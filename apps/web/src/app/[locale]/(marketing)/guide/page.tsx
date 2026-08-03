import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { JsonLd } from '@/components/seo/JsonLd';
import { jsonLdSoftwareApplication, jsonLdFaqPage, jsonLdBreadcrumbList } from '@/lib/seo/jsonld';
import { BookOpen, ChevronRight } from 'lucide-react';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'guide' });
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: {
      canonical: `/${locale}/guide`,
      languages: { ko: '/ko/guide', en: '/en/guide', 'x-default': '/ko/guide' },
    },
  };
}

export function generateStaticParams() {
  return [{ locale: 'ko' }, { locale: 'en' }];
}

export default async function GuidePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'guide' });

  const faqItems = (t.raw('faq.items') as { q: string; a: string }[]).map((i) => ({ question: i.q, answer: i.a }));
  const guides = t.raw('guides') as { slug: string; title: string; desc: string }[];

  return (
    <>
      <JsonLd data={jsonLdSoftwareApplication(locale)} />
      <JsonLd data={jsonLdFaqPage(faqItems)} />
      <JsonLd data={jsonLdBreadcrumbList([
        { name: 'InterLive', href: `/${locale}` },
        { name: t('hero.eyebrow'), href: `/${locale}/guide` },
      ])} />

      <div className="mx-auto max-w-4xl space-y-16 py-8">
        <section className="space-y-4">
          <span className="inline-block rounded-full bg-accent/10 px-3 py-1 text-[12px] font-semibold text-accent">{t('hero.eyebrow')}</span>
          <h1 className="text-[36px] font-bold leading-tight tracking-tight text-text">{t('hero.title')}</h1>
          <p className="max-w-2xl text-[16px] leading-relaxed text-text-muted">{t('hero.subtitle')}</p>
        </section>

        <section className="divide-y divide-border rounded-xl border border-border bg-bg-card">
          {guides.map((g, i) => (
            <div key={i} className="flex items-start gap-4 px-6 py-5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <BookOpen size={16} aria-hidden />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-text">{g.title}</div>
                <div className="mt-0.5 text-[13px] text-text-muted">{g.desc}</div>
              </div>
              <ChevronRight size={16} className="mt-1 shrink-0 text-text-muted" aria-hidden />
            </div>
          ))}
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
          <h2 className="text-[22px] font-bold">{locale === 'ko' ? '지금 바로 시작하세요' : 'Get started now'}</h2>
          <div className="mt-5 flex justify-center gap-3">
            <Link href="/try" className="rounded-lg bg-white px-6 py-2.5 text-[14px] font-semibold text-accent">
              {locale === 'ko' ? '무료 체험' : 'Try free'}
            </Link>
            <Link href="/pricing" className="rounded-lg border border-white/30 px-6 py-2.5 text-[14px] font-semibold text-white hover:border-white/60">
              {locale === 'ko' ? '요금제 보기' : 'View pricing'}
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
