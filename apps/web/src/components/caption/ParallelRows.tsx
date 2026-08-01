'use client';

import { memo } from 'react';
import type { EngineSegment } from '@sotong/shared/engine';

/**
 * 아직 짝이 안 지어진 구간 — **번역 중심 한 흐름**으로 흘린다 (사용자 지시 2026-08-02).
 *
 * 예전엔 좌우(넓은 화면)·위아래 두 블록(좁은 화면)으로 원문·번역을 갈라 보여줬는데,
 * 그러면 원문(자동감지, 잡음 포함)이 한 덩어리로 쌓여 번역을 밀어냈다.
 * 이제 원문·번역을 시간순으로 섞되 **번역은 크고 밝게, 원문은 작게** — 새로 흐르는 중심이
 * 늘 번역이 되게 한다. 정렬기가 따라잡으면 위쪽 '짝지어진 줄'로 옮겨가며 이 자리는 비워진다.
 */
export const ParallelRows = memo(function ParallelRows({
  target,
  source,
  scale,
  mergingSeqs,
}: {
  target: EngineSegment[];
  source: EngineSegment[];
  scale: number;
  /** (미사용) 예전 좌우 병합 애니메이션용 — 인터페이스 유지 */
  targetLabel?: string;
  sourceLabel?: string;
  mergingSeqs?: ReadonlySet<number>;
}) {
  if (target.length === 0 && source.length === 0) return null;

  const merged = [
    ...target.map((s) => ({
      key: `t${s.seq}`,
      seq: s.seq,
      kind: 't' as const,
      text: s.targetText,
      isFinal: s.isFinal,
    })),
    ...source.map((s) => ({
      key: `s${s.seq}`,
      seq: s.seq,
      kind: 's' as const,
      text: s.sourceText,
      isFinal: true,
    })),
  ]
    .filter((m) => m.text.trim())
    .sort((a, b) => a.seq - b.seq);

  return (
    <div className="flex flex-col gap-2">
      {merged.map((m) =>
        m.kind === 't' ? (
          <p
            key={m.key}
            className={`font-semibold tracking-tight text-caption-target ${
              m.isFinal ? '' : 'caption-caret'
            } ${mergingSeqs?.has(m.seq) ? 'row-merging row-merging-left' : 'line-in-target'}`}
            style={{ fontSize: `calc(clamp(14px, 3.3vw, 20px) * ${scale})`, lineHeight: 1.4 }}
          >
            {m.text}
          </p>
        ) : (
          <p
            key={m.key}
            className={`text-caption-source ${
              mergingSeqs?.has(m.seq) ? 'row-merging row-merging-right' : 'line-in-source'
            }`}
            style={{ fontSize: `calc(clamp(12px, 2.7vw, 14px) * ${scale})`, lineHeight: 1.5 }}
          >
            {m.text}
          </p>
        ),
      )}
    </div>
  );
});
