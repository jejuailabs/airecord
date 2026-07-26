'use client';

import { useEffect } from 'react';
import { useRouter } from '@/i18n/navigation';

/** 요약은 종료 직후 백그라운드로 만들어진다 — 준비될 때까지 몇 초 간격으로 갱신한다 */
export function SummaryRefresher({ intervalMs = 4000, maxTries = 10 }) {
  const router = useRouter();
  useEffect(() => {
    let tries = 0;
    const id = setInterval(() => {
      tries += 1;
      router.refresh();
      if (tries >= maxTries) clearInterval(id);
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs, maxTries]);
  return null;
}
