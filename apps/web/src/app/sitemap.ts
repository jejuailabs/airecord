import type { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://interlive.vercel.app';
const LOCALES = ['ko', 'en'] as const;

type SitemapEntry = MetadataRoute.Sitemap[number];

function loc(path: string): string {
  return `${BASE_URL}${path}`;
}

function multiLocale(
  path: string,
  opts?: Partial<Omit<SitemapEntry, 'url' | 'alternates'>>,
): SitemapEntry[] {
  return LOCALES.map((locale) => ({
    url: loc(`/${locale}${path}`),
    lastModified: new Date(),
    alternates: {
      languages: Object.fromEntries(LOCALES.map((l) => [l, loc(`/${l}${path}`)])),
    },
    ...opts,
  }));
}

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    // ── Landing & core marketing ──
    ...multiLocale('', { changeFrequency: 'weekly', priority: 1.0 }),
    ...multiLocale('/about', { changeFrequency: 'monthly', priority: 0.9 }),
    ...multiLocale('/try', { changeFrequency: 'monthly', priority: 0.7 }),

    // ── C1: Interpretation features ──
    ...multiLocale('/features', { changeFrequency: 'monthly', priority: 0.9 }),
    ...multiLocale('/features/live', { changeFrequency: 'monthly', priority: 0.8 }),
    ...multiLocale('/features/conversation', { changeFrequency: 'monthly', priority: 0.8 }),
    ...multiLocale('/features/faceoff', { changeFrequency: 'monthly', priority: 0.8 }),
    ...multiLocale('/features/meeting', { changeFrequency: 'monthly', priority: 0.8 }),
    ...multiLocale('/features/viewer', { changeFrequency: 'monthly', priority: 0.7 }),

    // ── C2: Translation features ──
    ...multiLocale('/features/translation', { changeFrequency: 'monthly', priority: 0.8 }),
    ...multiLocale('/features/text-translation', { changeFrequency: 'monthly', priority: 0.8 }),
    ...multiLocale('/features/file-translation', { changeFrequency: 'monthly', priority: 0.8 }),
    ...multiLocale('/features/pdf-translation', { changeFrequency: 'monthly', priority: 0.7 }),
    ...multiLocale('/features/docx-translation', { changeFrequency: 'monthly', priority: 0.7 }),
    ...multiLocale('/features/hwpx-translation', { changeFrequency: 'monthly', priority: 0.7 }),

    // ── C3: Technology ──
    ...multiLocale('/technology', { changeFrequency: 'monthly', priority: 0.7 }),
    ...multiLocale('/technology/speech-recognition', { changeFrequency: 'monthly', priority: 0.6 }),
    ...multiLocale('/technology/realtime-translation', { changeFrequency: 'monthly', priority: 0.6 }),
    ...multiLocale('/technology/ai-voice', { changeFrequency: 'monthly', priority: 0.6 }),
    ...multiLocale('/technology/supported-languages', { changeFrequency: 'monthly', priority: 0.6 }),

    // ── C4: Use cases ──
    ...multiLocale('/use-cases', { changeFrequency: 'monthly', priority: 0.7 }),
    ...multiLocale('/use-cases/business-meeting', { changeFrequency: 'monthly', priority: 0.7 }),
    ...multiLocale('/use-cases/conference', { changeFrequency: 'monthly', priority: 0.7 }),
    ...multiLocale('/use-cases/education', { changeFrequency: 'monthly', priority: 0.6 }),
    ...multiLocale('/use-cases/travel', { changeFrequency: 'monthly', priority: 0.6 }),
    ...multiLocale('/use-cases/customer-service', { changeFrequency: 'monthly', priority: 0.6 }),

    // ── C5: Guide ──
    ...multiLocale('/guide', { changeFrequency: 'monthly', priority: 0.8 }),
    ...multiLocale('/guide/getting-started', { changeFrequency: 'monthly', priority: 0.8 }),
    ...multiLocale('/guide/interpretation', { changeFrequency: 'monthly', priority: 0.7 }),
    ...multiLocale('/guide/meeting-bot', { changeFrequency: 'monthly', priority: 0.7 }),
    ...multiLocale('/guide/file-translation', { changeFrequency: 'monthly', priority: 0.7 }),
    ...multiLocale('/guide/tokens', { changeFrequency: 'monthly', priority: 0.7 }),
    ...multiLocale('/guide/session-records', { changeFrequency: 'monthly', priority: 0.6 }),

    // ── C6: Pricing ──
    ...multiLocale('/pricing', { changeFrequency: 'weekly', priority: 0.8 }),
    ...multiLocale('/pricing/tokens', { changeFrequency: 'monthly', priority: 0.7 }),
    ...multiLocale('/pricing/enterprise', { changeFrequency: 'monthly', priority: 0.7 }),
    ...multiLocale('/pricing/compare', { changeFrequency: 'monthly', priority: 0.7 }),

    // ── C7: Glossary ──
    ...multiLocale('/glossary', { changeFrequency: 'weekly', priority: 0.8 }),

    // ── C8: FAQ ──
    ...multiLocale('/faq', { changeFrequency: 'monthly', priority: 0.8 }),
    ...multiLocale('/faq/interpretation', { changeFrequency: 'monthly', priority: 0.7 }),
    ...multiLocale('/faq/billing', { changeFrequency: 'monthly', priority: 0.7 }),
  ];
}
