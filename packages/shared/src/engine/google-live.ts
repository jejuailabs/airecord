/**
 * Google Gemini Live 어댑터 — 폴백 엔진 (docs/04 §2).
 *
 * Phase 1에서는 폴백을 구현하지 않는다 (docs/04 §5). 인터페이스만 만들어 두고
 * 1순위 단일 엔진으로 간다. Phase 4에서 활성화한다.
 *
 * ⚠ 구현 시 주의: Google은 오디오 스트림 단위 과금이다. 양방향을 두 스트림으로
 * 구현하면 비용이 2배가 된다 (docs/07 §1.1). 스트림 수를 명시적으로 셀 것.
 */
import type { TranslationEngine } from './types';
import { INTERPRET_LANGUAGES } from '../constants';

const SUPPORTED = new Set<string>(INTERPRET_LANGUAGES.map((l) => l.code));

export const googleLiveEngine: TranslationEngine = {
  provider: 'google',
  capabilities: {
    audioOut: true,
    browserDirect: false, // WebRTC 직결 미지원 가정 — 실측 후 갱신
    autoDetectSource: true,
    maxSessionSec: 7200,
  },
  supports(source, target) {
    return (source === 'auto' || SUPPORTED.has(source)) && SUPPORTED.has(target);
  },
  async mintEphemeralKey() {
    throw new Error('google-live: not implemented until Phase 4 (docs/04 §5)');
  },
  async openServerSession() {
    throw new Error('google-live: not implemented until Phase 4 (docs/04 §5)');
  },
};
