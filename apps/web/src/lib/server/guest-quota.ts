/**
 * 비회원 월 글자수 한도 (core.md §3-6 — 분은 곧 돈이다).
 * 체험 1회는 TRIAL_CHAR_LIMIT, 한 달 누적은 GUEST_MONTHLY_CHAR_LIMIT를 넘지 못한다.
 *
 * ⚠ 서버리스 인스턴스별 in-memory라 정확하지 않다(인스턴스가 여러 개면 그만큼 여유가 생긴다).
 * 정확한 집계가 필요해지면 Firestore 카운터로 교체한다 — 인터페이스는 그대로 둔다.
 */
import { GUEST_MONTHLY_CHAR_LIMIT, TRIAL_CHAR_LIMIT } from '@sotong/shared/constants';

interface Bucket {
  month: string; // 'YYYY-MM'
  chars: number;
}

const g = globalThis as typeof globalThis & {
  __interliveGuestQuota?: Map<string, Bucket>;
};
const buckets = (g.__interliveGuestQuota ??= new Map<string, Bucket>());

const currentMonth = () => new Date().toISOString().slice(0, 7);

export function guestKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

/** 이번 달 남은 글자수 */
export function remainingChars(key: string): number {
  const b = buckets.get(key);
  if (!b || b.month !== currentMonth()) return GUEST_MONTHLY_CHAR_LIMIT;
  return Math.max(0, GUEST_MONTHLY_CHAR_LIMIT - b.chars);
}

/** 이번 체험에 허용할 글자수 = min(세션 한도, 월 잔여). 0이면 시작 불가 */
export function grantCharBudget(key: string): number {
  return Math.min(TRIAL_CHAR_LIMIT, remainingChars(key));
}

/** 실제 사용한 글자수를 누적한다 (하트비트에서 호출) */
export function consumeChars(key: string, chars: number): void {
  if (chars <= 0) return;
  const month = currentMonth();
  const b = buckets.get(key);
  if (!b || b.month !== month) {
    buckets.set(key, { month, chars });
  } else {
    b.chars += chars;
  }

  // 지난 달 항목 청소 — 맵이 무한히 자라지 않게
  if (buckets.size > 5_000) {
    for (const [k, v] of buckets) {
      if (v.month !== month) buckets.delete(k);
    }
  }
}
