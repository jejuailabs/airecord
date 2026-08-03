import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { JsonLd } from '@/components/seo/JsonLd';
import { jsonLdSoftwareApplication, jsonLdFaqPage, jsonLdBreadcrumbList } from '@/lib/seo/jsonld';
import { Briefcase, Video, GraduationCap, Stethoscope, Scale, Plane } from 'lucide-react';

const CASE_ICONS = [Briefcase, Video, GraduationCap, Stethoscope, Scale, Plane];
const CASE_COLORS = [
  'text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-400',
  'text-purple-600 bg-purple-50 dark:bg-purple-950/40 dark:text-purple-400',
  'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400',
  'text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-400',
  'text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-400',
  'text-sky-600 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-400',
];

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'useCases' });
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: {
      canonical: `/${locale}/use-cases`,
      languages: { ko: '/ko/use-cases', en: '/en/use-cases', 'x-default': '/ko/use-cases' },
    },
  };
}

export function generateStaticParams() {
  return [{ locale: 'ko' }, { locale: 'en' }];
}

export default async function UseCasesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'useCases' });

  const faqItems = (t.raw('faq.items') as { q: string; a: string }[]).map((i) => ({ question: i.q, answer: i.a }));
  const cases = t.raw('cases') as {
    category: string; icon: string; title: string; desc: string; mode: string; modeLabel: string;
  }[];

  return (
    <>
      <JsonLd data={jsonLdSoftwareApplication(locale)} />
      <JsonLd data={jsonLdFaqPage(faqItems)} />
      <JsonLd data={jsonLdBreadcrumbList([
        { name: 'InterLive', href: `/${locale}` },
        { name: t('hero.eyebrow'), href: `/${locale}/use-cases` },
      ])} />

      <div className="mx-auto max-w-4xl space-y-16 py-8">
        <section className="space-y-4">
          <span className="inline-block rounded-full bg-accent/10 px-3 py-1 text-[12px] font-semibold text-accent">{t('hero.eyebrow')}</span>
          <h1 className="text-[36px] font-bold leading-tight tracking-tight text-text">{t('hero.title')}</h1>
          <p className="max-w-2xl text-[16px] leading-relaxed text-text-muted">{t('hero.subtitle')}</p>
        </section>

        <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {cases.map((c, i) => {
            const Icon = CASE_ICONS[i] ?? Briefcase;
            const modeHref = `/features/${c.mode}`;
            return (
              <div key={i} className="flex flex-col gap-4 rounded-xl border border-border bg-bg-card p-5">
                <div className="flex items-start gap-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${CASE_COLORS[i]}`}>
                    <Icon size={18} aria-hidden />
                  </span>
                  <span className="rounded-full bg-bg-sunken px-2 py-0.5 text-[11px] font-semibold text-text-muted">{c.category}</span>
                </div>
                <div>
                  <h2 className="font-bold text-text">{c.title}</h2>
                  <p className="mt-1.5 text-[13px] leading-snug text-text-muted">{c.desc}</p>
                </div>
                <Link href={modeHref} className="mt-auto text-[12px] font-semibold text-accent hover:underline">
                  {c.modeLabel} →
                </Link>
              </div>
            );
          })}
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
          <p className="mt-2 text-white/70">{locale === 'ko' ? '로그인 없이 500자 무료 체험.' : 'Try 500 characters free without login.'}</p>
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
