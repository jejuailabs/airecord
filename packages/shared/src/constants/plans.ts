/**
 * 요금제 정의 — ⚠ 가격은 docs/07 §4의 가설이다. 시장 검증 전까지 사실로 취급하지 말 것.
 *
 * 원가 근거 (docs/07 §2, 2026-07-26 조사값 기준):
 *   모드 B(대면) 실효 원가 ≈ ₩52/분, 혼합(대면60/화상40) ≈ ₩58/분
 * 방어선 (docs/07 §4.2): 어떤 플랜이든 "포함분 100% 소진 + 전량 모드 A" 시나리오에서 GM 50% 이상.
 *
 * 마진 검증 (혼합 ₩58/분):
 *   starter  ₩14,900 / 100분  → 원가 ₩5,800  → GM 61.1%  ✅
 *   pro      ₩39,900 / 300분  → 원가 ₩17,400 → GM 56.4%  ✅
 *   business ₩199,000 / 1,500분 → 원가 ₩87,000 → GM 56.3% ✅ (docs/07 §4.2와 동일)
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
  maxMembers: number | null; // null = 무제한
}

export const PLANS: readonly PlanDef[] = [
  {
    id: 'free',
    audience: 'personal',
    monthlyKrw: 0,
    cycle: 'monthly',
    includedMinutes: 30,
    overageKrwPerMin: null,
    retentionDays: 7,
    meetingMode: false,
    maxMembers: 1,
  },
  {
    id: 'starter',
    audience: 'personal',
    monthlyKrw: 14_900,
    cycle: 'monthly',
    includedMinutes: 100,
    overageKrwPerMin: null,
    retentionDays: 30,
    meetingMode: false,
    maxMembers: 1,
  },
  {
    id: 'pro',
    audience: 'personal',
    // 회의 모드 원가(₩65/분) × 300분 × 2.5배 방어선 (docs/07). 마주 전량은 예외 — 아래 주석 참고.
    monthlyKrw: 49_000,
    cycle: 'monthly',
    includedMinutes: 300,
    overageKrwPerMin: 150,
    retentionDays: 90,
    meetingMode: true,
    maxMembers: 1,
  },
  {
    id: 'business',
    audience: 'business',
    // 기업은 회의 모드 비중이 크다 — 회의 원가(₩65/분) × 1500분 × 2.5배 방어선 (docs/07).
    monthlyKrw: 249_000,
    cycle: 'monthly',
    includedMinutes: 1_500,
    overageKrwPerMin: 130,
    retentionDays: 365,
    meetingMode: true,
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
