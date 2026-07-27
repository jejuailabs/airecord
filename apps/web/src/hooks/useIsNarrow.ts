'use client';

import { useEffect, useState } from 'react';

/**
 * 좁은 화면(모바일) 여부.
 *
 * ⚠ 서버 렌더 때는 항상 false로 시작한다. 여기서 추측해 true를 내면 하이드레이션이 어긋난다.
 * 마운트 직후 실제 폭으로 정정한다 — 한 프레임 늦지만 어긋나는 것보다 낫다.
 */
export function useIsNarrow(query = '(max-width: 639px)'): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);

  return narrow;
}
