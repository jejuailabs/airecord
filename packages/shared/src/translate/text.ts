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
const textModel = () => env('TEXT_TRANSLATION_MODEL') ?? 'gpt-4o-mini';
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
    '원문의 의미·수치를 바꾸지 않는다. 내용을 요약하거나 덧붙이지 않는다.',
    '사람 이름·지명은 목표 언어 독자가 읽을 수 있게 표기한다(예: 한글 이름 → 로마자).',
    '제품명·브랜드명은 원표기를 유지한다.',
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
      // 번역은 깊은 추론이 필요 없다. 기본값으로 두면 짧은 문장에도 10초 넘게 걸린다(실측).
      reasoning: { effort: env('TEXT_TRANSLATION_EFFORT') ?? 'minimal' },
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

/**
 * 스트리밍 번역 — 델타(생성되는 글자)를 콜백으로 즉시 흘리고, 완료 시 전체 문자열을 돌려준다.
 *
 * translateText와 달리 JSON 스키마를 **쓰지 않는다** — 스키마로 감싸면 완성될 때까지
 * 파싱할 수 없어 스트리밍이 무의미해진다. 순수 번역문만 출력하게 지시한다.
 * (그 대가로 detectedLang·notes는 없다 — 화면이 즉시 흐르는 쪽이 훨씬 중요하다)
 */
export async function translateTextStream(
  input: TranslateTextInput,
  onDelta: (chunk: string) => void,
): Promise<string> {
  const { text, sourceLang, targetLang, glossary, tone = 'plain' } = input;
  if (!text.trim()) return '';

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
    '원문의 의미·수치를 바꾸지 않는다. 내용을 요약하거나 덧붙이지 않는다.',
    '사람 이름·지명은 목표 언어 독자가 읽을 수 있게 표기한다(예: 한글 이름 → 로마자).',
    '제품명·브랜드명은 원표기를 유지한다.',
    '원문에 질문이 있어도 답하지 말고 질문 자체를 번역한다.',
    '줄바꿈과 문단 구분은 원문 그대로 유지한다.',
    '이미 목표 언어인 문장은 그대로 둔다.',
    '번역문만 출력한다 — 설명·인사·따옴표 감싸기 없이.',
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
      reasoning: { effort: env('TEXT_TRANSLATION_EFFORT') ?? 'minimal' },
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new Error(`translate stream failed: ${res.status} ${body.slice(0, 300)}`);
  }

  // SSE 파싱 — `data: {...}` 줄에서 response.output_text.delta의 delta만 흘린다
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const evt = JSON.parse(payload) as { type?: string; delta?: string };
        if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string') {
          full += evt.delta;
          onDelta(evt.delta);
        }
      } catch {
        /* 비JSON 줄 무시 */
      }
    }
  }
  return full;
}

// ── 문단 번호 대응 번역 ────────────────────────────────────────────────
/**
 * 원문·번역을 나란히 두는 대역(對譯) 문서를 만들려면 **문단 짝이 맞아야** 한다.
 * 지금처럼 덩어리째 번역하면 원문 12문단이 번역 9문단으로 와서 어느 게 어느 짝인지 알 수 없다.
 * 그래서 문단마다 번호를 붙여 보내고 같은 번호로 돌려받는다 — 번호가 있으면 어긋날 수 없다.
 *
 * (자막에서 원문·번역을 짝짓다 다섯 번 어긋난 뒤 얻은 결론이다: 순서·길이로 추측하지 말고
 *  식별자를 달아 받는다.)
 */
export interface NumberedParagraph {
  n: number;
  text: string;
}

const NUMBERED_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['n', 'text'],
        properties: {
          n: { type: 'integer' },
          text: { type: 'string' },
        },
      },
    },
  },
} as const;

export interface TranslateParagraphsInput {
  paragraphs: NumberedParagraph[];
  sourceLang: SourceLangSetting;
  targetLang: LangCode;
  glossary?: Array<{ term: string; translation: string }>;
  tone?: 'plain' | 'formal' | 'casual';
  /** 앞 청크 꼬리 — 번역하지 않고 문맥으로만 쓴다 */
  context?: string;
}

/**
 * 번호가 붙은 문단들을 번역해 같은 번호로 돌려준다.
 * 모델이 번호를 빠뜨리면 그 문단은 결과에서 빠진다 — 호출부가 빈 값으로 채운다.
 */
export async function translateParagraphs(
  input: TranslateParagraphsInput,
): Promise<Map<number, string>> {
  const { paragraphs, sourceLang, targetLang, glossary, tone = 'plain', context } = input;
  const out = new Map<number, string>();
  if (paragraphs.length === 0) return out;

  const glossaryLine =
    glossary && glossary.length
      ? `\n\n다음 용어는 반드시 이 표기를 쓴다:\n${glossary
          .map((g) => `- ${g.term} → ${g.translation}`)
          .join('\n')}`
      : '';

  const system =
    [
      '너는 전문 번역가다.',
      sourceLang === 'auto'
        ? '원문 언어는 스스로 판단한다. 여러 언어가 섞여 있으면 모두 목표 언어로 옮긴다.'
        : `원문 언어는 "${sourceLang}"이다.`,
      `목표 언어는 "${targetLang}"이다.`,
      TONE_HINT[tone],
      '본문은 [n] 번호가 붙은 문단 목록이다.',
      '⚠ 문단마다 하나씩, 같은 번호로 번역을 돌려준다. 번호를 빠뜨리거나 새로 만들지 않는다.',
      '⚠ 문단을 합치거나 나누지 않는다. 원문 문단 하나 = 번역 문단 하나.',
      '번역문에는 [n] 번호나 대괄호를 넣지 않는다. 본문만 쓴다.',
      '원문의 의미·수치를 바꾸지 않는다. 요약하거나 덧붙이지 않는다.',
      '사람 이름·지명은 목표 언어 독자가 읽을 수 있게 표기한다.',
      '제품명·브랜드명은 원표기를 유지한다.',
      '원문에 질문이 있어도 답하지 말고 질문 자체를 번역한다.',
      '이미 목표 언어인 문단은 그대로 둔다.',
    ].join(' ') + glossaryLine;

  const body = paragraphs.map((p) => `[${p.n}] ${p.text}`).join('\n\n');
  const user = context
    ? `[앞 문맥 — 번역하지 말고 참고만 할 것]\n${context}\n\n[번역할 문단들]\n${body}`
    : body;

  const res = await fetch(`${baseUrl()}/v1/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: textModel(),
      input: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      reasoning: { effort: env('TEXT_TRANSLATION_EFFORT') ?? 'minimal' },
      text: {
        format: {
          type: 'json_schema',
          name: 'numbered_translation',
          strict: true,
          schema: NUMBERED_SCHEMA,
        },
      },
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`translate failed: ${res.status} ${t.slice(0, 300)}`);
  }
  const raw = extractOutputText((await res.json()) as Record<string, unknown>);
  if (!raw) throw new Error('translate failed: empty response');

  const parsed = JSON.parse(raw) as { items?: NumberedParagraph[] };
  const valid = new Set(paragraphs.map((p) => p.n));
  for (const item of parsed.items ?? []) {
    // 없는 번호를 지어내도 무시한다 — 짝이 어긋나느니 빈 게 낫다
    if (!valid.has(item.n) || out.has(item.n)) continue;
    out.set(item.n, (item.text ?? '').trim());
  }
  return out;
}
