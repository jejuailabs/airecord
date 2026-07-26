import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // /v/[token]은 locale 밖 — 회의 채팅에 뿌려지는 링크는 짧고 언어중립적이어야 한다 (docs/06 §1)
  matcher: ['/((?!api|v|_next|_vercel|.*\\..*).*)'],
};
