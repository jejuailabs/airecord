import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { JsonLd } from '@/components/seo/JsonLd';
import { jsonLdBreadcrumbList } from '@/lib/seo/jsonld';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://aitr.kr';

function jsonLdGlossary(terms: { term: string; def: string }[], locale: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'DefinedTermSet',
    name: locale === 'ko' ? 'InterLive AI 통역·번역 용어사전' : 'InterLive AI Interpretation & Translation Glossary',
    url: `${BASE_URL}/${locale}/glossary`,
    hasDefinedTerm: terms.map((t) => ({
      '@type': 'DefinedTerm',
      name: t.term,
      description: t.def,
      inDefinedTermSet: `${BASE_URL}/${locale}/glossary`,
    })),
  };
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'glossary' });
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: {
      canonical: `/${locale}/glossary`,
      languages: { ko: '/ko/glossary', en: '/en/glossary', 'x-default': '/ko/glossary' },
    },
  };
}

export function generateStaticParams() {
  return [{ locale: 'ko' }, { locale: 'en' }];
}

export default async function GlossaryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'glossary' });

  const terms = t.raw('terms') as { term: string; def: string; en?: string; ko?: string }[];

  // group alphabetically (by first char)
  const grouped = terms.reduce<Record<string, typeof terms>>((acc, term) => {
    const key = (term.term[0] ?? '#').toUpperCase();
    if (!acc[key]) acc[key] = [];
    acc[key].push(term);
    return acc;
  }, {});
  const sortedKeys = Object.keys(grouped).sort();

  return (
    <>
      <JsonLd data={jsonLdGlossary(terms, locale)} />
      <JsonLd data={jsonLdBreadcrumbList([
        { name: 'InterLive', href: `/${locale}` },
        { name: t('hero.eyebrow'), href: `/${locale}/glossary` },
      ])} />

      <div className="mx-auto max-w-4xl space-y-12 py-8">
        <section className="space-y-4">
          <span className="inline-block rounded-full bg-accent/10 px-3 py-1 text-[12px] font-semibold text-accent">{t('hero.eyebrow')}</span>
          <h1 className="text-[36px] font-bold leading-tight tracking-tight text-text">{t('hero.title')}</h1>
          <p className="max-w-2xl text-[16px] leading-relaxed text-text-muted">{t('hero.subtitle')}</p>
          <p className="text-[13px] text-text-muted">{locale === 'ko' ? `총 ${terms.length}개 용어` : `${terms.length} terms`}</p>
        </section>

        {/* A-Z / ㄱ-ㅎ index */}
        <nav aria-label={locale === 'ko' ? '가나다 색인' : 'Alphabetical index'} className="flex flex-wrap gap-1.5">
          {sortedKeys.map((k) => (
            <a
              key={k}
              href={`#group-${k}`}
              className="rounded-md border border-border px-2.5 py-1 text-[12px] font-semibold text-text-muted hover:border-accent/40 hover:text-accent"
            >
              {k}
            </a>
          ))}
        </nav>

        {sortedKeys.map((k) => (
          <section key={k} id={`group-${k}`} className="space-y-3 scroll-mt-20">
            <h2 className="text-[18px] font-bold text-text">{k}</h2>
            <dl className="divide-y divide-border rounded-xl border border-border bg-bg-card">
              {(grouped[k] ?? []).map((term, i) => (
                <div key={i} className="px-6 py-4">
                  <dt className="font-semibold text-text">
                    {term.term}
                    {(term.en || term.ko) && (
                      <span className="ml-2 text-[12px] font-normal text-text-muted">
                        {locale === 'ko' ? term.en : term.ko}
                      </span>
                    )}
                  </dt>
                  <dd className="mt-1 text-[13px] leading-relaxed text-text-muted">{term.def}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        <section className="brand-panel rounded-xl p-8 text-center text-white">
          <h2 className="text-[22px] font-bold">{locale === 'ko' ? '직접 경험해보세요' : 'Experience it yourself'}</h2>
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
