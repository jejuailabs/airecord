import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Inbox } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { currentUid, listSessions } from '@/lib/server/sessions-query';
import { SessionList } from '@/components/sessions/SessionList';

export default async function SessionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('sessions');
  const uid = await currentUid();
  // 10개씩 페이지네이션하므로 넉넉히 받아 온다 (클라이언트에서 잘라 보여줌)
  const items = uid ? await listSessions(uid, 200) : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[30px] font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-text-muted">{t('subtitle')}</p>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-bg-raised px-6 py-16 text-center">
          <Inbox size={30} aria-hidden className="text-text-faint" />
          <div className="text-lg font-semibold">{t('emptyTitle')}</div>
          <p className="max-w-md text-text-muted">{t('emptyHint')}</p>
          <Link
            href="/live"
            className="mt-2 flex h-11 items-center rounded-md bg-accent px-6 font-semibold text-accent-text"
          >
            {t('emptyCta')}
          </Link>
        </div>
      ) : (
        <SessionList items={items} locale={locale} />
      )}
    </div>
  );
}
