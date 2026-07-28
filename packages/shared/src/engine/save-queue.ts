/**
 * "이 줄을 아직 저장 안 했는가" 판정.
 *
 * 이 규칙 하나가 틀려서 기록이 통째로 새어 나간 적이 있다(2026-07-28).
 * 종료 시 저장 대상을 `kind !== 'paired'`로 골랐는데,
 *   · 조립기는 'paired'를 만들지 않는다 — 'paired'는 **정렬기만** 만든다
 *   · 그런데 정렬기가 만든 줄을 저장 큐에 넣는 코드가 빠져 있었다
 * 그래서 하트비트는 세션 내내 빈 배치만 보냈고, 종료 시에는 정렬이 성공한 줄
 * — 즉 원문·번역이 제대로 맞물린 제일 멀쩡한 줄 — 만 골라서 버렸다.
 * 남은 건 짝을 못 지은 부스러기뿐이라 기록이 띄엄띄엄해 보였다.
 *
 * 그래서 기준은 "짝을 지었는가"가 아니라 **"서버가 받았는가"** 하나뿐이다.
 */
export interface SaveRow {
  seq: number;
  sourceText: string;
  targetText: string;
  isFinal?: boolean;
}

/**
 * 아직 서버가 못 받은 확정 줄.
 * 양쪽이 다 빈 줄은 저장해도 화면에 아무것도 안 나오므로 뺀다(script.ts와 같은 기준).
 */
export function unsavedRows<T extends SaveRow>(rows: T[], sentSeqs: ReadonlySet<number>): T[] {
  return rows.filter(
    (r) =>
      r.isFinal !== false &&
      !sentSeqs.has(r.seq) &&
      Boolean(r.sourceText.trim() || r.targetText.trim()),
  );
}

/**
 * 저장 요청을 상한에 맞춰 자른다.
 *
 * 서버 스키마가 배열 길이를 막고 있어서, 넘겨 보내면 요청 **전체**가 400으로 튕긴다.
 * 한 줄도 저장되지 않으므로 오래 말한 세션일수록 크게 잃는다 — 그래서 자르는 쪽이 항상 낫다.
 */
export function chunkForSave<T>(rows: T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be positive');
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
