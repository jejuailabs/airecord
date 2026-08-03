import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { JsonLd } from '@/components/seo/JsonLd';
import { jsonLdSoftwareApplication, jsonLdFaqPage, jsonLdBreadcrumbList } from '@/lib/seo/jsonld';
import { Mic, Radio, UsersRound, Video } from 'lucide-react';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'featuresHub' });
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: {
      canonical: `/${locale}/features`,
      languages: { ko: '/ko/features', en: '/en/features', 'x-default': '/ko/features' },
    },
  };
}

const MODE_ICONS = {
  live: Mic,
  conversation: Radio,
  faceoff: UsersRound,
  meeting: Video,
} as const;

const MODE_COLORS = {
  live: 'text-teal-600 bg-teal-50 dark:bg-teal-950/40 dark:text-teal-400',
  conversation: 'text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-400',
  faceoff: 'text-purple-600 bg-purple-50 dark:bg-purple-950/40 dark:text-purple-400',
  meeting: 'text-orange-600 bg-orange-50 dark:bg-orange-950/40 dark:text-orange-400',
} as const;

export default async function FeaturesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'featuresHub' });

  const faqItems = (t.raw('faq.items') as { q: string; a: string }[]).map((item) => ({
    question: item.q,
    answer: item.a,
  }));

  const modes = (['live', 'conversation', 'faceoff', 'meeting'] as const).map((key) => ({
    key,
    name: t(`modes.${key}.name`),
    path: t(`modes.${key}.path`),
    badge: t(`modes.${key}.badge`),
    desc: t(`modes.${key}.desc`),
    direction: t(`modes.${key}.direction`),
    tokenRate: t(`modes.${key}.tokenRate`),
    bestFor: t(`modes.${key}.bestFor`),
  }));

  return (
    <>
      <JsonLd data={jsonLdSoftwareApplication(locale)} />
      <JsonLd data={jsonLdFaqPage(faqItems)} />
      <JsonLd
        data={jsonLdBreadcrumbList([
          { name: 'InterLive', href: `/${locale}` },
          { name: t('hero.title'), href: `/${locale}/features` },
        ])}
      />

      <div className="mx-auto max-w-4xl space-y-16 py-8">
        {/* ── Hero ── */}
        <section className="space-y-4">
          <span className="inline-block rounded-full bg-accent/10 px-3 py-1 text-[12px] font-semibold text-accent">
            {t('hero.eyebrow')}
          </span>
          <h1 className="text-[36px] font-bold leading-tight tracking-tight text-text">
            {t('hero.title')}
          </h1>
          <p className="max-w-2xl text-[16px] leading-relaxed text-text-muted">
            {t('hero.subtitle')}
          </p>
        </section>

        {/* ── Definition block (GEO entity source) ── */}
        <section className="rounded-xl border border-accent/20 bg-accent/5 p-6">
          <h2 className="mb-2 text-[15px] font-bold text-accent">{t('definition.title')}</h2>
          <p className="text-[14px] leading-relaxed text-text-muted">{t('definition.body')}</p>
        </section>

        {/* ── Mode comparison ── */}
        <section className="space-y-5">
          <h2 className="text-[22px] font-bold text-text">{t('modes.title')}</h2>

          {/* Comparison table */}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-[13px]">
              <thead className="bg-bg-sunken">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-text-muted">모드</th>
                  <th className="px-4 py-3 text-left font-semibold text-text-muted">
                    {t('common.directionLabel')}
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-text-muted">
                    {t('common.tokenLabel')}
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-text-muted">
                    {t('common.bestForLabel')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-bg-card">
                {modes.map((mode) => {
                  const Icon = MODE_ICONS[mode.key];
                  return (
                    <tr key={mode.key} className="hover:bg-bg-hover">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`flex h-7 w-7 items-center justify-center rounded-lg ${MODE_COLORS[mode.key]}`}
                          >
                            <Icon size={14} aria-hidden />
                          </span>
                          <Link href={mode.path} className="font-semibold text-text hover:text-accent">
                            {mode.name}
                          </Link>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-text-muted">{mode.direction}</td>
                      <td className="px-4 py-3 font-mono text-text">{mode.tokenRate}</td>
                      <td className="px-4 py-3 text-text-muted">{mode.bestFor}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mode detail cards */}
          <div className="grid gap-4 sm:grid-cols-2">
            {modes.map((mode) => {
              const Icon = MODE_ICONS[mode.key];
              return (
                <Link
                  key={mode.key}
                  href={mode.path}
                  className="group flex flex-col gap-4 rounded-xl border border-border bg-bg-card p-6 transition-colors hover:border-accent/40 hover:bg-bg-hover"
                >
                  <div className="flex items-start justify-between">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-xl ${MODE_COLORS[mode.key]}`}
                    >
                      <Icon size={20} aria-hidden />
                    </div>
                    <span className="rounded-full bg-bg-sunken px-2.5 py-0.5 text-[11px] font-semibold text-text-muted">
                      {mode.badge}
                    </span>
                  </div>
                  <div>
                    <h3 className="font-bold text-text">{mode.name}</h3>
                    <p className="mt-1.5 text-[13px] leading-snug text-text-muted">{mode.desc}</p>
                  </div>
                  <span className="mt-auto text-[12px] font-semibold text-accent">
                    {t('common.learnMore')}
                  </span>
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
            {locale === 'ko' ? '지금 통역을 시작하세요' : 'Start interpreting now'}
          </h2>
          <div className="mt-5 flex justify-center gap-3">
            <Link
              href="/try"
              className="rounded-lg bg-white px-6 py-2.5 text-[14px] font-semibold text-accent"
            >
              {t('common.startFree')}
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
