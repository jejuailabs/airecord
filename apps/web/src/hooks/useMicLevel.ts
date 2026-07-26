'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 마이크 입력 레벨 미터 — 시작 전에 "소리가 들어오는지" 확인시켜 준다 (docs/06 §2.2).
 * 반환값은 0..1 RMS.
 */
export function useMicLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!stream) {
      setLevel(0);
      return;
    }
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += (buf[i] ?? 0) ** 2;
      setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      source.disconnect();
      void ctx.close();
    };
  }, [stream]);

  return level;
}
