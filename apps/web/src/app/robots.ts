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
          '/ko/try',
          '/en/try',
        ],
        // 로그인으로 리다이렉트되는 경로는 크롤링시켜도 로그인 페이지만 보게 된다.
        // /pricing도 현재 인증이 걸려 있어 제외한다 — 공개로 바꾸면 allow로 옮길 것.
        disallow: [
          '/ko/login',
          '/en/login',
          '/ko/pricing',
          '/en/pricing',
          '/ko/translate',
          '/en/translate',
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
