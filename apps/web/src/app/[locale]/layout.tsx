import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { AppHeader } from '@/components/AppHeader';
import '../globals.css';

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
  return { title: t('appName') };
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
        <NextIntlClientProvider messages={messages}>
          <AppHeader />
          <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6">{children}</main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
