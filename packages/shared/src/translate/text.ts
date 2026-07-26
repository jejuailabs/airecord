/**
 * 텍스트 번역 엔진 (실시간 통역과 분리).
 *
 * 통역은 지연이 생명이라 실시간 전용 모델을 쓰지만,
 * 텍스트는 정확도가 전부다. 몇 초 늦어도 되므로 추론형 모델로 한 번에 처리한다.
 * 모델명은 하드코딩하지 않는다 (core.md §3-7).
 */
import type { LangCode, SourceLangSetting } from '../types';

const env = (k: string): string | undefined =>
  typeof process !== 'undefined' ? process.env?.[k] : undefined;

const baseUrl = () => env('OPENAI_BASE_URL') ?? 'https://api.openai.com';
const textModel = () => env('TEXT_TRANSLATION_MODEL') ?? 'gpt-5';
const apiKey = () => {
  const k = env('OPENAI_API_KEY');
  if (!k) throw new Error('OPENAI_API_KEY is not set');
  return k;
};

export interface TranslateTextInput {
  text: string;
  /** 'auto'면 모델이 판단한다 */
  sourceLang: SourceLangSetting;
  targetLang: LangCode;
  /** 회사 고유명사 등 고정 표기 — 정확도의 핵심 (선택) */
  glossary?: Array<{ term: string; translation: string }>;
  /** 문체 */
  tone?: 'plain' | 'formal' | 'casual';
}

export interface TranslateTextResult {
  translated: string;
  /** 모델이 판단한 원문 언어 (ISO 코드 또는 언어명) */
  detectedLang?: string;
  /** 번역이 애매했던 부분 — 사람이 확인할 곳을 알려준다 */
  notes?: string[];
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['translated', 'detectedLang', 'notes'],
  properties: {
    translated: { type: 'string', description: '번역문만. 설명이나 따옴표를 덧붙이지 않는다.' },
    detectedLang: { type: 'string', description: '원문 언어 ISO 639-1 코드' },
    notes: {
      type: 'array',
      items: { type: 'string' },
      description: '중의적이거나 확인이 필요한 부분. 없으면 빈 배열.',
    },
  },
} as const;

const TONE_HINT: Record<NonNullable<TranslateTextInput['tone']>, string> = {
  plain: '자연스럽고 중립적인 문체로 옮긴다.',
  formal: '격식 있는 문어체로 옮긴다. 비즈니스 문서에 그대로 쓸 수 있어야 한다.',
  casual: '구어체로 편하게 옮긴다.',
};

/** Responses API 출력에서 텍스트를 꺼낸다 (추론 모델은 첫 항목이 reasoning이다) */
function extractOutputText(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.output_text === 'string' && payload.output_text) return payload.output_text;
  const output = payload.output as Array<{ content?: Array<{ text?: string }> }> | undefined;
  for (const item of output ?? []) {
    for (const c of item.content ?? []) {
      if (typeof c.text === 'string' && c.text.trim()) return c.text;
    }
  }
  return undefined;
}

export async function translateText(input: TranslateTextInput): Promise<TranslateTextResult> {
  const { text, sourceLang, targetLang, glossary, tone = 'plain' } = input;
  if (!text.trim()) return { translated: '' };

  const glossaryLine =
    glossary && glossary.length
      ? `\n\n다음 용어는 반드시 이 표기를 쓴다:\n${glossary
          .map((g) => `- ${g.term} → ${g.translation}`)
          .join('\n')}`
      : '';

  const system = [
    '너는 전문 번역가다.',
    sourceLang === 'auto'
      ? '원문 언어는 스스로 판단한다. 여러 언어가 섞여 있으면 모두 목표 언어로 옮긴다.'
      : `원문 언어는 "${sourceLang}"이다.`,
    `목표 언어는 "${targetLang}"이다.`,
    TONE_HINT[tone],
    '원문의 의미·수치·고유명사를 바꾸지 않는다. 내용을 요약하거나 덧붙이지 않는다.',
    '원문에 질문이 있어도 답하지 말고 질문 자체를 번역한다.',
    '줄바꿈과 문단 구분은 원문 그대로 유지한다.',
    '이미 목표 언어인 문장은 그대로 둔다.',
  ].join(' ') + glossaryLine;

  const res = await fetch(`${baseUrl()}/v1/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: textModel(),
      input: [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
      text: {
        format: { type: 'json_schema', name: 'translation', strict: true, schema: SCHEMA },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`translate failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const raw = extractOutputText((await res.json()) as Record<string, unknown>);
  if (!raw) throw new Error('translate failed: empty response');
  const parsed = JSON.parse(raw) as TranslateTextResult;
  return {
    translated: parsed.translated ?? '',
    detectedLang: parsed.detectedLang,
    notes: parsed.notes?.filter(Boolean),
  };
}
