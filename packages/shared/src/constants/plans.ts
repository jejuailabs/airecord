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
export interface PlanDef {
  id: 'free' | 'starter' | 'pro' | 'business';
  audience: 'personal' | 'business';
  monthlyKrw: number;
  includedMinutes: number;
  /** null이면 초과 사용 불가(차단). 초과 과금은 유저가 명시적으로 켜야 발생 (docs/07 §5.3) */
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
    includedMinutes: 100,
    overageKrwPerMin: null,
    retentionDays: 30,
    meetingMode: false,
    maxMembers: 1,
  },
  {
    id: 'pro',
    audience: 'personal',
    monthlyKrw: 39_900,
    includedMinutes: 300,
    overageKrwPerMin: 150,
    retentionDays: 90,
    meetingMode: true,
    maxMembers: 1,
  },
  {
    id: 'business',
    audience: 'business',
    monthlyKrw: 199_000,
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

/** 방어선 검증 — 새 플랜 추가 시 이 함수로 GM 50% 하한을 확인한다 (docs/07 §4.2) */
export function grossMarginAtFullUsage(plan: PlanDef, blendedCostKrwPerMin: number): number {
  if (plan.monthlyKrw === 0) return 0; // Free는 획득비용으로 간주
  const cost = plan.includedMinutes * blendedCostKrwPerMin;
  return (plan.monthlyKrw - cost) / plan.monthlyKrw;
}

/** 비회원 체험 제한 — 문장(확정 세그먼트) 수 + 시간 이중 캡 */
export const TRIAL_MAX_FINAL_SEGMENTS = 10;
export const TRIAL_MAX_DURATION_SEC_DEFAULT = 120;
