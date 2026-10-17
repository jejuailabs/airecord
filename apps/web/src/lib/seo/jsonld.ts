const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://aitr.kr';

export interface FaqItem {
  question: string;
  answer: string;
}

export interface HowToStep {
  name: string;
  text: string;
  url?: string;
}

export interface BreadcrumbItem {
  name: string;
  href: string;
}

/** description은 호출하는 페이지가 marketing.meta.appDescription으로 넘긴다 */
export function jsonLdSoftwareApplication(locale: string, description: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'InterLive',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: `${BASE_URL}/${locale}`,
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'KRW',
      lowPrice: '0',
      highPrice: '126900',
      offerCount: '4',
    },
    description,
    inLanguage: locale,
  };
}

export function jsonLdOrganization() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'InterLive',
    url: BASE_URL,
    sameAs: [],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      availableLanguage: ['Korean', 'English'],
    },
  };
}

export function jsonLdFaqPage(items: FaqItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}

export function jsonLdBreadcrumbList(items: BreadcrumbItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: `${BASE_URL}${item.href}`,
    })),
  };
}

export function jsonLdHowTo(name: string, description: string, steps: HowToStep[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name,
    description,
    step: steps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: s.name,
      text: s.text,
      ...(s.url ? { url: `${BASE_URL}${s.url}` } : {}),
    })),
  };
}

export function jsonLdDefinedTerm(name: string, description: string, locale: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'DefinedTerm',
    name,
    description,
    inDefinedTermSet: `${BASE_URL}/${locale}/glossary`,
  };
}

export function jsonLdArticle(
  headline: string,
  description: string,
  url: string,
  locale: string,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline,
    description,
    url: `${BASE_URL}${url}`,
    inLanguage: locale,
    publisher: {
      '@type': 'Organization',
      name: 'InterLive',
      url: BASE_URL,
    },
  };
}
