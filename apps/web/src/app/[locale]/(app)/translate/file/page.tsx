import { setRequestLocale } from 'next-intl/server';
import { FileTranslator } from '@/components/translate/FileTranslator';

export default async function TranslateFilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <FileTranslator />;
}
