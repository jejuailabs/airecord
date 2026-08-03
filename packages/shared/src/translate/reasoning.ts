/**
 * 추론(reasoning) 파라미터 가드.
 *
 * `/v1/responses`의 `reasoning: { effort }`는 **추론 모델만 받는다** (gpt-5·o-시리즈).
 * gpt-4o 계열에 그대로 보내면 "지원하지 않는 파라미터"로 요청 전체가 거부돼
 * 번역이 500으로 죽는다 (2026-08-03 사고 — 모델만 4o-mini로 낮추고 이 파라미터를
 * 안 뺐다가 파일·텍스트 번역이 전부 멈췄다).
 *
 * 그래서 모델이 추론형일 때만 reasoning을 실어 보낸다. 4o 계열이면 빈 객체를 펼쳐
 * 아무것도 붙지 않는다 — 번역은 추론이 필요 없는 작업이라 없어도 품질에 지장 없다.
 */
const REASONING_MODEL = /^(gpt-5|o[1-9])/;

export function reasoningParam(
  model: string,
  effort: string,
): { reasoning: { effort: string } } | Record<string, never> {
  return REASONING_MODEL.test(model) ? { reasoning: { effort } } : {};
}
