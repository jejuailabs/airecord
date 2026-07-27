'use client';

import { memo } from 'react';
import type { EngineSegment } from '@sotong/shared/engine';

/**
 * 아직 짝이 안 지어진 구간 — 원문과 번역을 좌우로 나란히 흘린다.
 *
 * 실시간에는 둘을 묶지 않는다(신뢰도가 다르다). 대신 각자 자기 속도로 흐르게 두고,
 * 정렬기가 따라잡으면 위쪽 '짝지어진 구간'으로 옮겨간다.
 * 좁은 화면에서는 좌우가 성립하지 않아 번역만 보여준다 — 원문은 정렬 후에 보인다.
 */
export const ParallelRows = memo(function ParallelRows({
  target,
  source,
  scale,
  targetLabel,
  sourceLabel,
  mergingSeqs,
}: {
  target: EngineSegment[];
  source: EngineSegment[];
  scale: number;
  targetLabel: string;
  sourceLabel: string;
  /** 지금 짝지어져 위로 올라가는 중인 줄 — 가운데로 빨려드는 모션을 준다 */
  mergingSeqs?: ReadonlySet<number>;
}) {
  if (target.length === 0 && source.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {/* 번역 — 통역 음성과 같은 생성물이라 가장 믿을 수 있다. 항상 보인다. */}
      <div className="flex flex-col gap-3">
        <span className="text-[11px] font-medium uppercase tracking-wide text-caption-source">
          {targetLabel}
        </span>
        {target.map((s) => (
          <p
            key={s.seq}
            className={`font-semibold tracking-tight text-caption-target ${
              s.isFinal ? '' : 'caption-caret'
            } ${mergingSeqs?.has(s.seq) ? 'row-merging row-merging-left' : ''}`}
            style={{ fontSize: `calc(clamp(14px, 3.3vw, 20px) * ${scale})`, lineHeight: 1.4 }}
          >
            {s.targetText}
          </p>
        ))}
      </div>

      {/* 원문 — 전사 레그가 굶으면 비어 있을 수 있다. 좁은 화면에서는 감춘다. */}
      <div className="hidden flex-col gap-3 sm:flex">
        <span className="text-[11px] font-medium uppercase tracking-wide text-caption-source">
          {sourceLabel}
        </span>
        {source.map((s) => (
          <p
            key={s.seq}
            className={`text-caption-source ${
              mergingSeqs?.has(s.seq) ? 'row-merging row-merging-right' : ''
            }`}
            style={{ fontSize: `calc(clamp(12px, 2.7vw, 14px) * ${scale})`, lineHeight: 1.5 }}
          >
            {s.sourceText}
          </p>
        ))}
      </div>
    </div>
  );
});
