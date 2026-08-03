import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
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
  const appName = t('appName');

  const description =
    locale === 'ko'
      ? 'AI 실시간 통역·번역 서비스. 대면·화상·회의 통역과 PDF·DOCX·한글 파일 번역을 15개 언어로. 무료로 시작하세요.'
      : 'AI real-time interpretation & translation. In-person, video & meeting interpretation plus PDF, DOCX, HWPX file translation in 15 languages. Start free.';

  return {
    metadataBase: new URL(BASE_URL),
    title: {
      default: appName,
      template: `%s | ${appName}`,
    },
    description,
    alternates: {
      canonical: `/${locale}`,
      languages: {
        ko: '/ko',
        en: '/en',
        'x-default': '/ko',
      },
    },
    openGraph: {
      type: 'website',
      siteName: appName,
      title: appName,
      description,
      locale: locale === 'ko' ? 'ko_KR' : 'en_US',
      alternateLocale: locale === 'ko' ? ['en_US'] : ['ko_KR'],
      images: [
        {
          url: '/main_logo.png',
          width: 1536,
          height: 1024,
          alt: appName,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: appName,
      description,
      images: ['/main_logo.png'],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true },
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
