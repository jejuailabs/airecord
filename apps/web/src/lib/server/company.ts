/**
 * 회사(Business) 합류 — 코드 발급·검증·시도 잠금 (docs/07 팀 과금 단순화안, 2026-08-02).
 *
 * 모델: Business 결제자(대표)의 워크스페이스가 "회사 지갑"이 된다.
 *   workspaces/{id}.company = { name, nameLower, bizNo } + joinCode.
 *   직원은 회사명 검색(2자 이상, 앞글자 매칭) → 선택 → 코드 입력으로 합류한다.
 *   합류 = users/{uid}.lastWorkspaceId 전환 — 이후 토큰 소비는 회사 지갑에서 (기존 구조 그대로).
 *
 * 보안은 코드가 담당한다: 영문+숫자 6자 이상, 연속 실패 잠금, 대표의 재발급·멤버 제거.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';

/** 대표가 직접 수정할 때 허용하는 형식 — 영문+숫자 6~20자 (사용자 확정 2026-08-02) */
export const JOIN_CODE_RE = /^[A-Za-z0-9]{6,20}$/;

/** 헷갈리는 글자(0/O, 1/I/L) 제외 — 구두·단톡방 전달이 많다 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** 8자리 무작위 코드. 항상 대문자로 저장·비교한다. */
export function generateJoinCode(): string {
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** 연속 실패 잠금 — 코드가 짧아진 만큼 무차별 대입을 여기서 막는다 */
const MAX_FAILS = 5;
const LOCK_MS = 10 * 60_000;

function attemptsRef(uid: string) {
  return adminDb().collection('companyJoinAttempts').doc(uid);
}

/** 지금 시도해도 되는가. 잠겨 있으면 남은 ms를 준다. */
export async function checkJoinLock(uid: string): Promise<{ locked: boolean; remainMs: number }> {
  const snap = await attemptsRef(uid).get();
  const lockUntil = (snap.get('lockUntilMs') as number | undefined) ?? 0;
  const now = Date.now();
  if (lockUntil > now) return { locked: true, remainMs: lockUntil - now };
  return { locked: false, remainMs: 0 };
}

export async function recordJoinFail(uid: string): Promise<void> {
  const ref = attemptsRef(uid);
  const snap = await ref.get();
  const fails = ((snap.get('fails') as number | undefined) ?? 0) + 1;
  await ref.set(
    {
      fails,
      updatedAtMs: Date.now(),
      ...(fails >= MAX_FAILS ? { lockUntilMs: Date.now() + LOCK_MS, fails: 0 } : {}),
    },
    { merge: true },
  );
}

export async function resetJoinFails(uid: string): Promise<void> {
  await attemptsRef(uid).set({ fails: 0, lockUntilMs: 0 }, { merge: true });
}

export interface CompanyInfo {
  name: string;
  bizNo: string;
}

/**
 * 이 유저가 소유한(대표인) 회사 워크스페이스.
 * lastWorkspaceId는 다른 회사에 합류하면 바뀔 수 있으므로 ownerUid로 찾는다.
 */
export async function findOwnedCompanyWorkspace(uid: string) {
  const snap = await adminDb()
    .collection('workspaces')
    .where('ownerUid', '==', uid)
    .limit(5)
    .get();
  return snap.docs.find((d) => d.get('company')) ?? null;
}

/** 회사 지갑 지정 — Business 결제(신청) 시 대표의 개인 워크스페이스에 회사 정보를 붙인다 */
export async function attachCompanyToWorkspace(
  uid: string,
  company: CompanyInfo,
): Promise<{ workspaceId: string; joinCode: string } | null> {
  const db = adminDb();
  const owned = await db.collection('workspaces').where('ownerUid', '==', uid).limit(1).get();
  const ws = owned.docs[0];
  if (!ws) return null;

  // 이미 코드가 있으면 유지한다 — 재결제·플랜 변경 때마다 코드가 바뀌면 안내가 전부 무효가 된다
  const existing = ws.get('joinCode') as string | undefined;
  const joinCode = existing ?? generateJoinCode();
  await ws.ref.set(
    {
      // 사이드바·기록에 회사명이 보이도록 워크스페이스 이름도 회사명으로
      name: company.name,
      company: {
        name: company.name,
        nameLower: company.name.toLowerCase(),
        bizNo: company.bizNo,
        attachedAt: FieldValue.serverTimestamp(),
      },
      joinCode,
    },
    { merge: true },
  );
  return { workspaceId: ws.id, joinCode };
}
