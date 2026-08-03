/**
 * 요금제 정의 — ⚠ 가격은 docs/07 §4의 가설이다. 시장 검증 전까지 사실로 취급하지 말 것.
 *
 * 원가 근거 (docs/07 §2, 2026-07-26 조사값 기준):
 *   모드 B(대면) 실효 원가 ≈ ₩52/분, 혼합(대면60/화상40) ≈ ₩58/분
 * 방어선 (docs/07 §4.2): 어떤 플랜이든 "포함분 100% 소진 + 전량 모드 A" 시나리오에서 GM 50% 이상.
 *
 * 마진 검증 (혼합 ₩58/분):
 *   starter  ₩9,900   / 70분   → 원가 ₩4,060  → GM 59.0%  ✅
 *   pro      ₩26,900  / 200분  → 원가 ₩11,600 → GM 56.9%  ✅
 *   business ₩126,900 / 1,000분 → 원가 ₩58,000 → GM 54.3% ✅
 *
 * 토큰당 단가 — 볼륨 할인 (Starter 기준 5%씩):
 *   starter  ₩141/토큰 (기준)
 *   pro      ₩135/토큰 (-5%)
 *   business ₩127/토큰 (-10%)
 *
 * 텍스트·파일 번역 (gpt-4o-mini / gpt-4o 비전):
 *   원가가 통역의 1/30~1/50 수준이라 Pro 이상은 무제한 무료 제공해도 마진에 영향 없음.
 *   추론이 필요 없는 작업이라 reasoning 없이 돈다 (translate/reasoning.ts 가드).
 */
/**
 * 토큰 표준 — 요금의 단일 단위. **1 토큰 = 일반(대면/대화) 모드 1분.**
 *
 * 왜 토큰인가 (사용자 지시 2026-08-01):
 *   모드마다 원가가 다르다(마주는 통역 세션 2개, 회의는 봇 비용). 이걸 "시간"으로 청구하면
 *   같은 10분이라도 모드에 따라 원가가 달라 계산이 복잡하고 직관에 어긋난다.
 *   대신 "모드별 분당 토큰 소비"를 표준으로 박고, 플랜은 토큰 예산을 준다.
 *   그러면 남은 토큰 하나로 모든 모드를 한 축에서 셀 수 있다.
 *
 *   · 일반(inperson): 1 토큰/분   (10분 = 10토큰)
 *   · 회의(meeting):  1.5 토큰/분 (10분 = 15토큰) — 봇 비용만큼 더
 *   · 마주(faceoff):  2 토큰/분   (10분 = 20토큰) — 통역 세션 2개, 토큰 최다
 */
export const MODE_TOKENS_PER_MIN: Record<'inperson' | 'meeting' | 'faceoff', number> = {
  inperson: 1,
  meeting: 1.5,
  faceoff: 2,
};

/** 이 모드로 billedSeconds만큼 쓰면 소비되는 토큰. 분은 세션당 올림, 모드 배수를 곱한다. */
export function tokensForBilledSeconds(
  mode: 'inperson' | 'meeting' | 'faceoff',
  billedSeconds: number,
): number {
  const minutes = Math.ceil(Math.max(0, billedSeconds) / 60);
  return minutes * (MODE_TOKENS_PER_MIN[mode] ?? 1);
}

/** 남은 토큰으로 이 모드를 몇 초까지 열 수 있는가 (모드 배수로 나눈다). */
export function secondsForTokens(
  mode: 'inperson' | 'meeting' | 'faceoff',
  tokens: number,
): number {
  const rate = MODE_TOKENS_PER_MIN[mode] ?? 1;
  return Math.floor((Math.max(0, tokens) / rate) * 60);
}

/** 연결제 할인율 — 12개월 선납 시 10% 할인 (사용자 지시 2026-08-01). */
export const YEARLY_DISCOUNT = 0.1;

/** 연 결제 금액 (월×12에서 10% 할인, 100원 단위 반올림). Free는 0. */
export function yearlyKrw(monthlyKrw: number): number {
  if (monthlyKrw <= 0) return 0;
  return Math.round((monthlyKrw * 12 * (1 - YEARLY_DISCOUNT)) / 100) * 100;
}

export interface PlanDef {
  id: 'free' | 'starter' | 'pro' | 'business';
  audience: 'personal' | 'business';
  monthlyKrw: number;
  /**
   * 사용량 갱신 주기.
   * 무료는 **월 총량**으로 준다. 예전엔 하루 10분(매일 리셋)이었는데,
   * 매일 다 쓰면 월 300분 = Pro 플랜 사용량이라 무료 한 사용자당 최악 원가가
   * Starter 매출(₩14,900)에 육박했다(실측 ₩14,280). 월 총량으로 바꿔 노출을 10배 낮춘다.
   */
  cycle: 'daily' | 'monthly';
  /**
   * 포함 토큰. **1 토큰 = 일반 모드 1분** (MODE_TOKENS_PER_MIN 참고).
   * 숫자는 예전 '포함 분'과 같다 — 일반 모드만 쓰면 체감이 동일하고,
   * 회의는 1.5배·마주는 2배 빨리 준다. (필드명은 호환을 위해 includedMinutes 유지)
   */
  includedMinutes: number;
  /** null이면 초과 사용 불가(차단). 있으면 초과 토큰당 원. 유저가 명시적으로 켜야 발생 (docs/07 §5.3) */
  overageKrwPerMin: number | null;
  retentionDays: number;
  meetingMode: boolean;   // 모드 A(화상회의 봇)
  unlimitedTranslation: boolean; // 텍스트·파일 번역 무제한 (Pro 이상)
  maxMembers: number | null; // null = 무제한
}

export const PLANS: readonly PlanDef[] = [
  {
    id: 'free',
    audience: 'personal',
    monthlyKrw: 0,
    cycle: 'monthly',
    includedMinutes: 20,
    overageKrwPerMin: null,
    retentionDays: 7,
    meetingMode: false,
    unlimitedTranslation: false,
    maxMembers: 1,
  },
  {
    id: 'starter',
    audience: 'personal',
    monthlyKrw: 9_900,
    cycle: 'monthly',
    includedMinutes: 70,
    overageKrwPerMin: null,
    retentionDays: 30,
    meetingMode: false,
    unlimitedTranslation: false,
    maxMembers: 1,
  },
  {
    id: 'pro',
    audience: 'personal',
    monthlyKrw: 26_900,
    cycle: 'monthly',
    includedMinutes: 200,
    overageKrwPerMin: 150,
    retentionDays: 90,
    meetingMode: true,
    unlimitedTranslation: true,
    maxMembers: 1,
  },
  {
    id: 'business',
    audience: 'business',
    monthlyKrw: 126_900,
    cycle: 'monthly',
    includedMinutes: 1_000,
    overageKrwPerMin: 130,
    retentionDays: 365,
    meetingMode: true,
    unlimitedTranslation: true,
    maxMembers: null,
  },
] as const;

export function getPlan(id: string): PlanDef | undefined {
  return PLANS.find((p) => p.id === id);
}

/**
 * 현재 사용 주기의 키.
 * 이 키가 바뀌면 사용량을 0으로 되돌린다 — 별도 배치 없이 읽는 시점에 갱신한다.
 * 배치에 의존하면 배치가 죽었을 때 유저가 영영 막힌다.
 */
export function cycleKey(cycle: PlanDef['cycle'], now: Date = new Date()): string {
  const iso = now.toISOString();
  return cycle === 'daily' ? iso.slice(0, 10) : iso.slice(0, 7);
}

/** 방어선 검증 — 새 플랜 추가 시 이 함수로 GM 50% 하한을 확인한다 (docs/07 §4.2) */
export function grossMarginAtFullUsage(plan: PlanDef, blendedCostKrwPerMin: number): number {
  if (plan.monthlyKrw === 0) return 0; // Free는 획득비용으로 간주
  const cost = plan.includedMinutes * blendedCostKrwPerMin;
  return (plan.monthlyKrw - cost) / plan.monthlyKrw;
}

// ── 토큰 충전 (구독과 별개의 단발 구매) ────────────────────────────────
/**
 * 충전 팩 — 구독 토큰당 단가보다 ~10% 비싸게 (사용자 지시 2026-08-02).
 * 구독이 항상 유리해야 구독이 기본 선택으로 남는다.
 *
 *   small  ₩158/토큰 (Starter ₩141 +12%)
 *   medium ₩149/토큰 (Pro ₩135 +10%)
 *   large  ₩140/토큰 (Business ₩127 +10%)
 *
 * 충전 토큰은 주기 리셋과 무관하게 이월된다 — 산 것을 날리면 환불 분쟁이 된다.
 * 소비 순서: 구독 포함분 먼저, 충전분은 그 다음 (finalizeSessionDoc 참고).
 */
export interface TopupPack {
  id: 'small' | 'medium' | 'large';
  tokens: number;
  krw: number;
}

export const TOPUP_PACKS: readonly TopupPack[] = [
  { id: 'small', tokens: 50, krw: 7_900 },
  { id: 'medium', tokens: 100, krw: 14_900 },
  { id: 'large', tokens: 200, krw: 27_900 },
] as const;

export function getTopupPack(id: string): TopupPack | undefined {
  return TOPUP_PACKS.find((p) => p.id === id);
}

/**
 * 후불 크레딧 — Pro 이상(초과 단가가 있는 플랜) 전용.
 *
 * 세션 도중 토큰이 소진돼도 회의·통역을 끊지 않고 이만큼 더 쓰게 한다:
 *   일반 60분 · 회의 40분 · 마주 30분 (사용자 요구 30~60분 범위).
 * 초과분은 플랜의 overageKrwPerMin 단가로 미결제 금액(billing.debt*)에 쌓이고,
 * **미결제가 남아 있으면 새 세션을 열 수 없다** (entitlement.canStart).
 */
export const POSTPAID_LIMIT_TOKENS = 60;

/** 이 플랜이 후불 크레딧 대상인가 — 초과 단가가 정의된 플랜(Pro·Business)만 */
export function postpaidEligible(plan: PlanDef | undefined): boolean {
  return plan?.overageKrwPerMin != null;
}

/**
 * 비회원 체험 제한 — 번역된 글자수 기준.
 * 유저에게 "몇 자 남았는지"가 바로 보이고, 우리 원가와도 대략 비례한다.
 */
/** 체험 1회당 번역 글자수 */
export const TRIAL_CHAR_LIMIT = 500;
/** 비회원 월 누적 글자수 (체험을 반복해도 이 선을 넘지 못한다) */
export const GUEST_MONTHLY_CHAR_LIMIT = 2_000;
/** 체험 세션 시간 상한 (글자수와 별개의 안전장치) */
export const TRIAL_MAX_DURATION_SEC_DEFAULT = 120;
