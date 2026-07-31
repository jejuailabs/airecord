'use client';

import { useEffect, useRef, useState } from 'react';
import { Radio } from 'lucide-react';

/**
 * 회의 자막 뷰어 (docs/06 §2.4).
 *
 * 링크만으로 들어온 참가자가 보는 화면이다. 로그인 유도 없음, 조작 버튼 없음 — 읽기만.
 *
 * 새 줄만 이어 받는다(`after=마지막 seq`). 회의가 길어져 자막이 수천 줄이 되어도
 * 매번 전부 다시 받지 않는다.
 */
const POLL_MS = 2_000;
/** 화면에 남기는 최대 줄 수 — 무한히 쌓으면 폰에서 스크롤이 무거워진다 */
const MAX_ROWS = 300;

interface Row {
  seq: number;
  sourceText: string;
  targetText: string;
}

export function LiveCaptions({ token, labels }: {
  token: string;
  labels: { waiting: string; ended: string; invalid: string };
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<'live' | 'ended' | 'invalid'>('live');
  const lastSeq = useRef(-1);
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const res = await fetch(`/api/viewer/${token}?after=${lastSeq.current}`, {
          cache: 'no-store',
        });
        if (!alive) return;
        if (res.status === 404) {
          setStatus('invalid');
          return; // 폴링을 멈춘다 — 없는 토큰을 계속 두드릴 이유가 없다
        }
        if (res.ok) {
          const json = (await res.json()) as {
            status: string;
            segments: Array<{ seq: number; sourceText: string; targetText: string }>;
          };
          if (json.segments.length > 0) {
            lastSeq.current = json.segments[json.segments.length - 1]!.seq;
            setRows((prev) => [...prev, ...json.segments].slice(-MAX_ROWS));
          }
          setStatus(json.status === 'ended' ? 'ended' : 'live');
          // 끝난 회의는 한 번 더 받아 남은 줄을 채운 뒤 멈춘다
          if (json.status === 'ended' && json.segments.length === 0) return;
        }
      } catch {
        /* 네트워크 흔들림 — 다음 주기에 다시 시도한다 */
      }
      if (alive) timer = setTimeout(() => void tick(), POLL_MS);
    };

    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [token]);

  // 새 줄이 오면 아래로 따라간다
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [rows.length]);

  if (status === 'invalid') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg bg-caption-bg p-8 text-center">
        <p className="text-[17px] font-semibold text-caption-target">{labels.invalid}</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg bg-caption-bg p-8 text-center">
        <Radio size={28} aria-hidden className="animate-pulse text-caption-source" />
        <p className="text-[17px] font-semibold text-caption-target">
          {status === 'ended' ? labels.ended : labels.waiting}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto rounded-lg bg-caption-bg p-4">
      {rows.map((r) => (
        <div key={r.seq} className="flex flex-col gap-0.5">
          <p className="text-[19px] font-semibold leading-relaxed text-caption-target">
            {r.targetText}
          </p>
          {r.sourceText ? (
            <p className="text-[14px] leading-relaxed text-caption-source">{r.sourceText}</p>
          ) : null}
        </div>
      ))}
      {status === 'ended' ? (
        <p className="py-2 text-center text-[13px] text-caption-source">{labels.ended}</p>
      ) : null}
      <div ref={bottom} />
    </div>
  );
}
