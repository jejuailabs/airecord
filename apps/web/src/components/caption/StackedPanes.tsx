'use client';

import { useEffect, useRef } from 'react';
import type { EngineSegment } from '@sotong/shared/engine';

/**
 * 좁은 화면(모바일) 레이아웃 — 화면을 반으로 갈라 위는 번역, 아래는 원문.
 *
 * 왜 이렇게 하나:
 *  - 375px에 좌우 두 열을 넣으면 한 줄에 서너 글자만 들어가 읽을 수가 없다.
 *  - 한 목록에 이어 붙이면 새 자막이 쌓일 때 서로를 밀어내 한쪽이 화면 밖으로 나간다.
 *    각자 스크롤 영역을 가지면 양쪽 다 항상 최신이 보인다.
 *
 * 여기서는 짝짓기 결과를 따로 보여주지 않는다 — 언어별 흐름 두 개만 보여준다.
 * 정렬은 뒤에서 계속 돌고, 그 결과는 세션 기록과 넓은 화면에서 드러난다.
 */
function Pane({
  label,
  lines,
  scale,
  emphasis,
}: {
  label: string;
  lines: Array<{ seq: number; text: string; isFinal: boolean }>;
  scale: number;
  /** 번역 쪽은 크고 굵게 — 자막의 주인공이다 */
  emphasis: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const lastText = lines[lines.length - 1]?.text;

  useEffect(() => {
    const el = ref.current;
    if (!el || !pinnedRef.current) return;
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [lines.length, lastText]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <span className="shrink-0 px-4 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-caption-source">
        {label}
      </span>
      <div
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          // 유저가 위로 올려 읽는 중이면 따라가지 않는다
          pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 pb-3"
      >
        {lines.map((l) => (
          <p
            key={l.seq}
            className={
              emphasis
                ? `line-in-target font-semibold tracking-tight text-caption-target ${
                    l.isFinal ? '' : 'caption-caret'
                  }`
                : 'line-in-source text-caption-source'
            }
            style={{
              fontSize: emphasis
                ? `calc(clamp(15px, 4.4vw, 21px) * ${scale})`
                : `calc(clamp(12.5px, 3.4vw, 15px) * ${scale})`,
              lineHeight: emphasis ? 1.4 : 1.5,
            }}
          >
            {l.text}
          </p>
        ))}
      </div>
    </section>
  );
}

export function StackedPanes({
  paired,
  pendingTarget,
  pendingSource,
  scale,
  targetLabel,
  sourceLabel,
  emptyLabel,
}: {
  paired: EngineSegment[];
  pendingTarget: EngineSegment[];
  pendingSource: EngineSegment[];
  scale: number;
  targetLabel: string;
  sourceLabel: string;
  emptyLabel: string;
}) {
  // 짝지어진 줄도 각 언어 흐름에 그대로 합류시킨다 — 모바일에서는 언어별 타임라인이 전부다
  const targetLines = [
    ...paired.filter((s) => s.targetText.trim()).map((s) => ({ seq: s.seq, text: s.targetText, isFinal: true })),
    ...pendingTarget.map((s) => ({ seq: s.seq, text: s.targetText, isFinal: s.isFinal })),
  ].sort((a, b) => a.seq - b.seq);

  const sourceLines = [
    ...paired.filter((s) => s.sourceText.trim()).map((s) => ({ seq: s.seq, text: s.sourceText, isFinal: true })),
    ...pendingSource.map((s) => ({ seq: s.seq, text: s.sourceText, isFinal: true })),
  ].sort((a, b) => a.seq - b.seq);

  if (targetLines.length === 0 && sourceLines.length === 0) {
    return (
      <div className="flex min-h-[24vh] flex-1 items-center justify-center rounded-xl bg-caption-bg px-6">
        <p className="text-[20px] text-caption-source">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[24vh] flex-1 flex-col overflow-hidden rounded-xl bg-caption-bg">
      <Pane label={targetLabel} lines={targetLines} scale={scale} emphasis />
      {/* 반으로 가르는 선 — 위가 번역, 아래가 원문임을 눈으로 구분시킨다 */}
      <div className="mx-4 shrink-0 border-t border-[color:var(--caption-source)]/25" />
      <Pane label={sourceLabel} lines={sourceLines} scale={scale} emphasis={false} />
    </div>
  );
}
