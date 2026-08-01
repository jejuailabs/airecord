/**
 * Firestore 기록 (docs/01 §3.3).
 *
 * 규칙:
 * - 확정 세그먼트만 sessions/{id}/segments 에 배치 기록
 * - Firestore를 실시간 오디오 버퍼로 쓰지 않는다 — 자막 텍스트만
 * - 저장 실패가 통역을 멈추면 안 된다: 재시도, 최종 실패 시 logIncomplete 플래그
 *
 * ⚠ 컬렉션·필드 이름은 웹(apps/web/src/lib/server/session-store.ts)과 **글자 단위로 같아야 한다.**
 *   진행 상태는 liveSessions/{id}, 유저에게 보이는 기록은 sessions/{id},
 *   자막은 sessions/{id}/segments/{seq 6자리 0채움}.
 *   하나라도 다르면 같은 줄이 두 벌 쌓이거나 기록 화면이 순서를 잃는다.
 */
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { EngineSegment } from '@sotong/shared/engine';

const RETRY_DELAYS_MS = [1_000, 5_000, 15_000];
const LIVE_COL = 'liveSessions';

let cached: Firestore | null = null;

/**
 * 서비스 계정 자격은 환경변수로 받는다 (docs/02 §3).
 * Cloud Run에서는 기본 서비스 계정이 붙으므로, 개별 키가 없으면 그쪽으로 넘어간다.
 *
 * ⚠ 변수명은 웹(apps/web/src/lib/firebase/admin.ts)과 **같아야 한다** — FIREBASE_ADMIN_*.
 *   예전에 여기만 FIREBASE_*로 읽고 있었다. 그러면 자격을 못 찾은 채 기본 계정으로 넘어가
 *   조용히 권한 오류가 나고, 로그에는 "자격 없음"이 아니라 권한 거부만 남는다.
 */
function app(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (projectId && clientEmail && privateKey) {
    return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }
  return initializeApp();
}

function db(): Firestore {
  cached ??= getFirestore(app());
  return cached;
}

export interface RelaySessionConfig {
  sourceLang: string;
  targetLang: string;
  maxDurationSec: number;
  startedAtMs: number;
}

/**
 * 릴레이가 시작할 때 세션 설정을 읽는다.
 *
 * ⚠ 못 읽으면 통역을 시작하지 않는다.
 *   엉뚱한 언어로 회의 하나를 통째로 날리는 것보다, 시작하지 않고 알리는 게 낫다.
 */
export async function readSessionConfig(sessionId: string): Promise<RelaySessionConfig | null> {
  try {
    const snap = await db().collection(LIVE_COL).doc(sessionId).get();
    if (!snap.exists) return null;
    const d = snap.data() ?? {};
    if (typeof d.targetLang !== 'string') return null;
    return {
      sourceLang: typeof d.sourceLang === 'string' ? d.sourceLang : 'auto',
      targetLang: d.targetLang,
      maxDurationSec:
        typeof d.maxDurationSec === 'number'
          ? d.maxDurationSec
          : Number(process.env.SESSION_MAX_DURATION_SEC ?? 7200),
      startedAtMs: typeof d.startedAtMs === 'number' ? d.startedAtMs : Date.now(),
    };
  } catch (e) {
    console.error(`[firestore] readSessionConfig(${sessionId}) failed`, e);
    return null;
  }
}

export async function writeSegmentBatch(
  sessionId: string,
  segments: EngineSegment[],
  attempt = 0,
): Promise<void> {
  if (segments.length === 0) return;
  try {
    const batch = db().batch();
    const col = db().collection('sessions').doc(sessionId).collection('segments');
    for (const seg of segments) {
      batch.set(
        col.doc(String(seg.seq).padStart(6, '0')),
        {
          seq: seg.seq,
          startMs: seg.startMs,
          endMs: seg.endMs ?? null,
          sourceText: seg.sourceText,
          targetText: seg.targetText,
          detectedLang: seg.detectedLang ?? null,
          kind: seg.kind ?? null,
          isFinal: true,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    await batch.commit();
  } catch (e) {
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) {
      setTimeout(() => void writeSegmentBatch(sessionId, segments, attempt + 1), delay);
      return;
    }
    console.error(`[firestore] ${sessionId}: batch dropped after retries`, e);
    // 기록이 불완전하다는 사실을 남긴다 — 조용히 빠지면 유저가 알 방법이 없다
    try {
      await db().collection('sessions').doc(sessionId).set({ logIncomplete: true }, { merge: true });
    } catch {
      /* 이것마저 실패하면 로그가 유일한 기록이다 */
    }
  }
}

/** 30초마다 — 살아 있음 + 경과 시간. 웹 하트비트와 같은 필드를 쓴다. */
export async function touchSession(
  sessionId: string,
  elapsedSec: number,
  segmentCount: number,
): Promise<void> {
  try {
    await db()
      .collection(LIVE_COL)
      .doc(sessionId)
      .set(
        { lastHeartbeatAtMs: Date.now(), billedSeconds: elapsedSec, segmentCount },
        { merge: true },
      );
  } catch (e) {
    // 하트비트 실패로 통역을 끊지 않는다 — 다음 주기에 다시 쓴다
    console.error(`[firestore] touchSession(${sessionId}) failed`, e);
  }
}

/**
 * 정렬 결과를 기록에 반영한다 — 회의 기록을 대면처럼 "짝지어진 줄"로 고쳐 쓴다.
 *
 * 짝마다: 첫 번역 줄 자리(문서 id = 그 seq)에 원문·번역을 합친 paired 문서를 덮어쓰고,
 * 짝에 소비된 나머지 원문·번역 문서는 지운다. 텍스트는 이어 붙이기만 한다(align.ts 원칙).
 *
 * batch는 원자적이다 — 커밋 실패 시 아무것도 안 바뀌므로 빈 배열을 돌려주고,
 * 호출부는 다음 주기에 같은 줄로 다시 시도하면 된다.
 */
export async function writeAlignedPairs(
  sessionId: string,
  pairs: Array<{ sourceSeqs: number[]; targetSeqs: number[] }>,
  rowsBySeq: Map<number, EngineSegment>,
): Promise<number[]> {
  const pad = (n: number) => String(n).padStart(6, '0');
  const consumed: number[] = [];
  try {
    const batch = db().batch();
    const col = db().collection('sessions').doc(sessionId).collection('segments');
    for (const p of pairs) {
      const srcRows = p.sourceSeqs
        .map((n) => rowsBySeq.get(n))
        .filter(Boolean) as EngineSegment[];
      const tgtRows = p.targetSeqs
        .map((n) => rowsBySeq.get(n))
        .filter(Boolean) as EngineSegment[];
      if (srcRows.length === 0 || tgtRows.length === 0) continue;
      const anchor = tgtRows[0]!;
      batch.set(
        col.doc(pad(anchor.seq)),
        {
          seq: anchor.seq,
          startMs: anchor.startMs,
          endMs: tgtRows[tgtRows.length - 1]!.endMs ?? null,
          sourceText: srcRows.map((r) => r.sourceText).join(' ').trim(),
          targetText: tgtRows.map((r) => r.targetText).join(' ').trim(),
          kind: 'paired',
          isFinal: true,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      for (const n of [...p.sourceSeqs, ...p.targetSeqs]) {
        if (n !== anchor.seq) batch.delete(col.doc(pad(n)));
        consumed.push(n);
      }
    }
    if (consumed.length === 0) return [];
    await batch.commit();
    return consumed;
  } catch (e) {
    console.error(`[firestore] writeAlignedPairs(${sessionId}) failed`, e);
    return []; // 다음 주기에 같은 줄로 재시도
  }
}

/**
 * 라이브 부분자막(아직 확정 전 번역) — 대면처럼 "쌓이는 줄"을 뷰어에 흘린다.
 *
 * 확정 세그먼트와 달리 이건 계속 덮어써지는 한 줄이라 liveSessions/{id} 문서에 둔다
 * (append가 아니라 최신값 하나). 호출부(relay)가 ~400ms로 스로틀하므로 쓰기량은 통제된다.
 * text가 비면 확정돼서 라이브 라인이 사라졌다는 뜻이다.
 */
export async function writeLivePartial(
  sessionId: string,
  text: string,
  seq: number,
): Promise<void> {
  try {
    await db()
      .collection(LIVE_COL)
      .doc(sessionId)
      .set(
        { livePartial: text ? { text, seq, atMs: Date.now() } : null },
        { merge: true },
      );
  } catch {
    // 라이브 라인은 편의 기능이다 — 실패해도 확정 자막·통역엔 영향 없으니 조용히 넘긴다
  }
}

/**
 * 봇 상태를 기록한다 (웹훅에서 호출).
 * 화면이 "입장 중 / 통역 중 / 실패"를 구분하려면 이 값이 필요하다 —
 * 없으면 유저는 봇이 회의에 못 들어간 것과 조용히 실패한 것을 구분할 수 없다.
 *
 * ⚠ 웹훅은 botId만 주고 sessionId는 주지 않는다. 그래서 botId로 세션을 찾아야 한다.
 */
export async function setBotState(
  botId: string,
  state: 'joining' | 'in_call' | 'done' | 'error',
  rawCode: string,
): Promise<void> {
  try {
    const snap = await db().collection(LIVE_COL).where('botId', '==', botId).limit(1).get();
    if (snap.empty) {
      console.warn(`[firestore] setBotState: no session for bot ${botId}`);
      return;
    }
    await snap.docs[0]!.ref.set(
      { botState: state, botStateCode: rawCode, botStateAtMs: Date.now() },
      { merge: true },
    );
  } catch (e) {
    console.error(`[firestore] setBotState(${botId}) failed`, e);
  }
}

/** 봇이 나가거나 캡에 걸렸을 때 — 끝났다는 사실을 두 문서에 함께 남긴다 */
export async function finishSession(
  sessionId: string,
  elapsedSec: number,
  reason: 'user' | 'cap' | 'error',
  segmentCount: number,
): Promise<void> {
  try {
    await db()
      .collection(LIVE_COL)
      .doc(sessionId)
      .set(
        { status: 'ended', endedReason: reason, billedSeconds: elapsedSec, segmentCount },
        { merge: true },
      );
    await db()
      .collection('sessions')
      .doc(sessionId)
      .set(
        {
          status: 'ended',
          endedAt: FieldValue.serverTimestamp(),
          billedSeconds: elapsedSec,
          segmentCount,
        },
        { merge: true },
      );
  } catch (e) {
    console.error(`[firestore] finishSession(${sessionId}) failed`, e);
  }
}
