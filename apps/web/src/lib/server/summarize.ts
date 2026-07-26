/**
 * 세션 자동 요약 (docs/08 §4 Phase 6 항목을 앞당겨 구현).
 * 통역이 끝나면 원문·번역 스크립트를 근거로 요약을 만든다.
 *
 * 요약은 부산물이다 — 실패해도 세션 기록 자체는 남아야 한다 (core.md §3-5).
 */
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';

export interface SessionSummary {
  title: string;
  overview: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: Array<{ text: string; owner?: string }>;
}

const SUMMARY_MODEL = () => process.env.SUMMARY_MODEL ?? 'gpt-5';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'overview', 'keyPoints', 'decisions', 'actionItems'],
  properties: {
    title: { type: 'string', description: '15자 내외의 회의 제목' },
    overview: { type: 'string', description: '3~4문장 요약' },
    keyPoints: { type: 'array', items: { type: 'string' } },
    decisions: { type: 'array', items: { type: 'string' } },
    actionItems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'owner'],
        properties: {
          text: { type: 'string' },
          owner: { type: 'string', description: '담당자를 알 수 없으면 빈 문자열' },
        },
      },
    },
  },
} as const;

export async function summarizeTranscript(
  lines: Array<{ sourceText: string; targetText: string }>,
  outputLang: string,
): Promise<SessionSummary | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || lines.length === 0) return null;

  // 번역문 기준으로 요약한다 (읽는 사람의 언어)
  const transcript = lines
    .map((l, i) => `${i + 1}. ${l.targetText.trim()}${l.sourceText ? `\n   (원문: ${l.sourceText.trim()})` : ''}`)
    .join('\n')
    .slice(0, 60_000);

  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: SUMMARY_MODEL(),
        input: [
          {
            role: 'system',
            content:
              '너는 회의록 정리 전문가다. 통역된 대화 스크립트를 읽고 요약한다. ' +
              `모든 출력은 "${outputLang}" 언어로 작성한다. ` +
              '스크립트에 없는 내용을 지어내지 않는다. 해당 항목이 없으면 빈 배열로 둔다.',
          },
          { role: 'user', content: `다음 통역 스크립트를 요약해줘.\n\n${transcript}` },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'session_summary',
            strict: true,
            schema: SCHEMA,
          },
        },
      }),
    });
    if (!res.ok) {
      console.error('[summarize] failed', res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const json = (await res.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };
    const raw = json.output_text ?? json.output?.[0]?.content?.[0]?.text;
    if (!raw) return null;
    return JSON.parse(raw) as SessionSummary;
  } catch (e) {
    console.error('[summarize] error', e);
    return null;
  }
}

/** 세션 종료 후 백그라운드로 요약을 만들어 저장한다 */
export async function generateAndStoreSummary(sessionId: string, outputLang: string): Promise<void> {
  try {
    const db = adminDb();
    const snap = await db
      .collection('sessions')
      .doc(sessionId)
      .collection('segments')
      .orderBy('seq')
      .limit(2000)
      .get();
    const lines = snap.docs.map((d) => ({
      sourceText: (d.get('sourceText') as string) ?? '',
      targetText: (d.get('targetText') as string) ?? '',
    }));
    if (lines.length === 0) return;

    await db.collection('sessions').doc(sessionId).set({ summaryStatus: 'running' }, { merge: true });
    const summary = await summarizeTranscript(lines, outputLang);
    await db
      .collection('sessions')
      .doc(sessionId)
      .set(
        summary
          ? { summary, summaryStatus: 'ready', summarizedAt: FieldValue.serverTimestamp() }
          : { summaryStatus: 'failed' },
        { merge: true },
      );
  } catch (e) {
    console.error('[summarize] store failed', e);
  }
}
