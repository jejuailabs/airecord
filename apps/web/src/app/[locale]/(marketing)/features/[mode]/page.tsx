import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { JsonLd } from '@/components/seo/JsonLd';
import { jsonLdSoftwareApplication, jsonLdFaqPage, jsonLdBreadcrumbList } from '@/lib/seo/jsonld';
import {
  Mic,
  Radio,
  UsersRound,
  Video,
  MonitorPlay,
  Type,
  FileText,
  FileCode2,
  FileType,
  FileType2,
  CheckCircle2,
} from 'lucide-react';

const INTERP_MODES = ['live', 'conversation', 'faceoff', 'meeting', 'viewer'] as const;
const TRANS_MODES = [
  'text-translation',
  'file-translation',
  'pdf-translation',
  'docx-translation',
  'hwpx-translation',
] as const;

const VALID_MODES = [...INTERP_MODES, ...TRANS_MODES] as const;
type Mode = (typeof VALID_MODES)[number];

const MODE_ICONS: Record<Mode, React.ElementType> = {
  live: Mic,
  conversation: Radio,
  faceoff: UsersRound,
  meeting: Video,
  viewer: MonitorPlay,
  'text-translation': Type,
  'file-translation': FileText,
  'pdf-translation': FileCode2,
  'docx-translation': FileType,
  'hwpx-translation': FileType2,
};

const MODE_COLORS: Record<Mode, string> = {
  live: 'text-teal-600 bg-teal-50 dark:bg-teal-950/40 dark:text-teal-400',
  conversation: 'text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-400',
  faceoff: 'text-purple-600 bg-purple-50 dark:bg-purple-950/40 dark:text-purple-400',
  meeting: 'text-orange-600 bg-orange-50 dark:bg-orange-950/40 dark:text-orange-400',
  viewer: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400',
  'text-translation': 'text-sky-600 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-400',
  'file-translation': 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-400',
  'pdf-translation': 'text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-400',
  'docx-translation': 'text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-400',
  'hwpx-translation': 'text-teal-600 bg-teal-50 dark:bg-teal-950/40 dark:text-teal-400',
};

const TRANS_KEY: Record<string, string> = {
  'text-translation': 'textTranslation',
  'file-translation': 'fileTranslation',
  'pdf-translation': 'pdfTranslation',
  'docx-translation': 'docxTranslation',
  'hwpx-translation': 'hwpxTranslation',
};

function isTranslation(m: Mode): boolean {
  return (TRANS_MODES as readonly string[]).includes(m);
}

export function generateStaticParams() {
  return VALID_MODES.flatMap((mode) => [
    { locale: 'ko', mode },
    { locale: 'en', mode },
  ]);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; mode: string }>;
}): Promise<Metadata> {
  const { locale, mode } = await params;
  if (!(VALID_MODES as readonly string[]).includes(mode)) return {};

  const m = mode as Mode;

  if (isTranslation(m)) {
    const key = TRANS_KEY[m];
    const t = await getTranslations({ locale, namespace: 'featureC2' });
    return {
      title: t(`${key}.meta.title`),
      description: t(`${key}.meta.description`),
      alternates: {
        canonical: `/${locale}/features/${mode}`,
        languages: {
          ko: `/ko/features/${mode}`,
          en: `/en/features/${mode}`,
          'x-default': `/ko/features/${mode}`,
        },
      },
    };
  }

  const t = await getTranslations({ locale, namespace: 'featureC1' });
  return {
    title: t(`${m}.meta.title`),
    description: t(`${m}.meta.description`),
    alternates: {
      canonical: `/${locale}/features/${mode}`,
      languages: {
        ko: `/ko/features/${mode}`,
        en: `/en/features/${mode}`,
        'x-default': `/ko/features/${mode}`,
      },
    },
  };
}

export default async function FeatureModePage({
  params,
}: {
  params: Promise<{ locale: string; mode: string }>;
}) {
  const { locale, mode } = await params;
  if (!(VALID_MODES as readonly string[]).includes(mode)) notFound();
  setRequestLocale(locale);

  const m = mode as Mode;
  const Icon = MODE_ICONS[m];

  /* ── Translation mode ── */
  if (isTranslation(m)) {
    const key = TRANS_KEY[m];
    const t = await getTranslations({ locale, namespace: 'featureC2' });
    const tHub = await getTranslations({ locale, namespace: 'featureC2' });

    const faqItems = (t.raw(`${key}.faq.items`) as { q: string; a: string }[]).map((item) => ({
      question: item.q,
      answer: item.a,
    }));
    const features = t.raw(`${key}.features`) as { title: string; desc: string }[];
    const hubHref = `/${locale}/features/translation`;
    const hubLabel = locale === 'ko' ? 'AI 번역' : 'AI Translation';
    const relatedModes = TRANS_MODES.filter((v) => v !== m);

    return (
      <>
        <JsonLd data={jsonLdSoftwareApplication(locale)} />
        <JsonLd data={jsonLdFaqPage(faqItems)} />
        <JsonLd
          data={jsonLdBreadcrumbList([
            { name: 'InterLive', href: `/${locale}` },
            { name: hubLabel, href: hubHref },
            { name: t(`${key}.hero.eyebrow`), href: `/${locale}/features/${m}` },
          ])}
        />

        <div className="mx-auto max-w-4xl space-y-16 py-8">
          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-xl ${MODE_COLORS[m]}`}
              >
                <Icon size={22} aria-hidden />
              </span>
              <span className="inline-block rounded-full bg-accent/10 px-3 py-1 text-[12px] font-semibold text-accent">
                {t(`${key}.hero.eyebrow`)}
              </span>
            </div>
            <h1 className="text-[36px] font-bold leading-tight tracking-tight text-text">
              {t(`${key}.hero.title`)}
            </h1>
            <p className="max-w-2xl text-[16px] leading-relaxed text-text-muted">
              {t(`${key}.hero.subtitle`)}
            </p>
            <div className="flex gap-3 pt-2">
              <Link
                href="/try"
                className="rounded-lg bg-accent px-5 py-2 text-[14px] font-semibold text-white hover:bg-accent/90"
              >
                {tHub('hub.common.startFree')}
              </Link>
              <Link
                href="/features/translation"
                className="rounded-lg border border-border px-5 py-2 text-[14px] font-semibold text-text hover:bg-bg-hover"
              >
                {locale === 'ko' ? '번역 유형 전체 보기' : 'All translation types'}
              </Link>
            </div>
          </section>

          <section className="rounded-xl border border-accent/20 bg-accent/5 p-6">
            <h2 className="mb-2 text-[15px] font-bold text-accent">
              {t(`${key}.definition.title`)}
            </h2>
            <p className="text-[14px] leading-relaxed text-text-muted">
              {t(`${key}.definition.body`)}
            </p>
          </section>

          <section className="space-y-5">
            <h2 className="text-[22px] font-bold text-text">
              {locale === 'ko' ? '주요 기능' : 'Key features'}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {features.map((f, i) => (
                <div
                  key={i}
                  className="flex gap-4 rounded-xl border border-border bg-bg-card p-5"
                >
                  <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                  <div>
                    <div className="font-semibold text-text">{f.title}</div>
                    <div className="mt-1 text-[13px] leading-snug text-text-muted">{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-5">
            <h2 className="text-[22px] font-bold text-text">{t(`${key}.faq.title`)}</h2>
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

          <section className="space-y-4">
            <h2 className="text-[18px] font-bold text-text">
              {locale === 'ko' ? '다른 번역 유형' : 'Other translation types'}
            </h2>
            <div className="flex flex-wrap gap-2">
              {relatedModes.map((v) => {
                const RelIcon = MODE_ICONS[v];
                const relKey = TRANS_KEY[v];
                return (
                  <Link
                    key={v}
                    href={`/features/${v}`}
                    className={`flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-[13px] font-semibold transition-colors hover:border-accent/40 hover:bg-bg-hover ${MODE_COLORS[v]}`}
                  >
                    <RelIcon size={14} aria-hidden />
                    {t(`${relKey}.hero.eyebrow`)}
                  </Link>
                );
              })}
            </div>
          </section>

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
                {tHub('hub.common.startFree')}
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

  /* ── Interpretation mode ── */
  const t = await getTranslations({ locale, namespace: 'featureC1' });
  const tHub = await getTranslations({ locale, namespace: 'featuresHub' });

  const faqItems = (t.raw(`${m}.faq.items`) as { q: string; a: string }[]).map((item) => ({
    question: item.q,
    answer: item.a,
  }));
  const features = t.raw(`${m}.features`) as { title: string; desc: string }[];

  return (
    <>
      <JsonLd data={jsonLdSoftwareApplication(locale)} />
      <JsonLd data={jsonLdFaqPage(faqItems)} />
      <JsonLd
        data={jsonLdBreadcrumbList([
          { name: 'InterLive', href: `/${locale}` },
          { name: tHub('hero.title'), href: `/${locale}/features` },
          { name: t(`${m}.hero.eyebrow`), href: `/${locale}/features/${m}` },
        ])}
      />

      <div className="mx-auto max-w-4xl space-y-16 py-8">
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <span
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${MODE_COLORS[m]}`}
            >
              <Icon size={22} aria-hidden />
            </span>
            <span className="inline-block rounded-full bg-accent/10 px-3 py-1 text-[12px] font-semibold text-accent">
              {t(`${m}.hero.eyebrow`)}
            </span>
          </div>
          <h1 className="text-[36px] font-bold leading-tight tracking-tight text-text">
            {t(`${m}.hero.title`)}
          </h1>
          <p className="max-w-2xl text-[16px] leading-relaxed text-text-muted">
            {t(`${m}.hero.subtitle`)}
          </p>
          <div className="flex gap-3 pt-2">
            <Link
              href="/try"
              className="rounded-lg bg-accent px-5 py-2 text-[14px] font-semibold text-white hover:bg-accent/90"
            >
              {tHub('common.startFree')}
            </Link>
            <Link
              href="/features"
              className="rounded-lg border border-border px-5 py-2 text-[14px] font-semibold text-text hover:bg-bg-hover"
            >
              {locale === 'ko' ? '모든 모드 보기' : 'All modes'}
            </Link>
          </div>
        </section>

        <section className="rounded-xl border border-accent/20 bg-accent/5 p-6">
          <h2 className="mb-2 text-[15px] font-bold text-accent">
            {t(`${m}.definition.title`)}
          </h2>
          <p className="text-[14px] leading-relaxed text-text-muted">
            {t(`${m}.definition.body`)}
          </p>
        </section>

        <section className="space-y-5">
          <h2 className="text-[22px] font-bold text-text">
            {locale === 'ko' ? '주요 기능' : 'Key features'}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {features.map((f, i) => (
              <div
                key={i}
                className="flex gap-4 rounded-xl border border-border bg-bg-card p-5"
              >
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                <div>
                  <div className="font-semibold text-text">{f.title}</div>
                  <div className="mt-1 text-[13px] leading-snug text-text-muted">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-5">
          <h2 className="text-[22px] font-bold text-text">{t(`${m}.faq.title`)}</h2>
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

        <section className="space-y-4">
          <h2 className="text-[18px] font-bold text-text">
            {locale === 'ko' ? '다른 통역 모드' : 'Other interpretation modes'}
          </h2>
          <div className="flex flex-wrap gap-2">
            {INTERP_MODES.filter((v) => v !== m && v !== 'viewer').map((v) => {
              const RelIcon = MODE_ICONS[v];
              return (
                <Link
                  key={v}
                  href={`/features/${v}`}
                  className={`flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-[13px] font-semibold transition-colors hover:border-accent/40 hover:bg-bg-hover ${MODE_COLORS[v]}`}
                >
                  <RelIcon size={14} aria-hidden />
                  {tHub(`modes.${v}.name`)}
                </Link>
              );
            })}
          </div>
        </section>

        <section className="brand-panel rounded-xl p-8 text-center text-white">
          <h2 className="text-[22px] font-bold">
            {locale === 'ko' ? '지금 바로 시작하세요' : 'Start interpreting now'}
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
              {tHub('common.startFree')}
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
