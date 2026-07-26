'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDown } from 'lucide-react';
import type { EngineSegment } from '@sotong/shared/engine';
import { SegmentRow } from './SegmentRow';

const MAX_DOM_SEGMENTS = 400; // 세그먼트 500 초과 대비 — 오래된 것은 DOM에서 뺀다 (docs/04 §3)
const TICK_MS = 30_000;       // 타임 레일 눈금 주기 (docs/05 §1)

function fmtMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export interface CaptionPanelProps {
  segments: EngineSegment[];
  scale: number;
  showSource?: boolean;
  live: boolean;
}

/**
 * 자막 패널 (docs/05 §4 — 가장 중요한 컴포넌트).
 * 배경은 테마와 무관하게 항상 어둡다. 왼쪽에 타임 레일이 흐른다.
 * 자동 스크롤은 rAF 안에서 하되, 유저가 위로 스크롤했으면 따라가지 않는다.
 */
export function CaptionPanel({ segments, scale, showSource = true, live }: CaptionPanelProps) {
  const t = useTranslations('live.running');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  const visible = segments.slice(-MAX_DOM_SEGMENTS);
  const omitted = segments.length - visible.length;
  const last = visible[visible.length - 1];

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }, []);

  useEffect(() => {
    if (!pinned) return;
    const el = scrollRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [pinned, segments.length, last?.targetText, last?.sourceText]);

  const jumpToLatest = () => {
    setPinned(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  // 타임 레일 눈금: 세그먼트 startMs가 30초 경계를 넘을 때 삽입
  const rows: React.ReactNode[] = [];
  let prevTickBucket = visible.length > 0 ? Math.floor((visible[0]?.startMs ?? 0) / TICK_MS) : 0;
  for (const seg of visible) {
    const bucket = Math.floor(seg.startMs / TICK_MS);
    if (bucket > prevTickBucket) {
      prevTickBucket = bucket;
      rows.push(
        <div key={`tick-${bucket}`} className="relative flex items-center gap-2 py-1">
          <span className="absolute -left-[22px] h-px w-3 bg-[color:var(--caption-source)] opacity-60" />
          <span className="tabular text-[11px] font-medium text-caption-source">
            {fmtMs(bucket * TICK_MS)}
          </span>
          <span className="h-px flex-1 bg-[color:var(--caption-source)] opacity-20" />
        </div>,
      );
    }
    rows.push(<SegmentRow key={seg.seq} seg={seg} scale={scale} showSource={showSource} />);
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-caption-bg">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        aria-live="polite"
        className="min-h-0 flex-1 overflow-y-auto px-6 py-4"
      >
        <div className="relative ml-6 border-l border-[color:var(--caption-source)]/30 pl-4">
          {omitted > 0 ? (
            <p className="py-2 text-[11px] text-caption-source">{t('omitted', { count: omitted })}</p>
          ) : null}
          {rows.length > 0 ? (
            rows
          ) : (
            <p className="py-10 text-[15px] text-caption-source">{t('waitingSpeech')}</p>
          )}
          {/* 라이브 중 타임 레일 현재 위치 점 (docs/05 §1) */}
          {live ? (
            <span
              aria-hidden
              className="live-dot absolute -left-[5px] bottom-1 h-2.5 w-2.5 rounded-full bg-accent"
            />
          ) : null}
        </div>
      </div>

      {!pinned ? (
        <button
          onClick={jumpToLatest}
          className="absolute bottom-4 right-4 flex h-9 items-center gap-1.5 rounded-md bg-bg-raised px-3 text-sm text-text shadow-token"
        >
          <ArrowDown size={14} aria-hidden />
          {t('latest')}
        </button>
      ) : null}
    </div>
  );
}
