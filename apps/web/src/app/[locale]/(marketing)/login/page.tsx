import { setRequestLocale, getTranslations } from 'next-intl/server';
import { GoogleLoginButton } from '@/components/auth/GoogleLoginButton';

/** 로그인 — Google 버튼 하나 (docs/06 §1, docs/03 §1: 이메일/비번 미지원) */
export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'login' });

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-6 py-20 text-center">
      <div>
        <h1 className="text-[28px] font-bold">{t('title')}</h1>
        <p className="mt-2 text-sm text-text-muted">{t('subtitle')}</p>
      </div>
      <GoogleLoginButton />
      <p className="text-[13px] text-text-faint">{t('freeNote')}</p>
    </div>
  );
}
