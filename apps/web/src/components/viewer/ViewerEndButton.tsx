'use client';

import { useState } from 'react';
import { Loader2, Square } from 'lucide-react';

/**
 * 뷰어 화면의 통역 종료 버튼 (사용자 지시 2026-08-02 — 자막 창 위아래 양쪽).
 * 세션 주인에게만 렌더된다(서버가 소유자 확인 후 내려줌). 실수 방지로 2단계 확인.
 * 종료되면 LiveCaptions 폴링이 'ended'를 받아 화면 전체가 종료 상태로 바뀐다.
 */
export function ViewerEndButton({
  token,
  labels,
}: {
  token: string;
  labels: { end: string; confirm: string; ending: string; ended: string };
}) {
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'ending' | 'ended'>('idle');

  const doEnd = async () => {
    setPhase('ending');
    try {
      const res = await fetch(`/api/viewer/${token}/end`, { method: 'POST' });
      setPhase(res.ok ? 'ended' : 'idle');
    } catch {
      setPhase('idle');
    }
  };

  if (phase === 'ended') {
    return (
      <span className="flex h-9 items-center rounded-md bg-bg-raised px-3 text-[13.5px] font-semibold text-text-muted">
        {labels.ended}
      </span>
    );
  }
  if (phase === 'ending') {
    return (
      <span className="flex h-9 items-center gap-1.5 rounded-md bg-bg-raised px-3 text-[13.5px] font-semibold text-text-muted">
        <Loader2 size={14} aria-hidden className="animate-spin" />
        {labels.ending}
      </span>
    );
  }
  if (phase === 'confirm') {
    return (
      <button
        type="button"
        onClick={() => void doEnd()}
        onBlur={() => setPhase('idle')}
        className="flex h-9 items-center gap-1.5 rounded-md bg-danger px-3 text-[13.5px] font-bold text-white"
      >
        <Square size={13} aria-hidden fill="currentColor" />
        {labels.confirm}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setPhase('confirm')}
      className="flex h-9 items-center gap-1.5 rounded-md border border-danger/50 px-3 text-[13.5px] font-semibold text-danger transition-colors hover:bg-danger-weak"
    >
      <Square size={13} aria-hidden fill="currentColor" />
      {labels.end}
    </button>
  );
}
