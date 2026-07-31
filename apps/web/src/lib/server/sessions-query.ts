import { cookies } from 'next/headers';
import { adminDb, SESSION_COOKIE_NAME, verifySessionCookie } from '@/lib/firebase/admin';
import type { SessionSummary } from '@/lib/server/summarize';

export interface SessionListItem {
  id: string;
  title: string | null;
  status: string;
  mode: string;
  sourceLang: string;
  targetLang: string;
  billedSeconds: number;
  segmentCount: number;
  startedAtMs: number | null;
}

export interface SessionDetail extends SessionListItem {
  summary: SessionSummary | null;
  summaryStatus: string | null;
  /** 제목을 AI가 붙였는지 (유저가 수정하면 false) */
  titleFromAi: boolean;
  segments: Array<{
    seq: number;
    startMs: number;
    sourceText: string;
    targetText: string;
    /** 'paired'면 원문·번역이 짝지어진 줄. 아니면 한쪽만 채워진 줄이다. */
    kind: 'target' | 'source' | 'paired' | null;
    speaker: 'A' | 'B' | null;
  }>;
}

function toMs(v: unknown): number | null {
  const t = v as { toMillis?: () => number } | undefined;
  return typeof t?.toMillis === 'function' ? t.toMillis() : null;
}

export async function currentUid(): Promise<string | null> {
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const user = await verifySessionCookie(cookie).catch(() => null);
  return user?.uid ?? null;
}

export async function listSessions(uid: string, limit = 50): Promise<SessionListItem[]> {
  try {
    // startedBy 기준 단일 필드 정렬 — 복합 인덱스 없이 동작하도록 메모리에서 정렬한다
    const snap = await adminDb()
      .collection('sessions')
      .where('startedByUid', '==', uid)
      .limit(limit)
      .get();
    return snap.docs
      .map((d) => ({
        id: d.id,
        title: (d.get('title') as string | null) ?? null,
        status: (d.get('status') as string) ?? 'ended',
        mode: (d.get('mode') as string) ?? 'inperson',
        sourceLang: (d.get('sourceLang') as string) ?? 'auto',
        targetLang: (d.get('targetLang') as string) ?? 'en',
        billedSeconds: (d.get('billedSeconds') as number) ?? 0,
        segmentCount: (d.get('segmentCount') as number) ?? 0,
        startedAtMs: toMs(d.get('startedAt')),
      }))
      .sort((a, b) => (b.startedAtMs ?? 0) - (a.startedAtMs ?? 0));
  } catch (e) {
    console.error('[sessions-query] list failed', e);
    return [];
  }
}

export async function getSessionDetail(
  uid: string,
  sessionId: string,
): Promise<SessionDetail | null> {
  try {
    const db = adminDb();
    const doc = await db.collection('sessions').doc(sessionId).get();
    if (!doc.exists || doc.get('startedByUid') !== uid) return null;

    const segSnap = await db
      .collection('sessions')
      .doc(sessionId)
      .collection('segments')
      .orderBy('seq')
      .limit(3000)
      .get();

    return {
      id: doc.id,
      title: (doc.get('title') as string | null) ?? null,
      status: (doc.get('status') as string) ?? 'ended',
      mode: (doc.get('mode') as string) ?? 'inperson',
      sourceLang: (doc.get('sourceLang') as string) ?? 'auto',
      targetLang: (doc.get('targetLang') as string) ?? 'en',
      billedSeconds: (doc.get('billedSeconds') as number) ?? 0,
      segmentCount: (doc.get('segmentCount') as number) ?? 0,
      startedAtMs: toMs(doc.get('startedAt')),
      summary: (doc.get('summary') as SessionSummary | undefined) ?? null,
      summaryStatus: (doc.get('summaryStatus') as string | undefined) ?? null,
      titleFromAi: Boolean(doc.get('titleFromAi')),
      segments: segSnap.docs.map((d) => ({
        seq: (d.get('seq') as number) ?? 0,
        startMs: (d.get('startMs') as number) ?? 0,
        sourceText: (d.get('sourceText') as string) ?? '',
        targetText: (d.get('targetText') as string) ?? '',
        kind: (d.get('kind') as 'target' | 'source' | 'paired' | null) ?? null,
        speaker: (d.get('speaker') as 'A' | 'B' | null) ?? null,
      })),
    };
  } catch (e) {
    console.error('[sessions-query] detail failed', e);
    return null;
  }
}
