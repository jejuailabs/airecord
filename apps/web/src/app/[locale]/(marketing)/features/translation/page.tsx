import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { JsonLd } from '@/components/seo/JsonLd';
import { jsonLdSoftwareApplication, jsonLdFaqPage, jsonLdBreadcrumbList } from '@/lib/seo/jsonld';
import { Type, FileText, FileCode2, FileType, FileType2 } from 'lucide-react';

const TYPE_ICONS = {
  textTranslation: Type,
  fileTranslation: FileText,
  pdfTranslation: FileCode2,
  docxTranslation: FileType,
  hwpxTranslation: FileType2,
} as const;

const TYPE_COLORS = {
  textTranslation: 'text-sky-600 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-400',
  fileTranslation: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-400',
  pdfTranslation: 'text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-400',
  docxTranslation: 'text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-400',
  hwpxTranslation: 'text-teal-600 bg-teal-50 dark:bg-teal-950/40 dark:text-teal-400',
} as const;

const TYPE_SLUGS: Record<keyof typeof TYPE_ICONS, string> = {
  textTranslation: 'text-translation',
  fileTranslation: 'file-translation',
  pdfTranslation: 'pdf-translation',
  docxTranslation: 'docx-translation',
  hwpxTranslation: 'hwpx-translation',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'featureC2' });
  return {
    title: t('hub.meta.title'),
    description: t('hub.meta.description'),
    alternates: {
      canonical: `/${locale}/features/translation`,
      languages: {
        ko: '/ko/features/translation',
        en: '/en/features/translation',
        'x-default': '/ko/features/translation',
      },
    },
  };
}

export default async function TranslationHubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'featureC2' });

  const faqItems = (t.raw('hub.faq.items') as { q: string; a: string }[]).map((item) => ({
    question: item.q,
    answer: item.a,
  }));

  const typeKeys = Object.keys(TYPE_ICONS) as (keyof typeof TYPE_ICONS)[];

  return (
    <>
      <JsonLd data={jsonLdSoftwareApplication(locale)} />
      <JsonLd data={jsonLdFaqPage(faqItems)} />
      <JsonLd
        data={jsonLdBreadcrumbList([
          { name: 'InterLive', href: `/${locale}` },
          { name: t('hub.hero.eyebrow'), href: `/${locale}/features/translation` },
        ])}
      />

      <div className="mx-auto max-w-4xl space-y-16 py-8">
        {/* ── Hero ── */}
        <section className="space-y-4">
          <span className="inline-block rounded-full bg-accent/10 px-3 py-1 text-[12px] font-semibold text-accent">
            {t('hub.hero.eyebrow')}
          </span>
          <h1 className="text-[36px] font-bold leading-tight tracking-tight text-text">
            {t('hub.hero.title')}
          </h1>
          <p className="max-w-2xl text-[16px] leading-relaxed text-text-muted">
            {t('hub.hero.subtitle')}
          </p>
        </section>

        {/* ── Definition block (GEO entity source) ── */}
        <section className="rounded-xl border border-accent/20 bg-accent/5 p-6">
          <h2 className="mb-2 text-[15px] font-bold text-accent">
            {t('hub.definition.title')}
          </h2>
          <p className="text-[14px] leading-relaxed text-text-muted">{t('hub.definition.body')}</p>
        </section>

        {/* ── Translation types ── */}
        <section className="space-y-5">
          <h2 className="text-[22px] font-bold text-text">{t('hub.types.title')}</h2>

          {/* Comparison table */}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-[13px]">
              <thead className="bg-bg-sunken">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-text-muted">
                    {locale === 'ko' ? '유형' : 'Type'}
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-text-muted">
                    {locale === 'ko' ? '설명' : 'Description'}
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-text-muted">
                    {locale === 'ko' ? '적합한 용도' : 'Best for'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-bg-card">
                {typeKeys.map((key) => {
                  const Icon = TYPE_ICONS[key];
                  return (
                    <tr key={key} className="hover:bg-bg-hover">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`flex h-7 w-7 items-center justify-center rounded-lg ${TYPE_COLORS[key]}`}
                          >
                            <Icon size={14} aria-hidden />
                          </span>
                          <Link
                            href={`/features/${TYPE_SLUGS[key]}`}
                            className="font-semibold text-text hover:text-accent"
                          >
                            {t(`hub.types.${key}.name`)}
                          </Link>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-text-muted">{t(`hub.types.${key}.desc`)}</td>
                      <td className="px-4 py-3 text-text-muted">{t(`hub.types.${key}.bestFor`)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Type detail cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {typeKeys.map((key) => {
              const Icon = TYPE_ICONS[key];
              return (
                <Link
                  key={key}
                  href={`/features/${TYPE_SLUGS[key]}`}
                  className="group flex flex-col gap-4 rounded-xl border border-border bg-bg-card p-5 transition-colors hover:border-accent/40 hover:bg-bg-hover"
                >
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-xl ${TYPE_COLORS[key]}`}
                  >
                    <Icon size={18} aria-hidden />
                  </div>
                  <div>
                    <div className="font-bold text-text">{t(`hub.types.${key}.name`)}</div>
                    <div className="mt-1 text-[12px] leading-snug text-text-muted">
                      {t(`hub.types.${key}.desc`)}
                    </div>
                  </div>
                  <span className="mt-auto text-[12px] font-semibold text-accent">
                    {t('hub.common.learnMore')}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="space-y-5">
          <h2 className="text-[22px] font-bold text-text">{t('hub.faq.title')}</h2>
          <div className="divide-y divide-border rounded-xl border border-border bg-bg-card">
            {faqItems.map((item, i) => (
              <details key={i} className="px-6 py-5">
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
          <h2 className="text-[22px] font-bold">
            {locale === 'ko' ? '지금 문서를 번역해보세요' : 'Translate your document now'}
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
              {t('hub.common.startFree')}
            </Link>
            <Link
              href="/pricing"
              className="rounded-lg border border-white/30 px-6 py-2.5 text-[14px] font-semibold text-white hover:border-white/60"
            >
              {locale === 'ko' ? '요금제 보기' : 'View pricing'}
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
