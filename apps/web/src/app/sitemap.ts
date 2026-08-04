import type { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://aitr.kr';
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

/**
 * ⚠ 실제로 존재하는 페이지만 넣는다.
 *   없는 URL을 넣으면 Search Console에 그대로 크롤링 오류로 쌓이고,
 *   오류가 많은 사이트맵은 색인 자체가 밀린다.
 *   페이지를 새로 만들 때 여기에 같이 추가할 것.
 *   /pricing은 로그인으로 리다이렉트되므로 뺀다(공개되면 다시 넣는다).
 */
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

    // ── C3~C5: 허브 페이지 (하위 상세 페이지는 아직 없다) ──
    ...multiLocale('/technology', { changeFrequency: 'monthly', priority: 0.7 }),
    ...multiLocale('/use-cases', { changeFrequency: 'monthly', priority: 0.7 }),
    ...multiLocale('/guide', { changeFrequency: 'monthly', priority: 0.8 }),

    // ── C7: Glossary ──
    ...multiLocale('/glossary', { changeFrequency: 'weekly', priority: 0.8 }),

    // ── C8: FAQ ──
    ...multiLocale('/faq', { changeFrequency: 'monthly', priority: 0.8 }),
  ];
}
