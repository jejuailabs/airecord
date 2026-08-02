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
import { translateParagraphs } from '@sotong/shared/translate';
import type { LangCode } from '@sotong/shared/types';

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

// ── 뷰어별 표시 언어 (사용자 지시 2026-08-02) ─────────────────────────
/**
 * 봇을 보낸 쪽이 고른 표시 언어(세션 targetLang)와 다른 언어로 보는 참가자에게는
 * **확정 자막을 재번역**해 준다. 실시간 세션을 하나 더 열지 않는다 — 이미 나온
 * 글자를 gpt-4o-mini로 다시 번역하는 것이라 원가가 사실상 0이고, 원음은 어차피
 * 줌에서 들리므로 1~2초 지연이 허용된다 (마주통역과 달리 음성이 주가 아니다).
 *
 * 번역 결과는 세그먼트 문서의 `alt.{lang}`에 캐시한다 — 같은 언어로 보는
 * 참가자가 몇 명이든, 폴링이 몇 번이든 언어당 한 번만 과금된다.
 */
/** 한 폴링에서 재번역까지 마치는 줄 수 — 입장 직후 백로그는 다음 폴링이 이어받는다 */
const ALT_BATCH_LIMIT = 50;
/** 재번역 한 호출에 보내는 본문 길이 상한 (translate/document.ts CHUNK_CHARS와 같은 감각) */
const ALT_CHUNK_CHARS = 2_600;

export async function readSegmentsAfterInLang(
  sessionId: string,
  afterSeq: number,
  lang: LangCode,
  /** 세션의 기본 표시 언어 — 재번역의 원문 언어 힌트로 쓴다 */
  primaryLang: string,
): Promise<ViewerSegment[]> {
  let q = adminDb()
    .collection('sessions')
    .doc(sessionId)
    .collection('segments')
    .orderBy('seq', 'asc')
    .limit(ALT_BATCH_LIMIT);
  if (afterSeq >= 0) q = q.where('seq', '>', afterSeq);
  const snap = await q.get();

  const out: ViewerSegment[] = [];
  const need: Array<{ n: number; text: string; ref: FirebaseFirestore.DocumentReference }> = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    const seg: ViewerSegment = {
      seq: typeof d.seq === 'number' ? d.seq : 0,
      startMs: typeof d.startMs === 'number' ? d.startMs : 0,
      sourceText: typeof d.sourceText === 'string' ? d.sourceText : '',
      targetText: typeof d.targetText === 'string' ? d.targetText : '',
      kind: typeof d.kind === 'string' ? d.kind : null,
    };
    /**
     * 번역의 원본:
     *   · 번역 줄이 있으면 그걸 다시 번역한다 (기본 표시 언어 → 뷰어 언어)
     *   · **원문만 있는 줄은 원문에서 직접 번역한다** — 발화 언어와 세션 표시 언어가
     *     같으면(예: 영어 회의 + 표시 English) 번역 줄이 거의 없어서, 이걸 건너뛰면
     *     뷰어가 다른 언어를 골라도 화면이 원문 그대로 남는다 (실사용 확인 2026-08-02).
     * 원문(sourceText) 표시는 어느 쪽이든 말한 그대로 둔다.
     */
    const basis = seg.targetText.trim() || seg.sourceText.trim();
    if (basis) {
      const cached = (d.alt as Record<string, string> | undefined)?.[lang];
      if (typeof cached === 'string') {
        // 원문과 같은 번역(이미 뷰어 언어인 발화)은 빈 번역으로 둬 같은 말이 두 번 보이지 않게 한다
        if (cached !== seg.sourceText.trim() || seg.targetText.trim()) seg.targetText = cached;
      } else {
        need.push({ n: seg.seq, text: basis, ref: doc.ref });
      }
    }
    out.push(seg);
  }

  if (need.length > 0) {
    const bySeq = new Map<number, string>();
    // 문단 번호 대응 번역 — 순서·개수가 어긋날 수 없다 (translate/text.ts의 원칙)
    for (let i = 0; i < need.length; ) {
      const group: typeof need = [];
      let size = 0;
      while (
        i < need.length &&
        (group.length === 0 || size + need[i]!.text.length <= ALT_CHUNK_CHARS)
      ) {
        group.push(need[i]!);
        size += need[i]!.text.length;
        i += 1;
      }
      const got = await translateParagraphs({
        paragraphs: group.map((g) => ({ n: g.n, text: g.text })),
        // 원문은 세션 기본 표시 언어다. 코드가 아니면(이례) 자동 감지로 둔다.
        sourceLang: /^[a-z]{2}$/.test(primaryLang) ? (primaryLang as LangCode) : 'auto',
        targetLang: lang,
        tone: 'plain',
      }).catch(() => new Map<number, string>());
      for (const [n, text] of got) if (text) bySeq.set(n, text);
    }

    // 캐시 적재 — 실패해도 이번 응답은 그대로 나간다 (다음 폴링이 다시 번역할 뿐)
    const batch = adminDb().batch();
    let writes = 0;
    for (const item of need) {
      const tr = bySeq.get(item.n);
      if (!tr) continue;
      batch.set(item.ref, { alt: { [lang]: tr } }, { merge: true });
      writes += 1;
    }
    if (writes > 0) await batch.commit().catch(() => null);

    for (const seg of out) {
      const tr = bySeq.get(seg.seq);
      if (!tr) continue; // 번역이 안 온 줄은 기본 언어 그대로 나간다 — 빈 줄보다 낫다
      // 원문과 같은 번역(이미 뷰어 언어인 발화)은 빈 번역으로 둬 같은 말이 두 번 보이지 않게 한다
      if (tr !== seg.sourceText.trim() || seg.targetText.trim()) seg.targetText = tr;
    }
  }
  return out;
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
