import { setRequestLocale } from 'next-intl/server';
import { TextTranslator } from '@/components/translate/TextTranslator';

export default async function TranslatePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <TextTranslator />;
}
