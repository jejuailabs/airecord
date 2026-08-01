'use client';

import { useEffect, useState } from 'react';
import { AudioLines, Loader2 } from 'lucide-react';

/**
 * 세션 원본 발화 재생.
 *
 * 서명 재생 URL을 서버에서 받아 <audio>로 튼다. 녹음이 없으면 아무것도 안 보인다.
 * URL은 짧게 만료되므로 페이지를 열 때마다 새로 받는다(캐시하지 않는다).
 */
export function RecordingPlayer({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'none'>('loading');
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/sessions/${sessionId}/recording`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { url: null }))
      .then((j: { url: string | null }) => {
        if (!alive) return;
        if (j.url) {
          setUrl(j.url);
          setState('ready');
        } else {
          setState('none');
        }
      })
      .catch(() => alive && setState('none'));
    return () => {
      alive = false;
    };
  }, [sessionId]);

  if (state === 'none') return null; // 녹음 없음 — 조용히 숨긴다

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-bg-raised p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <AudioLines size={17} aria-hidden className="text-accent" />
        원본 음성
      </h2>
      {state === 'loading' ? (
        <div className="flex items-center gap-2 text-[14px] text-text-muted">
          <Loader2 size={15} className="animate-spin" aria-hidden />
          불러오는 중…
        </div>
      ) : url ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- 통역 원본 음성, 자막은 아래 스크립트가 대신한다
        <audio controls preload="none" src={url} className="w-full" />
      ) : null}
    </section>
  );
}
