/**
 * 저장된 자막 줄 → 보여줄 스크립트 재구성.
 *
 * 저장본에는 세 종류가 섞여 있다:
 *   paired  — 정렬기가 원문·번역을 짝지은 줄
 *   target  — 번역만 있는 줄 (짝을 못 찾았거나 원문이 안 온 구간)
 *   source  — 원문만 있는 줄
 *
 * 짝지어진 줄은 나란히, 못 지은 줄은 **연속된 것끼리 묶어 좌우 병렬 블록**으로 보여준다.
 * 억지로 한 줄에 끼워 맞추지 않는다 — 그렇게 하다가 원문과 번역이 어긋나는 사고가 반복됐다.
 *
 * 기록 화면과 PDF가 같은 함수를 쓴다. 둘이 다르게 보이면 그것도 사고다.
 */
export interface ScriptSegmentInput {
  seq: number;
  startMs: number;
  sourceText: string;
  targetText: string;
  kind?: 'target' | 'source' | 'paired' | null;
}

export type ScriptBlock =
  | {
      type: 'paired';
      seq: number;
      startMs: number;
      sourceText: string;
      targetText: string;
    }
  | {
      type: 'parallel';
      seq: number;
      startMs: number;
      /** 번역만 있는 줄들 (위/왼쪽) */
      target: string[];
      /** 원문만 있는 줄들 (아래/오른쪽) */
      source: string[];
    };

/** 짝지어진 줄인가 — kind가 없던 옛 기록도 양쪽이 차 있으면 짝으로 본다 */
function isPaired(s: ScriptSegmentInput): boolean {
  if (s.kind === 'paired') return true;
  if (s.kind === 'target' || s.kind === 'source') return false;
  return Boolean(s.sourceText.trim() && s.targetText.trim());
}

export function buildScript(segments: ScriptSegmentInput[]): ScriptBlock[] {
  const rows = [...segments].sort((a, b) => a.seq - b.seq);
  const blocks: ScriptBlock[] = [];
  let bucket: Extract<ScriptBlock, { type: 'parallel' }> | null = null;

  const flush = () => {
    if (!bucket) return;
    if (bucket.target.length > 0 || bucket.source.length > 0) blocks.push(bucket);
    bucket = null;
  };

  for (const s of rows) {
    if (isPaired(s)) {
      flush();
      blocks.push({
        type: 'paired',
        seq: s.seq,
        startMs: s.startMs,
        sourceText: s.sourceText.trim(),
        targetText: s.targetText.trim(),
      });
      continue;
    }

    const target = s.targetText.trim();
    const source = s.sourceText.trim();
    if (!target && !source) continue;

    // 짝을 못 지은 줄은 연속된 것끼리 한 블록으로 묶는다
    bucket ??= { type: 'parallel', seq: s.seq, startMs: s.startMs, target: [], source: [] };
    if (target) bucket.target.push(target);
    if (source) bucket.source.push(source);
  }
  flush();

  return blocks;
}

/** 요약·검색에 쓸 평문 — 번역 본문만 이어 붙인다 */
export function scriptPlainText(segments: ScriptSegmentInput[]): string {
  return buildScript(segments)
    .map((b) => (b.type === 'paired' ? b.targetText : b.target.join(' ')))
    .filter(Boolean)
    .join('\n');
}
