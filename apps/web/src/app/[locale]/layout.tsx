import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { localeAlternates, ogAlternateLocales, ogLocale } from '@/i18n/locale-meta';
import '../globals.css';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://aitr.kr';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'common' });
  const tm = await getTranslations({ locale, namespace: 'marketing' });
  const appName = t('appName');
  const description = tm('meta.description');

  return {
    metadataBase: new URL(BASE_URL),
    title: {
      default: appName,
      template: `%s | ${appName}`,
    },
    description,
    alternates: localeAlternates(locale),
    openGraph: {
      type: 'website',
      siteName: appName,
      title: appName,
      description,
      locale: ogLocale(locale),
      alternateLocale: ogAlternateLocales(locale),
      images: [
        {
          url: '/og-interlive.png',
          width: 1200,
          height: 630,
          alt: appName,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: appName,
      description,
      images: ['/og-interlive.png'],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true },
    },
    // 네이버 서치어드바이저 소유확인. 구글은 DNS TXT로 인증했으므로 태그가 필요 없다.
    verification: {
      other: {
        'naver-site-verification': 'd45cbb7b1b985268429b6a9f14b58b68f1d50141',
      },
    },
  };
}

/**
 * FOUC 방지 — 페인트 전에 documentElement 클래스를 설정한다 (docs/05 §5).
 * 기본값 system, system 판별 불가 시 dark.
 */
const themeInitScript = `
(function () {
  try {
    var t = localStorage.getItem('sotong-theme') || 'system';
    var dark = t === 'dark';
    if (t === 'system') {
      var mq = window.matchMedia('(prefers-color-scheme: light)');
      dark = !mq.matches;
    }
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-screen bg-bg text-text antialiased">
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
