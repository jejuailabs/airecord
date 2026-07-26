'use client';

import { memo } from 'react';
import type { EngineSegment } from '@sotong/shared/engine';

export interface SegmentRowProps {
  seg: EngineSegment;
  /** 자막 크기 배율 — ×1.0 / ×1.35 / ×1.75 (docs/05 §3) */
  scale: number;
  showSource: boolean;
}

/**
 * 자막 세그먼트 한 덩어리 (docs/05 §4).
 * 번역문은 크고 밝고 굵게, 원문은 작고 흐리게 — 색이 아니라 무게·명도의 위계.
 * 회의실 모니터에서 곁눈질로 읽히는 것이 기준이라 기본 크기를 크게 잡는다.
 * 확정 세그먼트는 memo로 리렌더를 차단한다 (docs/04 §3).
 */
export const SegmentRow = memo(
  function SegmentRow({ seg, scale, showSource }: SegmentRowProps) {
    return (
      <div className="flex flex-col gap-3 py-5">
        <p
          className={`max-w-[30ch] font-semibold tracking-tight text-caption-target ${
            seg.isFinal ? '' : 'caption-caret'
          }`}
          style={{ fontSize: `${56 * scale}px`, lineHeight: 1.3 }}
        >
          {seg.targetText || ' '}
        </p>
        {showSource && seg.sourceText ? (
          <p
            className="max-w-[46ch] text-caption-source"
            style={{ fontSize: `${26 * scale}px`, lineHeight: 1.45 }}
          >
            {seg.sourceText}
          </p>
        ) : null}
      </div>
    );
  },
  (prev, next) =>
    prev.seg.seq === next.seg.seq &&
    prev.seg.isFinal === next.seg.isFinal &&
    prev.seg.sourceText === next.seg.sourceText &&
    prev.seg.targetText === next.seg.targetText &&
    prev.scale === next.scale &&
    prev.showSource === next.showSource,
);
