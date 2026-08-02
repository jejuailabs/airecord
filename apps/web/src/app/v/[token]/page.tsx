import { cookies, headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { TRANSLATE_TARGET_LANGS, languageLabel } from '@sotong/shared/constants';
import type { SourceLangSetting } from '@sotong/shared/types';
import { LiveCaptions } from '@/components/viewer/LiveCaptions';
import { ViewerEndButton } from '@/components/viewer/ViewerEndButton';
import { resolveViewerToken } from '@/lib/server/viewer';
import { SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import { getSession } from '@/lib/server/session-store';

/**
 * 뷰어의 시작 표시 언어 (사용자 지시 2026-08-02 — 상대방은 고를 필요 없이 자동).
 *   1. 브라우저 언어가 세션 기본 표시 언어와 같으면 → 그대로 (봇 주인 쪽)
 *   2. 브라우저 언어가 지원 목록에 있으면 → 브라우저 언어 (상대방·제3의 언어 참가자)
 *   3. 그 외 → 수음 언어가 구체적이면 그 언어 (한↔영 회의의 "반대쪽"), 아니면 기본 언어
 */
function pickInitialLang(
  acceptLanguage: string,
  targetLang: string,
  sourceLang: string,
  supported: ReadonlySet<string>,
): string {
  const browserLangs = acceptLanguage
    .split(',')
    .map((s) => s.trim().split(';')[0]?.split('-')[0]?.toLowerCase() ?? '')
    .filter(Boolean);
  for (const b of browserLangs) {
    if (b === targetLang) return targetLang;
    if (supported.has(b)) return b;
  }
  if (sourceLang !== 'auto' && supported.has(sourceLang)) return sourceLang;
  return targetLang;
}

/**
 * 자막 뷰어 (docs/06 §2.4) — 회의 참가자가 링크만으로 들어와 자막을 보는 공개 화면.
 * 로그인 유도 없음. 뷰어 UI 언어는 Accept-Language로 판단한다 (docs/06 §1).
 *
 * 자막은 /api/viewer/{token} 폴링으로 받는다. 클라이언트에 DB 접근권을 주지 않는다 —
 * 토큰 만료·폐기 검증을 서버에서만 하기 위해서다(lib/server/viewer.ts 주석 참고).
 */
export default async function ViewerPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const acceptLanguage = (await headers()).get('accept-language') ?? '';
  const locale = acceptLanguage.toLowerCase().startsWith('ko') ? 'ko' : 'en';
  const t = await getTranslations({ locale, namespace: 'viewer' });
  const tc = await getTranslations({ locale, namespace: 'common' });

  // 토큰이 이상하면 client가 404로 처리하므로 기본값만 둔다
  const grant = await resolveViewerToken(token).catch(() => null);
  const targetLang = grant?.targetLang ?? 'en';
  const sourceLang = grant?.sourceLang ?? 'auto';

  /**
   * 표시 언어 선택지 — 세션의 두 언어를 맨 앞에, 나머지 지원 언어를 뒤에.
   * 세션 언어가 목록에 없어도(이례) 반드시 포함시킨다.
   */
  const langCodes = [
    ...new Set([
      targetLang,
      ...(sourceLang !== 'auto' ? [sourceLang] : []),
      ...TRANSLATE_TARGET_LANGS,
    ]),
  ];
  const langOptions = langCodes.map((code) => ({
    code,
    label: languageLabel(code as SourceLangSetting),
  }));
  const initialLang = pickInitialLang(
    acceptLanguage,
    targetLang,
    sourceLang,
    new Set(langCodes),
  );

  /**
   * 통역 종료 버튼 — **세션 주인에게만** 보인다 (사용자 지시 2026-08-02).
   * 뷰어 링크는 공개라 참가자 누구나 열지만, 같은 브라우저에 주인 로그인이 있으면
   * 여기서 바로 끝낼 수 있게 한다. 종료 API도 서버에서 소유자를 다시 확인한다.
   */
  let isOwner = false;
  if (grant && grant.status !== 'ended') {
    try {
      const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
      const user = await verifySessionCookie(cookie);
      if (user) {
        const record = await getSession(grant.sessionId);
        isOwner = record?.uid === user.uid && record?.status !== 'ended';
      }
    } catch {
      /* 로그인 확인 실패 = 일반 참가자로 취급 */
    }
  }
  const endLabels = {
    end: t('endBtn'),
    confirm: t('endConfirm'),
    ending: t('ending'),
    ended: t('ended'),
  };

  return (
    /**
     * 화면 높이에 고정한다 (h-dvh) — 자막이 쌓여도 **페이지가 아래로 자라지 않는다.**
     * 예전엔 min-h-screen이라 브라우저 전체가 늘어나 상단 메뉴(언어·종료)가
     * 스크롤 위로 사라졌다 (사용자 지적 2026-08-02). 스크롤은 자막 박스 안에서만 흐른다.
     */
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center px-4">
        <span className="flex items-center gap-2 text-sm font-bold tracking-tight">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-accent" />
          {tc('appName')}
        </span>
        {isOwner ? (
          <span className="ml-auto">
            <ViewerEndButton token={token} labels={endLabels} />
          </span>
        ) : null}
      </header>

      <main className="flex min-h-0 flex-1 flex-col p-4">
        <LiveCaptions
          token={token}
          initialLang={initialLang}
          langOptions={langOptions}
          labels={{
            waiting: t('waiting'),
            ended: t('ended'),
            invalid: t('invalidLink'),
            save: t('save'),
            saveName: t('saveName'),
            speakOn: t('speakOn'),
            speakOff: t('speakOff'),
            langLabel: t('displayLang'),
          }}
        />
        {isOwner ? (
          <div className="flex justify-end pt-3">
            <ViewerEndButton token={token} labels={endLabels} />
          </div>
        ) : null}
      </main>

      {/* 첫 진입 고지 배너 (docs/08 §2.2) */}
      <footer className="shrink-0 border-t border-border px-4 py-3 text-center text-[13px] text-text-faint">
        {t('consentNotice')}
      </footer>
    </div>
  );
}
