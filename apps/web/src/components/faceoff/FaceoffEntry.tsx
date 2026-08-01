'use client';

import { useState } from 'react';
import { FaceoffInterpreter } from './FaceoffInterpreter';
import { FaceoffSingleInterpreter } from './FaceoffSingleInterpreter';

/**
 * 마주통역 진입점.
 *
 * 기본은 2세션(안정판)이다. 어드민이 '마주 1세션' 실험 플래그를 켜면(singleEnabled),
 * 상단에 방식 선택 토글이 뜨고 1세션(턴 방식)을 골라 돌려볼 수 있다.
 * 플래그가 꺼져 있으면 토글 자체가 없다 — 일반 사용자는 기존 화면 그대로다.
 */
export function FaceoffEntry({ singleEnabled }: { singleEnabled: boolean }) {
  const [mode, setMode] = useState<'classic' | 'single'>('classic');

  if (!singleEnabled) return <FaceoffInterpreter />;

  return (
    <div className="flex flex-col gap-4">
      {/* 라이브(fixed inset-0)로 들어가면 이 토글은 화면 아래로 가려진다 — setup에서만 보인다 */}
      <div className="mx-auto inline-flex rounded-full border border-border bg-bg-raised p-1 text-[13px]">
        <button
          onClick={() => setMode('classic')}
          className={`rounded-full px-4 py-1.5 font-semibold transition-colors ${
            mode === 'classic' ? 'bg-accent text-accent-text' : 'text-text-muted'
          }`}
        >
          기본 (2세션)
        </button>
        <button
          onClick={() => setMode('single')}
          className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 font-semibold transition-colors ${
            mode === 'single' ? 'bg-accent text-accent-text' : 'text-text-muted'
          }`}
        >
          1세션
          <span
            className={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold ${
              mode === 'single' ? 'bg-accent-text/20 text-accent-text' : 'bg-warn/15 text-warn'
            }`}
          >
            실험
          </span>
        </button>
      </div>
      {mode === 'single' ? <FaceoffSingleInterpreter /> : <FaceoffInterpreter />}
    </div>
  );
}
