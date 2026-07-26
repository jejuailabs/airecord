/**
 * 랜딩 데모 스크립트 — 3개 언어(한·영·일)가 섞이는 회의를 연출해
 * "입력 언어 자동 감지"가 그 자체로 보이게 한다.
 * UI 문자열이 아니라 데모 콘텐츠(대화 샘플)이므로 i18n 대상이 아니다.
 */
export interface DemoLine {
  speaker: string;
  initial: string;
  srcLang: 'ko' | 'en' | 'ja';
  src: string;
  /** 시청자에게 보여줄 번역 (음성도 이 언어로 재생) */
  tgtLang: 'ko' | 'en';
  tgt: string;
}

export const DEMO_LINES: readonly DemoLine[] = [
  {
    speaker: '김민준',
    initial: 'K',
    srcLang: 'ko',
    src: '이번 분기 매출이 20% 성장했습니다.',
    tgtLang: 'en',
    tgt: 'Our revenue grew 20% this quarter.',
  },
  {
    speaker: 'Sarah',
    initial: 'S',
    srcLang: 'en',
    src: "That's impressive. What drove the growth?",
    tgtLang: 'ko',
    tgt: '인상적이네요. 성장을 이끈 요인이 무엇인가요?',
  },
  {
    speaker: '田中',
    initial: 'T',
    srcLang: 'ja',
    src: '日本市場でも新製品の反応がとても良いです。',
    tgtLang: 'ko',
    tgt: '일본 시장에서도 신제품 반응이 아주 좋습니다.',
  },
  {
    speaker: '김민준',
    initial: 'K',
    srcLang: 'ko',
    src: '다음 분기에는 유럽 진출을 준비하겠습니다.',
    tgtLang: 'en',
    tgt: "Next quarter, we'll prepare to enter the European market.",
  },
] as const;

export const TTS_LANG: Record<DemoLine['tgtLang'], string> = {
  ko: 'ko-KR',
  en: 'en-US',
};
