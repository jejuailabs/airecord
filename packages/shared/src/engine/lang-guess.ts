/**
 * 전사된 글자만 보고 언어(=문자 체계)를 가늠한다.
 *
 * 길게 판별하지 않는다 — 필요한 건 "무슨 문자를 쓰는 언어인가"뿐이다.
 * 애매하면 null을 돌려 아무 결정도 하지 않는다(틀린 언어로 확정하는 게 가장 나쁘다).
 *
 * 쓰이는 곳:
 *   · 전사 레그 자동 언어 잠금 (browser-webrtc.ts)
 *   · 마주통역 방향 판정 (faceoff) — 한국어 발화의 결과인지 영어 발화의 결과인지 가른다
 *
 * ⚠ 라틴 문자 언어(영어·스페인어·프랑스어…)는 문자만으로 못 가르므로 'latin'을 돌린다.
 *   마주통역이 "한 면은 한국어, 한 면은 영어"처럼 문자 체계가 다른 쌍이면 이걸로 충분하고,
 *   "영어 ↔ 스페인어"처럼 둘 다 라틴이면 이 함수로는 못 가른다(그 조합은 별도 처리 필요).
 */
export type ScriptLang = 'ko' | 'ja' | 'zh' | 'ru' | 'th' | 'ar' | 'latin';

export function guessScript(text: string): ScriptLang | null {
  const t = text.trim();
  if (t.length < 2) return null;
  if (/[가-힣]/.test(t)) return 'ko';
  if (/[぀-ヿ]/.test(t)) return 'ja';
  if (/[一-鿿]/.test(t)) return 'zh';
  if (/[Ѐ-ӿ]/.test(t)) return 'ru';
  if (/[฀-๿]/.test(t)) return 'th';
  if (/[؀-ۿ]/.test(t)) return 'ar';
  if (/[A-Za-z]/.test(t)) return 'latin';
  return null;
}
