/**
 * docs/04 §1 — 번역 코어 추상화.
 * 이 디렉터리만 번역 모델 벤더를 안다. apps/web·apps/worker는 getEngine()만 부른다.
 */
import type { LangCode, SourceLangSetting } from '../types';

export interface EngineSegment {
  seq: number;
  startMs: number;
  endMs?: number;
  sourceText: string;
  targetText: string;
  isFinal: boolean;
  speaker?: string;
  /** auto 모드에서 엔진이 감지한 발화 언어 (없을 수 있음) */
  detectedLang?: string;
  /**
   * 발화 언어가 표시 언어와 같아 번역이 생성되지 않은 자막.
   * 이 경우 targetText에 원문을 그대로 넣는다 (화면에서 발화가 사라지지 않도록).
   */
  sameAsTarget?: boolean;
  /**
   * 통역 모델이 끝내 번역을 보내지 않아 텍스트 번역 엔진으로 메운 자막.
   * (입력이 문장 도중 끊기면 마지막 발화의 번역이 오지 않는다 — 실측 2026-07)
   */
  recovered?: boolean;
}

export interface EngineError {
  code: string;
  message: string;
  /** true면 재연결로 복구 불가 — 세션을 접어야 한다 */
  fatal: boolean;
}

export interface TranslationSession {
  /** PCM16 오디오 청크 전송 (서버 릴레이 경로 — 모드 A) */
  pushAudio(chunk: ArrayBuffer): void;
  /** 세그먼트 스트림 구독 */
  onSegment(cb: (s: EngineSegment) => void): void;
  /** 번역 오디오 수신 (옵션 채널) */
  onAudio?(cb: (chunk: ArrayBuffer) => void): void;
  onError(cb: (e: EngineError) => void): void;
  close(): Promise<void>;
  readonly provider: 'openai' | 'google';
  readonly model: string;
}

export interface OpenOpts {
  sourceLang: SourceLangSetting;
  targetLang: LangCode;
  audioOut: boolean;
  sessionId: string;
}

/** 언어 코드 → 문자 종류. 원문이 표시 언어와 같은 문자인지 판단할 때 쓴다. */
export function scriptOfLang(lang: string): string {
  switch (lang) {
    case 'ko':
      return 'KO';
    case 'ja':
      return 'JA';
    case 'zh':
      return 'ZH';
    case 'ru':
      return 'RU';
    case 'ar':
      return 'AR';
    case 'th':
      return 'TH';
    case 'hi':
      return 'HI';
    default:
      return 'ABC'; // 라틴 문자권 (en, es, fr, de, pt, it, id, vi …)
  }
}

export interface EphemeralGrant {
  key: string;
  /** 표시 언어 — 조립기가 "번역 없음" 판정에 쓴다 */
  targetLang?: string;
  /** epoch ms */
  expiresAt: number;
  /** 브라우저가 직결에 쓸 정보 — 벤더 세부는 어댑터가 채운다 */
  model: string;
  provider: 'openai' | 'google';
  /** WebRTC SDP 교환 엔드포인트 (벤더별) */
  callUrl: string;
}

export interface TranslationEngine {
  /** 서버가 직접 스트림을 릴레이 (모드 A) */
  openServerSession(opts: OpenOpts): Promise<TranslationSession>;
  /** 브라우저 직결용 단명 토큰 발급 (모드 B) */
  mintEphemeralKey(opts: OpenOpts): Promise<EphemeralGrant>;
  supports(source: SourceLangSetting, target: LangCode): boolean;
  readonly provider: 'openai' | 'google';
  readonly capabilities: {
    audioOut: boolean;
    browserDirect: boolean;      // WebRTC 직결 가능 여부
    autoDetectSource: boolean;   // 소스 언어 자동 감지 지원
    maxSessionSec: number;
  };
}

/**
 * 통역 지시문 — 소스 언어 auto면 다국어 혼합 발화를 전제로 쓴다.
 * 유저 요구사항: 최대 3개 언어가 섞여도 목적 언어 하나로 통역.
 */
export function buildInterpreterInstructions(
  source: SourceLangSetting,
  target: LangCode,
  targetLabel: string,
): string {
  const sourceClause =
    source === 'auto'
      ? 'Speakers may switch between multiple languages (possibly 2–3 different languages) within the same conversation. Detect the language of each utterance automatically.'
      : `The speakers talk in "${source}".`;
  return [
    'You are a professional simultaneous interpreter.',
    sourceClause,
    `Translate every utterance into ${targetLabel} (${target}).`,
    `If an utterance is already in ${targetLabel}, repeat it verbatim.`,
    'Output ONLY the translation. Never answer questions, never add commentary, never explain.',
    'Keep names, numbers, and technical terms accurate.',
    'Translate incrementally with low latency; prefer short complete sentences.',
  ].join(' ');
}
