'use client';

import { useEffect, useRef, useState } from 'react';
import { DEMO_LINES, TTS_LANG, type DemoLine } from '@/components/landing/demo-script';

export interface DemoSegmentState {
  line: DemoLine;
  srcShown: string;
  tgtShown: string;
  done: boolean;
}

const TICK_MS = 45;
const SRC_CHARS_PER_TICK = 1;
const TGT_CHARS_PER_TICK = 1;
/** 원문이 먼저 흐르고 번역이 한 박자 뒤에 따라온다 — 동시통역의 리듬 */
const TGT_DELAY_TICKS = 14;
const LINE_PAUSE_MS = 1600;
const MAX_VISIBLE = 3;

/**
 * 랜딩 자막 데모 재생기 — 스크립트를 부분 전사처럼 타이핑하고,
 * voice가 켜져 있으면 번역 완성 시 브라우저 TTS로 "AI 통역사 음성"을 재생한다.
 * prefers-reduced-motion이면 타이핑 없이 완성된 줄을 천천히 순환한다.
 */
export function useDemoPlayback(voiceOn: boolean) {
  const [segments, setSegments] = useState<DemoSegmentState[]>([]);
  const voiceRef = useRef(voiceOn);
  voiceRef.current = voiceOn;

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const speak = (line: DemoLine) => {
      if (!voiceRef.current || typeof speechSynthesis === 'undefined') return;
      const u = new SpeechSynthesisUtterance(line.tgt);
      u.lang = TTS_LANG[line.tgtLang];
      u.rate = 1.05;
      speechSynthesis.speak(u);
    };

    const pushVisible = (
      prev: DemoSegmentState[],
      next: DemoSegmentState,
    ): DemoSegmentState[] => {
      const idx = prev.findIndex((s) => s.line === next.line && !s.done);
      const arr = idx >= 0 ? [...prev.slice(0, idx), next, ...prev.slice(idx + 1)] : [...prev, next];
      return arr.slice(-MAX_VISIBLE);
    };

    let lineIdx = 0;

    const playLine = () => {
      if (cancelled) return;
      const line = DEMO_LINES[lineIdx % DEMO_LINES.length]!;
      lineIdx++;

      if (reduce) {
        setSegments((prev) =>
          pushVisible(prev, { line, srcShown: line.src, tgtShown: line.tgt, done: true }),
        );
        speak(line);
        timer = setTimeout(playLine, 3500);
        return;
      }

      let tick = 0;
      const srcLen = line.src.length;
      const tgtLen = line.tgt.length;
      const step = () => {
        if (cancelled) return;
        tick++;
        const srcCount = Math.min(srcLen, tick * SRC_CHARS_PER_TICK);
        const tgtCount = Math.min(
          tgtLen,
          Math.max(0, (tick - TGT_DELAY_TICKS) * TGT_CHARS_PER_TICK),
        );
        const done = srcCount >= srcLen && tgtCount >= tgtLen;
        setSegments((prev) =>
          pushVisible(prev, {
            line,
            srcShown: line.src.slice(0, srcCount),
            tgtShown: line.tgt.slice(0, tgtCount),
            done,
          }),
        );
        if (done) {
          speak(line);
          timer = setTimeout(playLine, LINE_PAUSE_MS);
        } else {
          timer = setTimeout(step, TICK_MS);
        }
      };
      step();
    };

    playLine();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    };
  }, []);

  // 음성 토글이 꺼지면 즉시 침묵
  useEffect(() => {
    if (!voiceOn && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }, [voiceOn]);

  return segments;
}
