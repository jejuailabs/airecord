/**
 * 이미지 번역 — 비전 모델이 이미지를 보며 바로 번역한다.
 *
 * 별도 OCR을 붙이지 않는 이유: OCR이 글자만 뽑아 넘기면 표·머리말·캡션 같은
 * 배치 정보가 사라져 오역이 는다. 모델이 이미지를 직접 보면 맥락을 함께 읽는다.
 */
import type { LangCode, SourceLangSetting } from '../types';

const env = (k: string): string | undefined =>
  typeof process !== 'undefined' ? process.env?.[k] : undefined;

const baseUrl = () => env('OPENAI_BASE_URL') ?? 'https://api.openai.com';
const visionModel = () => env('VISION_TRANSLATION_MODEL') ?? 'gpt-5';
const apiKey = () => {
  const k = env('OPENAI_API_KEY');
  if (!k) throw new Error('OPENAI_API_KEY is not set');
  return k;
};

export interface TranslateImageInput {
  /** data:image/...;base64,... 형태 */
  dataUrl: string;
  sourceLang: SourceLangSetting;
  targetLang: LangCode;
}

export interface TranslateImageResult {
  /** 이미지에서 읽어낸 원문 (레이아웃 순서대로) */
  source: string;
  translated: string;
  notes?: string[];
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['source', 'translated', 'notes'],
  properties: {
    source: {
      type: 'string',
      description: '이미지에서 읽은 원문. 읽는 순서대로. 표는 행마다 줄바꿈.',
    },
    translated: { type: 'string', description: '원문과 같은 줄 구성으로 옮긴 번역문.' },
    notes: {
      type: 'array',
      items: { type: 'string' },
      description: '흐려서 못 읽은 부분, 중의적 표현 등. 없으면 빈 배열.',
    },
  },
} as const;

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

export async function translateImage(input: TranslateImageInput): Promise<TranslateImageResult> {
  const { dataUrl, sourceLang, targetLang } = input;

  const system = [
    '너는 이미지 속 글자를 읽고 번역하는 전문가다.',
    sourceLang === 'auto'
      ? '원문 언어는 스스로 판단한다.'
      : `원문 언어는 "${sourceLang}"이다.`,
    `목표 언어는 "${targetLang}"이다.`,
    '사람이 읽는 순서대로 글자를 옮긴다. 제목·본문·표·캡션의 구분을 줄바꿈으로 유지한다.',
    '표는 한 행을 한 줄로 쓰고 칸은 " | "로 구분한다.',
    '숫자와 가격은 절대 바꾸지 않는다.',
    '통화·단위 표기는 목표 언어 독자가 읽을 수 있게 옮긴다(예: 9,000원 → 9,000 KRW). 숫자 자체는 그대로 둔다.',
    '이미지에 없는 내용을 지어내지 않는다. 흐려서 못 읽으면 notes에 적는다.',
    'source와 translated의 줄 수와 순서를 반드시 일치시킨다.',
  ].join(' ');

  const res = await fetch(`${baseUrl()}/v1/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: visionModel(),
      input: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: '이 이미지의 글자를 읽고 번역해줘.' },
            { type: 'input_image', image_url: dataUrl },
          ],
        },
      ],
      reasoning: { effort: env('VISION_TRANSLATION_EFFORT') ?? 'low' },
      text: {
        format: { type: 'json_schema', name: 'image_translation', strict: true, schema: SCHEMA },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`image translate failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const raw = extractOutputText((await res.json()) as Record<string, unknown>);
  if (!raw) throw new Error('image translate failed: empty response');
  const parsed = JSON.parse(raw) as TranslateImageResult;
  return {
    source: parsed.source ?? '',
    translated: parsed.translated ?? '',
    notes: parsed.notes?.filter(Boolean),
  };
}
