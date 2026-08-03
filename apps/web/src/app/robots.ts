import type { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://aitr.kr';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: [
          '/ko/',
          '/en/',
          '/ko/about',
          '/en/about',
          '/ko/features',
          '/en/features',
          '/ko/guide',
          '/en/guide',
          '/ko/use-cases',
          '/en/use-cases',
          '/ko/technology',
          '/en/technology',
          '/ko/glossary',
          '/en/glossary',
          '/ko/faq',
          '/en/faq',
          '/ko/pricing',
          '/en/pricing',
          '/ko/try',
          '/en/try',
        ],
        disallow: [
          '/ko/dashboard',
          '/en/dashboard',
          '/ko/live',
          '/en/live',
          '/ko/talk',
          '/en/talk',
          '/ko/faceoff',
          '/en/faceoff',
          '/ko/meeting',
          '/en/meeting',
          '/ko/sessions',
          '/en/sessions',
          '/ko/mypage',
          '/en/mypage',
          '/ko/settings',
          '/en/settings',
          '/ko/admin',
          '/en/admin',
          '/ko/checkout',
          '/en/checkout',
          '/api/',
          '/v/',
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
