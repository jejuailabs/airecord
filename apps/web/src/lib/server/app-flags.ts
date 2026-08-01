/**
 * 전역 기능 플래그 (운영 콘솔에서 켜고 끈다).
 *
 * 실험 기능은 코드에 상수로 박지 않고 여기서 토글한다 — 배포 없이 켜고,
 * 문제가 보이면 즉시 끈다. 지금은 '마주 1세션(실험)' 하나뿐이다.
 *
 * 저장 위치: appSettings/flags (문서 하나). 읽기는 자주 하니 캐시 없이 가볍게 읽는다.
 */
import { adminDb } from '@/lib/firebase/admin';

export interface AppFlags {
  /** 마주통역 1세션(턴 방식) 실험 모드 — 켜면 마주 화면에 '1세션' 선택지가 뜬다 */
  faceoffSingle: boolean;
}

export const DEFAULT_FLAGS: AppFlags = {
  faceoffSingle: false,
};

const FLAGS_DOC = ['appSettings', 'flags'] as const;

/** 현재 전역 플래그. 실패해도 서비스가 멈추지 않도록 기본값(전부 off)으로 떨어진다. */
export async function getAppFlags(): Promise<AppFlags> {
  try {
    const snap = await adminDb().collection(FLAGS_DOC[0]).doc(FLAGS_DOC[1]).get();
    if (!snap.exists) return { ...DEFAULT_FLAGS };
    const data = snap.data() ?? {};
    return { faceoffSingle: Boolean(data.faceoffSingle) };
  } catch {
    return { ...DEFAULT_FLAGS };
  }
}

/** 플래그 일부를 갱신한다 (슈퍼관리자 전용 라우트에서만 호출). */
export async function setAppFlags(patch: Partial<AppFlags>): Promise<AppFlags> {
  const clean: Record<string, boolean> = {};
  if (patch.faceoffSingle !== undefined) clean.faceoffSingle = Boolean(patch.faceoffSingle);
  await adminDb().collection(FLAGS_DOC[0]).doc(FLAGS_DOC[1]).set(clean, { merge: true });
  return getAppFlags();
}
