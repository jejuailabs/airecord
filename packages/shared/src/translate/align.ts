/**
 * 원문 ↔ 번역 정렬기 (2층).
 *
 * 실시간(1층)에서는 두 스트림을 각자 흘려보낸다. 여기서는 **쌓인 뒤에** 짝을 맞춘다.
 * 나중에 하면 양쪽 전문을 다 놓고 볼 수 있어, 실시간의 타이밍 어림짐작이 필요 없다.
 *
 * ⚠⚠ 이 단계는 **텍스트를 절대 생성하지 않는다.**
 * 출력은 "원문 몇 번 ↔ 번역 몇 번" 대응표뿐이다.
 * 모델이 문장을 새로 쓰게 두면 귀에 들리는 말과 다른 글이 화면에 뜬다 —
 * gpt-5로 빈 칸을 메우다가 실제로 그 사고가 났고(2026-07-28), 그래서 걷어냈다.
 * 여기서 같은 실수를 반복하지 않도록 스키마를 인덱스만으로 못 박았다.
 */
import { z } from 'zod';

const env = (k: string): string | undefined =>
  typeof process !== 'undefined' ? process.env?.[k] : undefined;

const baseUrl = () => env('OPENAI_BASE_URL') ?? 'https://api.openai.com';
const alignModel = () => env('ALIGN_MODEL') ?? 'gpt-5';
const alignEffort = () => env('ALIGN_EFFORT') ?? 'minimal';

export interface AlignRow {
  /** 화면·기록에서 이 줄을 가리키는 번호 */
  seq: number;
  text: string;
}

/** 한 짝 — 원문 몇 줄과 번역 몇 줄이 같은 말인지 */
export interface AlignPair {
  sourceSeqs: number[];
  targetSeqs: number[];
}

const pairSchema = z.object({
  pairs: z.array(
    z.object({
      source: z.array(z.number().int()),
      target: z.array(z.number().int()),
    }),
  ),
});

/**
 * 정렬 결과.
 * unmatched는 짝을 못 찾은 줄 — 억지로 붙이지 않고 그대로 남긴다.
 */
export interface AlignResult {
  pairs: AlignPair[];
  unmatchedSource: number[];
  unmatchedTarget: number[];
}

const SYSTEM = [
  'You align two transcripts of the SAME speech: the original-language transcript and its translation.',
  'They were produced by different systems, so sentence boundaries and counts DO NOT match.',
  'One source line may correspond to several translation lines, and vice versa.',
  '',
  'Your ONLY job is to output which line numbers correspond to each other.',
  'NEVER write, rewrite, translate, summarize, or correct any text. Output line numbers only.',
  '',
  'Rules:',
  '- Keep the original order. Pairs must be non-overlapping and strictly increasing.',
  '- Every pair must contain at least one source line and at least one translation line.',
  '- If a line has no clear counterpart, leave it out of pairs entirely.',
  '- Transcripts may be imperfect (missing or garbled words). Match on meaning, not exact wording.',
].join('\n');

/**
 * 원문·번역 줄 목록을 받아 대응표를 만든다.
 * 실패하면 null — 호출부는 정렬 없이 그대로 두면 된다(화면이 멈추지 않는다).
 */
export async function alignTranscripts(
  source: AlignRow[],
  target: AlignRow[],
): Promise<AlignResult | null> {
  const apiKey = env('OPENAI_API_KEY');
  if (!apiKey) return null;
  if (source.length === 0 || target.length === 0) return null;

  const body = {
    model: alignModel(),
    reasoning: { effort: alignEffort() },
    input: [
      { role: 'system' as const, content: SYSTEM },
      {
        role: 'user' as const,
        content: [
          '# SOURCE (original language)',
          ...source.map((r) => `${r.seq}: ${r.text}`),
          '',
          '# TRANSLATION',
          ...target.map((r) => `${r.seq}: ${r.text}`),
        ].join('\n'),
      },
    ],
    text: {
      format: {
        type: 'json_schema' as const,
        name: 'alignment',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['pairs'],
          properties: {
            pairs: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['source', 'target'],
                properties: {
                  source: { type: 'array', items: { type: 'integer' } },
                  target: { type: 'array', items: { type: 'integer' } },
                },
              },
            },
          },
        },
      },
    },
  };

  try {
    const res = await fetch(`${baseUrl()}/v1/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error('[align] failed', res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const json = (await res.json()) as {
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };
    // 추론 모델은 output[0]이 reasoning이라 전체를 훑어야 텍스트가 나온다
    const raw = (json.output ?? [])
      .flatMap((o) => o.content ?? [])
      .map((c) => c.text ?? '')
      .join('')
      .trim();
    if (!raw) return null;

    const parsed = pairSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;

    return sanitize(parsed.data.pairs, source, target);
  } catch (e) {
    console.error('[align] error', e);
    return null;
  }
}

/**
 * 모델 출력을 그대로 믿지 않는다.
 * 없는 번호·중복·순서 뒤바뀜을 걸러낸다 — 하나라도 통과하면 자막이 뒤죽박죽이 된다.
 */
export function sanitize(
  raw: Array<{ source: number[]; target: number[] }>,
  source: AlignRow[],
  target: AlignRow[],
): AlignResult {
  const validSource = new Set(source.map((r) => r.seq));
  const validTarget = new Set(target.map((r) => r.seq));
  const usedSource = new Set<number>();
  const usedTarget = new Set<number>();
  const pairs: AlignPair[] = [];
  let lastSource = -Infinity;
  let lastTarget = -Infinity;

  for (const p of raw) {
    const s = [...new Set(p.source)].filter((n) => validSource.has(n) && !usedSource.has(n)).sort((a, b) => a - b);
    const t = [...new Set(p.target)].filter((n) => validTarget.has(n) && !usedTarget.has(n)).sort((a, b) => a - b);
    if (s.length === 0 || t.length === 0) continue;
    // 순서가 되돌아가는 짝은 버린다 (자막이 과거로 튀는 것을 막는다)
    if (s[0]! < lastSource || t[0]! < lastTarget) continue;
    lastSource = s[s.length - 1]!;
    lastTarget = t[t.length - 1]!;
    s.forEach((n) => usedSource.add(n));
    t.forEach((n) => usedTarget.add(n));
    pairs.push({ sourceSeqs: s, targetSeqs: t });
  }

  return {
    pairs,
    unmatchedSource: source.map((r) => r.seq).filter((n) => !usedSource.has(n)),
    unmatchedTarget: target.map((r) => r.seq).filter((n) => !usedTarget.has(n)),
  };
}
