/**
 * 레이아웃 재구성 번역 — 페이지 이미지를 비전 모델에 보여주고
 * **깨끗한 HTML+CSS로 다시 그리게** 한다 (사용자 지시 2026-08-03).
 *
 * 왜 이 방식인가:
 *   PDF의 표·격자를 좌표로 정밀 검출하는 건 취약하다(셀 병합·삐뚤어진 스캔선에서 깨진다).
 *   대신 "이건 표고, 이 칸은 회색 헤더구나"를 비전 모델이 이해해 CSS로 재현하게 하면,
 *   픽셀 단위로 똑같진 않아도 **비슷하고 깔끔한** 결과가 나온다 — LLM이 가장 잘하는 일이다.
 *   디지털·스캔 구분 없이 이미지 하나로 동일하게 작동한다.
 *
 * ⚠ 숫자·코드·날짜·검사값은 **절대 바꾸지 않는다.** 성적서·계약서가 주 대상이라
 *   값 하나만 틀려도 문서가 못 쓰게 된다. 프롬프트에서 이걸 최우선으로 못 박는다.
 */
import type { LangCode, SourceLangSetting } from '../types';
import { reasoningParam } from './reasoning';

const env = (k: string): string | undefined =>
  typeof process !== 'undefined' ? process.env?.[k] : undefined;

const baseUrl = () => env('OPENAI_BASE_URL') ?? 'https://api.openai.com';
/** 레이아웃 재구성은 비전+구조 이해가 필요해 비전 모델을 쓴다. 품질이 아쉬우면 env로 gpt-5로 올린다. */
const layoutModel = () => env('LAYOUT_TRANSLATION_MODEL') ?? env('VISION_TRANSLATION_MODEL') ?? 'gpt-4o';
const layoutEffort = () => env('LAYOUT_TRANSLATION_EFFORT') ?? 'medium';
const apiKey = () => {
  const k = env('OPENAI_API_KEY');
  if (!k) throw new Error('OPENAI_API_KEY is not set');
  return k;
};

/** 'replace' — 번역만 채운 원본형. 'bilingual' — 칸마다 원문+번역 대조. */
export type LayoutMode = 'replace' | 'bilingual';

export interface ReproduceLayoutInput {
  /** data:image/...;base64,... — 페이지를 그린 이미지 */
  dataUrl: string;
  sourceLang: SourceLangSetting;
  targetLang: LangCode;
  mode: LayoutMode;
}

export interface ReproduceLayoutResult {
  /** 페이지 하나를 재현한 자족 HTML 조각 (하나의 루트 요소, 인라인 CSS) */
  html: string;
  notes?: string[];
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['html', 'notes'],
  properties: {
    html: {
      type: 'string',
      description:
        '페이지를 재현한 HTML 조각. <div> 하나를 루트로, 모든 스타일은 인라인 style 속성으로. ' +
        '<script>·외부 링크·마크다운 펜스 없이 본문 HTML만.',
    },
    notes: {
      type: 'array',
      items: { type: 'string' },
      description: '흐려서 못 읽은 부분·불확실한 값. 없으면 빈 배열.',
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

export async function reproduceLayout(
  input: ReproduceLayoutInput,
): Promise<ReproduceLayoutResult> {
  const { dataUrl, sourceLang, targetLang, mode } = input;

  const cellRule =
    mode === 'bilingual'
      ? [
          '각 칸·문단에 **원문과 번역을 함께** 넣는다:',
          '원문은 위에 작고 흐리게(예: color:#8a8f9c; font-size:0.85em),',
          '번역은 아래에 진하게. 둘을 <br>로 나눈다.',
        ].join(' ')
      : '각 칸·문단에는 **번역문만** 넣는다. 원문은 넣지 않는다.';

  const system = [
    '너는 문서 이미지를 보고 같은 레이아웃의 깨끗한 HTML을 만드는 전문가다.',
    sourceLang === 'auto' ? '원문 언어는 스스로 판단한다.' : `원문 언어는 "${sourceLang}"이다.`,
    `번역 목표 언어는 "${targetLang}"이다.`,
    '',
    '【목표】 픽셀 단위로 똑같이 말고, **구조를 이해해 비슷하고 깔끔하게** 재현한다.',
    '이미지의 표·칸·테두리·셀 배경색(회색 헤더 등)·정렬·제목·구획을 파악해 HTML 표/박스로 옮긴다.',
    '표는 <table>로, 테두리는 border, 헤더 칸의 회색 배경 같은 건 background로 재현한다.',
    '칸 병합이 보이면 colspan·rowspan으로 맞춘다. 선이 다소 삐뚤어도 반듯한 선으로 정리해 그린다.',
    cellRule,
    '',
    '【절대 규칙】 숫자·금액·날짜·발행번호·문서번호·코드·검사값·단위는 **원문 그대로 둔다.**',
    '  이런 값은 번역하지도 바꾸지도 않는다 (예: "0.00", "R20260429-0096", "043-253-3333", "mg/kg").',
    '사람 이름·기관명은 목표 언어 독자가 읽을 수 있게 옮기되 숫자는 손대지 않는다.',
    '이미지에 없는 내용을 지어내지 않는다. 못 읽은 칸은 비우고 notes에 적는다.',
    '',
    '【출력 형식】 <div> 하나를 루트로 하는 HTML 조각. 모든 스타일은 인라인 style 속성.',
    '  전체 폭은 100%로, 글꼴은 sans-serif. 바깥 여백·<html>·<body>·<script>·마크다운 펜스는 넣지 않는다.',
  ].join('\n');

  const res = await fetch(`${baseUrl()}/v1/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: layoutModel(),
      input: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: '이 페이지를 위 규칙대로 재현해줘.' },
            { type: 'input_image', image_url: dataUrl },
          ],
        },
      ],
      ...reasoningParam(layoutModel(), layoutEffort()),
      text: {
        format: { type: 'json_schema', name: 'layout_reproduction', strict: true, schema: SCHEMA },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`layout reproduce failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const raw = extractOutputText((await res.json()) as Record<string, unknown>);
  if (!raw) throw new Error('layout reproduce failed: empty response');
  const parsed = JSON.parse(raw) as ReproduceLayoutResult;
  return { html: sanitizeHtml(parsed.html ?? ''), notes: parsed.notes?.filter(Boolean) };
}

/**
 * 모델이 만든 HTML을 인쇄 창에 넣기 전에 위험 요소를 벗긴다.
 * 재구성 결과는 표·글자·색뿐이라 스크립트·이벤트 핸들러가 있을 이유가 없다 —
 * 전부 제거해 인쇄 창에서 코드가 실행되지 않게 한다.
 */
function sanitizeHtml(html: string): string {
  let s = html.trim();
  // 마크다운 펜스·문서 골격 벗기기
  s = s.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '');
  s = s.replace(/<\/?(?:html|body|head)[^>]*>/gi, '');
  // 스크립트·스타일시트 태그 통째로 제거 (인라인 style 속성만 허용)
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<(?:iframe|object|embed|link|meta)[^>]*>/gi, '');
  // on*= 이벤트 핸들러 속성 제거 (따옴표·무따옴표 모두)
  s = s.replace(/\son\w+\s*=\s*"[^"]*"/gi, '');
  s = s.replace(/\son\w+\s*=\s*'[^']*'/gi, '');
  s = s.replace(/\son\w+\s*=\s*[^\s>]+/gi, '');
  // javascript: URL 제거
  s = s.replace(/(href|src)\s*=\s*"javascript:[^"]*"/gi, '$1="#"');
  s = s.replace(/(href|src)\s*=\s*'javascript:[^']*'/gi, "$1='#'");
  return s.trim();
}
