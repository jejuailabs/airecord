'use client';

import { memo } from 'react';
import type { EngineSegment } from '@sotong/shared/engine';
import { guessScript } from '@sotong/shared/constants';

export interface SegmentRowProps {
  seg: EngineSegment;
  /** 자막 크기 배율 — 보통 ×1.0 / 크게 ×1.3 / 아주 크게 ×1.7 */
  scale: number;
  showSource: boolean;
  /** "같은 언어라 번역 없음" 배지 문구 */
  sameLangLabel: string;
  /** 방금 짝지어져 올라온 줄 — 양옆에서 모여 앉는 모션을 준다 */
  justPaired?: boolean;
}

/**
 * 자막 세그먼트 한 덩어리 (docs/05 §4).
 * 번역문은 크고 밝고 굵게, 원문은 작고 흐리게 — 색이 아니라 무게·명도의 위계.
 *
 * 크기는 화면 폭에 따라 자동으로 줄고 늘어난다(clamp).
 * 고정 px로 두면 모바일에서 한 줄에 두세 글자만 보이고, 회의실 모니터에서는 너무 작다.
 */
export const SegmentRow = memo(
  function SegmentRow({ seg, scale, showSource, sameLangLabel, justPaired }: SegmentRowProps) {
    const langBadge = seg.detectedLang ?? guessScript(seg.sourceText || seg.targetText);
    return (
      <div className={`flex flex-col gap-1.5 py-4 ${justPaired ? 'row-paired-in' : ''}`}>
        {/* 엔진이 언어 코드를 주지 않으므로 원문 문자로 추정해 표시한다 */}
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-caption-source">
          {langBadge}
          {/* 표시 언어와 같은 말이라 번역이 생성되지 않은 경우 — 원문 줄이 없는 이유를 밝힌다 */}
          {seg.sameAsTarget ? (
            <span className="rounded-sm bg-white/10 px-1.5 py-0.5 normal-case tracking-normal">
              {sameLangLabel}
            </span>
          ) : null}
        </span>
        <p
          className={`paired-target font-semibold tracking-tight text-caption-target ${
            seg.isFinal ? '' : 'caption-caret'
          }`}
          style={{
            fontSize: `calc(clamp(14px, 3.3vw, 20px) * ${scale})`,
            lineHeight: 1.4,
          }}
        >
          {/* 번역이 아직 없으면 원문을 주 자막으로 보여준다 — 빈 줄을 남기지 않는다 */}
          {seg.targetText || seg.sourceText || ' '}
        </p>
        {showSource && seg.sourceText && seg.targetText ? (
          <p
            className="paired-source text-caption-source"
            style={{
              fontSize: `calc(clamp(12px, 2.7vw, 14px) * ${scale})`,
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
    prev.seg.sameAsTarget === next.seg.sameAsTarget &&
    prev.scale === next.scale &&
    prev.showSource === next.showSource &&
    prev.justPaired === next.justPaired,
);
