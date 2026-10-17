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

export type LatinLang = 'en' | 'es' | 'fr' | 'de' | 'pt' | 'it';

/**
 * 라틴 문자 언어를 기능어(관사·전치사·대명사)로 가른다.
 *
 * 'latin'만으로는 스페인어 원문을 영어와 구분하지 못해, 대면 통역에서 스페인어 화자에게
 * 영어로 답하는 문제가 있었다(2026-10-17). 문자 체계 판정을 보완하는 용도다.
 * 확신이 없으면(기능어가 거의 없거나 두 언어가 비슷하면) null — 틀리게 확정하지 않는다.
 */
const LATIN_MARKERS: Record<LatinLang, { words: string[]; chars?: RegExp }> = {
  en: { words: ['the', 'and', 'is', 'are', 'you', 'that', 'this', 'with', 'have', 'was', 'what', 'it', 'of', 'to', 'we', 'they', 'i', 'my', 'be', 'not', 'for', 'do', 'will', 'would', 'about'] },
  es: { words: ['el', 'la', 'los', 'las', 'y', 'es', 'que', 'de', 'en', 'un', 'una', 'por', 'para', 'con', 'no', 'muy', 'pero', 'yo', 'está', 'como', 'del', 'al', 'lo', 'se', 'su', 'hay', 'también', 'sí', 'porque', 'eso'], chars: /[ñ¿¡]/ },
  fr: { words: ['le', 'la', 'les', 'et', 'est', 'que', 'de', 'des', 'un', 'une', 'pour', 'avec', 'pas', 'je', 'vous', 'nous', 'dans', 'sur', 'ce', 'qui', 'il', 'elle', 'mais', 'très', 'du', 'au'], chars: /[çœàèùâêîôûë]/ },
  de: { words: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ich', 'sie', 'wir', 'ein', 'eine', 'mit', 'zu', 'auf', 'für', 'den', 'dem', 'es', 'auch', 'sehr', 'aber', 'von'], chars: /[äöüß]/ },
  pt: { words: ['o', 'a', 'os', 'as', 'e', 'é', 'que', 'de', 'do', 'da', 'em', 'um', 'uma', 'para', 'com', 'não', 'muito', 'mas', 'eu', 'você', 'está', 'no', 'na', 'isso', 'também'], chars: /[ãõ]/ },
  it: { words: ['il', 'la', 'gli', 'le', 'e', 'è', 'che', 'di', 'del', 'della', 'un', 'una', 'per', 'con', 'non', 'molto', 'ma', 'io', 'sono', 'questo', 'anche', 'nel', 'alla'] },
};

export function guessLatinLang(text: string): LatinLang | null {
  if (guessScript(text) !== 'latin') return null;
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  if (words.length < 3) return null;
  const scores = (Object.keys(LATIN_MARKERS) as LatinLang[]).map((lang) => {
    const m = LATIN_MARKERS[lang];
    let score = words.reduce((n, w) => n + (m.words.includes(w) ? 1 : 0), 0);
    if (m.chars?.test(text)) score += 2;
    return { lang, score };
  });
  scores.sort((a, b) => b.score - a.score);
  const [top, second] = scores;
  if (!top || top.score < 2) return null;
  // 1등과 2등이 붙어 있으면 판정하지 않는다
  if (second && top.score - second.score < 1) return null;
  return top.lang;
}
