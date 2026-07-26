'use client';

import { memo } from 'react';
import type { EngineSegment } from '@sotong/shared/engine';

export interface SegmentRowProps {
  seg: EngineSegment;
  /** 자막 크기 배율 — 보통 ×1.0 / 크게 ×1.3 / 아주 크게 ×1.7 */
  scale: number;
  showSource: boolean;
}

/**
 * 자막 세그먼트 한 덩어리 (docs/05 §4).
 * 번역문은 크고 밝고 굵게, 원문은 작고 흐리게 — 색이 아니라 무게·명도의 위계.
 *
 * 크기는 화면 폭에 따라 자동으로 줄고 늘어난다(clamp).
 * 고정 px로 두면 모바일에서 한 줄에 두세 글자만 보이고, 회의실 모니터에서는 너무 작다.
 */
export const SegmentRow = memo(
  function SegmentRow({ seg, scale, showSource }: SegmentRowProps) {
    return (
      <div className="flex flex-col gap-1.5 py-4">
        {seg.detectedLang ? (
          <span className="text-[12px] font-medium uppercase tracking-wide text-caption-source">
            {seg.detectedLang}
          </span>
        ) : null}
        <p
          className={`font-semibold tracking-tight text-caption-target ${
            seg.isFinal ? '' : 'caption-caret'
          }`}
          style={{
            fontSize: `calc(clamp(17px, 4.1vw, 25px) * ${scale})`,
            lineHeight: 1.4,
          }}
        >
          {seg.targetText || ' '}
        </p>
        {showSource && seg.sourceText ? (
          <p
            className="text-caption-source"
            style={{
              fontSize: `calc(clamp(13px, 3.1vw, 16px) * ${scale})`,
              lineHeight: 1.5,
            }}
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
    prev.seg.detectedLang === next.seg.detectedLang &&
    prev.scale === next.scale &&
    prev.showSource === next.showSource,
);
