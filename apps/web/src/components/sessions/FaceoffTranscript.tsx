'use client';

import { useMemo, useState } from 'react';

/**
 * 마주통역 전체 보기 — 화자별 색 구분 + 화자별 필터.
 *
 * 마주통역 기록은 발화마다 speaker(A=내 쪽 / B=맞은편)를 함께 저장한다.
 * 그래서 타임스탬프 순 대화로 보여주되 화자를 색으로 가르고,
 * 버튼으로 한쪽만 모아 볼 수 있다.
 */
interface Seg {
  seq: number;
  startMs: number;
  sourceText: string;
  targetText: string;
  speaker: 'A' | 'B' | null;
}

function fmtMs(ms: number) {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function FaceoffTranscript({ segments }: { segments: Seg[] }) {
  const [filter, setFilter] = useState<'all' | 'A' | 'B'>('all');

  const ordered = useMemo(
    () => [...segments].sort((a, b) => a.startMs - b.startMs || a.seq - b.seq),
    [segments],
  );
  const shown = filter === 'all' ? ordered : ordered.filter((s) => s.speaker === filter);

  const Btn = ({ v, label }: { v: 'all' | 'A' | 'B'; label: string }) => (
    <button
      type="button"
      onClick={() => setFilter(v)}
      className={`h-9 rounded-lg px-3 text-[13.5px] font-semibold transition-colors ${
        filter === v
          ? 'bg-accent text-white'
          : 'border border-border text-text-muted hover:text-text'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Btn v="all" label="전체" />
        <Btn v="A" label="내 쪽 (A)" />
        <Btn v="B" label="맞은편 (B)" />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-bg-raised">
        {shown.map((s) => {
          const isA = s.speaker === 'A';
          // 화자별 색: A는 accent 계열, B는 accent-2 계열. speaker 없으면 중립.
          const tone = isA
            ? 'border-l-accent bg-accent-weak/20'
            : s.speaker === 'B'
              ? 'border-l-accent-2 bg-accent-2/10'
              : 'border-l-border';
          return (
            <div
              key={s.seq}
              className={`flex gap-3 border-b border-border border-l-4 px-4 py-3.5 last:border-b-0 ${tone}`}
            >
              <div className="flex w-14 shrink-0 flex-col items-start gap-1 pt-0.5">
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                    isA ? 'bg-accent/15 text-accent' : s.speaker === 'B' ? 'bg-accent-2/15 text-accent-2' : 'text-text-faint'
                  }`}
                >
                  {isA ? 'A' : s.speaker === 'B' ? 'B' : '—'}
                </span>
                <span className="tabular text-[12px] text-text-faint">{fmtMs(s.startMs)}</span>
              </div>
              <div className="min-w-0">
                <p className="text-[16px] font-semibold leading-relaxed">{s.targetText}</p>
                {s.sourceText ? (
                  <p className="mt-1 text-[13.5px] leading-relaxed text-text-faint">{s.sourceText}</p>
                ) : null}
              </div>
            </div>
          );
        })}
        {shown.length === 0 ? (
          <p className="px-4 py-8 text-center text-text-muted">해당 화자의 발화가 없습니다.</p>
        ) : null}
      </div>
    </div>
  );
}
