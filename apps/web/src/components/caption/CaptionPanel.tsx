'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDown } from 'lucide-react';
import type { EngineSegment } from '@sotong/shared/engine';
import { SegmentRow } from './SegmentRow';
import { ParallelRows } from './ParallelRows';

const MAX_DOM_SEGMENTS = 400; // 세그먼트 500 초과 대비 — 오래된 것은 DOM에서 뺀다 (docs/04 §3)
const TICK_MS = 30_000;       // 타임 레일 눈금 주기 (docs/05 §1)

function fmtMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export interface CaptionPanelProps {
  /** 정렬기가 짝지어 합친 줄들 — 원문·번역이 한 줄에 같이 온다 */
  segments: EngineSegment[];
  scale: number;
  showSource?: boolean;
  live: boolean;
  /**
   * 아직 짝이 안 지어진 구간. 정렬기가 따라잡으면 위 segments로 옮겨간다.
   * 실시간성은 이쪽이 담당한다 — 정렬을 기다리느라 자막이 늦어지면 안 된다.
   */
  pendingTarget?: EngineSegment[];
  pendingSource?: EngineSegment[];
  parallelLabels?: { target: string; source: string };
  /** 지금 가운데로 빨려드는 중인(곧 짝지어질) 줄 번호 */
  mergingSeqs?: ReadonlySet<number>;
  /** 방금 짝지어져 올라온 줄 번호 */
  justPairedSeqs?: ReadonlySet<number>;
}

/**
 * 자막 패널 (docs/05 §4 — 가장 중요한 컴포넌트).
 * 배경은 테마와 무관하게 항상 어둡다. 왼쪽에 타임 레일이 흐른다.
 * 자동 스크롤은 rAF 안에서 하되, 유저가 위로 스크롤했으면 따라가지 않는다.
 */
export function CaptionPanel({
  segments,
  scale,
  showSource = true,
  live,
  pendingTarget = [],
  pendingSource = [],
  parallelLabels,
  mergingSeqs,
  justPairedSeqs,
}: CaptionPanelProps) {
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
  }, [
    pinned,
    segments.length,
    last?.targetText,
    last?.sourceText,
    // 정렬 안 된 구간이 자라도 아래로 따라간다 — 실시간 자막은 이쪽에서 나온다
    pendingTarget.length,
    pendingTarget[pendingTarget.length - 1]?.targetText,
    pendingSource.length,
  ]);

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
    rows.push(
      <SegmentRow
        key={seg.seq}
        seg={seg}
        scale={scale}
        showSource={showSource}
        sameLangLabel={t('sameLanguage')}
        justPaired={justPairedSeqs?.has(seg.seq)}
      />,
    );
  }

  return (
    /**
     * 모바일·데스크톱 공통 레이아웃 (사용자 지시 2026-08-01):
     *   위에서부터 **매칭된 짝**(SegmentRow: 번역 크게 + 원문 아래로 한 묶음)을 흐름으로 보여주고,
     *   아직 짝이 안 지어진 최신 몇 줄만 아래에 병렬(ParallelRows, 좁은 화면은 세로로 쌓임)로 둔다.
     *   예전엔 좁은 화면을 2분할(StackedPanes)로 갈라 매칭을 안 보여줬는데, 이제 모바일도 데스크톱처럼
     *   매칭된 내용을 위에서 본다. 한 흐름이라 세로 공간도 더 넉넉히 쓴다.
     *
     * ⚠ min-h를 너무 크게 잡으면(예전 58vh) 모바일에서 컨트롤까지 합한 높이가 화면을 넘겨
     * 페이지가 스크롤되고 "소리 켜기" 안내가 밀려난다. flex-1이 남는 높이를 채우므로 바닥값만 둔다.
     */
    <div className="relative flex min-h-[38vh] flex-1 flex-col overflow-hidden rounded-xl bg-caption-bg">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        aria-live="polite"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-8 sm:py-6"
      >
        <div className="relative ml-2 border-l border-[color:var(--caption-source)]/30 pl-4 sm:ml-6 sm:pl-6">
          {omitted > 0 ? (
            <p className="py-2 text-[13px] text-caption-source">{t('omitted', { count: omitted })}</p>
          ) : null}
          {rows}

          {/*
            아직 짝이 안 지어진 구간 — 좌우 병렬.
            정렬기가 따라잡으면 위쪽 짝지어진 줄로 옮겨가며 이 자리는 비워진다.
          */}
          {pendingTarget.length > 0 || pendingSource.length > 0 ? (
            <div className="py-4">
              <ParallelRows
                target={pendingTarget}
                source={pendingSource}
                mergingSeqs={mergingSeqs}
                scale={scale}
                targetLabel={parallelLabels?.target ?? ''}
                sourceLabel={parallelLabels?.source ?? ''}
              />
            </div>
          ) : null}

          {rows.length === 0 && pendingTarget.length === 0 && pendingSource.length === 0 ? (
            <p className="py-12 text-[22px] text-caption-source">{t('waitingSpeech')}</p>
          ) : null}
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
