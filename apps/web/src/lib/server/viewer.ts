/**
 * 자막 뷰어 토큰 (docs/03 §2, docs/08 §2.2).
 *
 * 회의 참가자는 로그인 없이 링크만으로 자막을 본다. 그 링크의 유일한 열쇠가 이 토큰이다.
 *
 * ⚠ 검증은 **서버에서만** 한다.
 *   클라이언트에서 Firestore를 직접 읽게 하면 보안 규칙으로 토큰 만료·폐기를 막아야 하는데,
 *   이 저장소에는 규칙 파일이 없다(콘솔에서 관리). 규칙이 어긋난 채 배포되면
 *   만료된 링크로 남의 회의 자막이 열린다 — 그 위험을 감수할 이유가 없다.
 */
import { adminDb } from '@/lib/firebase/admin';

export interface ViewerGrant {
  sessionId: string;
  targetLang: string;
  sourceLang: string;
  /** 'live'면 아직 진행 중 — 뷰어가 계속 물어봐야 한다 */
  status: string;
  /** 아직 확정 전인 "쌓이는 중" 번역 줄 (대면처럼 실시간 스트리밍). 없으면 null */
  livePartial: { text: string; seq: number } | null;
}

export interface ViewerSegment {
  seq: number;
  startMs: number;
  sourceText: string;
  targetText: string;
  kind: string | null;
}

/** 토큰 → 세션. 없거나 만료·폐기됐으면 null (이유를 밖으로 흘리지 않는다) */
export async function resolveViewerToken(token: string): Promise<ViewerGrant | null> {
  if (!/^[a-zA-Z0-9]{16,64}$/.test(token)) return null;
  const snap = await adminDb().collection('viewerTokens').doc(token).get();
  if (!snap.exists) return null;
  const d = snap.data() ?? {};
  if (d.revoked === true) return null;
  if (typeof d.expiresAtMs === 'number' && Date.now() > d.expiresAtMs) return null;
  if (typeof d.sessionId !== 'string') return null;

  const live = await adminDb().collection('liveSessions').doc(d.sessionId).get();
  const ld = live.data() ?? {};
  const lp = ld.livePartial;
  const livePartial =
    lp && typeof lp.text === 'string' && lp.text.trim() && typeof lp.seq === 'number'
      ? { text: lp.text, seq: lp.seq }
      : null;
  return {
    sessionId: d.sessionId,
    sourceLang: typeof ld.sourceLang === 'string' ? ld.sourceLang : 'auto',
    targetLang: typeof ld.targetLang === 'string' ? ld.targetLang : 'en',
    status: typeof ld.status === 'string' ? ld.status : 'live',
    livePartial,
  };
}

/**
 * 새 자막만 읽는다.
 *
 * 문서 id가 seq 6자리 0채움이라 문서 id 순서 = seq 순서다.
 * 그래서 별도 색인 없이 `orderBy(documentId)`로 이어 읽을 수 있다 —
 * 회의 하나에 자막이 수천 줄 쌓여도 매번 전부 읽지 않는다.
 */
export async function readSegmentsAfter(
  sessionId: string,
  afterSeq: number,
  limit = 200,
): Promise<ViewerSegment[]> {
  let q = adminDb()
    .collection('sessions')
    .doc(sessionId)
    .collection('segments')
    .orderBy('seq', 'asc')
    .limit(limit);
  if (afterSeq >= 0) q = q.where('seq', '>', afterSeq);

  const snap = await q.get();
  return snap.docs.map((doc) => {
    const d = doc.data();
    return {
      seq: typeof d.seq === 'number' ? d.seq : 0,
      startMs: typeof d.startMs === 'number' ? d.startMs : 0,
      sourceText: typeof d.sourceText === 'string' ? d.sourceText : '',
      targetText: typeof d.targetText === 'string' ? d.targetText : '',
      kind: typeof d.kind === 'string' ? d.kind : null,
    };
  });
}

/** 회의가 끝나면 링크를 닫는다 — 끝난 회의 링크가 계속 열려 있으면 안 된다 */
export async function revokeViewerToken(sessionId: string): Promise<void> {
  const snap = await adminDb()
    .collection('viewerTokens')
    .where('sessionId', '==', sessionId)
    .limit(5)
    .get();
  if (snap.empty) return;
  const batch = adminDb().batch();
  for (const doc of snap.docs) batch.set(doc.ref, { revoked: true }, { merge: true });
  await batch.commit();
}
