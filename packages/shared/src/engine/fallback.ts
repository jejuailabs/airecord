/**
 * 폴백 승계 (docs/04 §5) — Phase 4에서 활성화.
 * 1순위 3회 연속 실패 → 지수 백오프(1s, 2s, 4s) → 폴백 엔진으로 새 세션.
 * Phase 1에서는 이 파일을 어디서도 import하지 않는다.
 */
import type { OpenOpts, TranslationEngine, TranslationSession } from './types';

export async function openWithFallback(
  primary: TranslationEngine,
  fallback: TranslationEngine,
  opts: OpenOpts,
  onFellBack?: (at: number) => void,
): Promise<TranslationSession> {
  const delays = [1_000, 2_000, 4_000];
  for (const [i, delay] of delays.entries()) {
    try {
      return await primary.openServerSession(opts);
    } catch {
      if (i < delays.length - 1) await new Promise((r) => setTimeout(r, delay));
    }
  }
  onFellBack?.(Date.now());
  return fallback.openServerSession(opts);
}
