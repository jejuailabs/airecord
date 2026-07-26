/**
 * 원가 계산 (docs/07 §2).
 * 단가는 하드코딩 금지 — 환경변수(COST_*)로 주입한다 (core.md §3-7).
 * 세션 종료 시 rateSnapshot을 통째로 저장한다 — 단가가 바뀌어도 과거 마진을 재계산할 수 있어야 한다.
 */
import type { SessionMode } from '../types';

export interface CostRates {
  translateUsdPerMin: number;   // env COST_TRANSLATE_USD_PER_MIN
  botUsdPerMin: number;         // env COST_BOT_USD_PER_MIN
  infraOverheadPct: number;     // 실측 전 보수적 가정 0.10
  usdKrw: number;               // env USD_KRW_RATE — ⚠ 확정 아님, 운영 시 실환율로 갱신
}

export function ratesFromEnv(env: Record<string, string | undefined>): CostRates {
  return {
    // 기본값 출처: docs/07 §1 (2026-07-26 조사값)
    translateUsdPerMin: Number(env.COST_TRANSLATE_USD_PER_MIN ?? 0.034),
    botUsdPerMin: Number(env.COST_BOT_USD_PER_MIN ?? 0.008333),
    infraOverheadPct: Number(env.COST_INFRA_OVERHEAD_PCT ?? 0.1),
    usdKrw: Number(env.USD_KRW_RATE ?? 1400),
  };
}

export function costOfSession(mode: SessionMode, billedSeconds: number, r: CostRates) {
  const minutes = billedSeconds / 60;
  const translateUsd = minutes * r.translateUsdPerMin;
  const botUsd = mode === 'meeting' ? minutes * r.botUsdPerMin : 0;
  const base = translateUsd + botUsd;
  const totalUsd = base * (1 + r.infraOverheadPct);
  return {
    translateUsd,
    botUsd,
    totalUsd,
    totalKrw: totalUsd * r.usdKrw,
    rateSnapshot: {
      translatePerMin: r.translateUsdPerMin,
      botPerMin: r.botUsdPerMin,
      usdKrw: r.usdKrw,
    },
  };
}

/** 과금 규칙: 초 단위로 세고, 세션당 올림하여 분 단위 청구 (docs/07 §5.2) */
export function billedMinutes(billedSeconds: number): number {
  return Math.ceil(billedSeconds / 60);
}
