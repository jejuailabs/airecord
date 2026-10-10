/**
 * 버려진 세션 청소를 요청 흐름에 끼워 넣는다.
 *
 * 크론이 없으므로 세션을 여는 요청(대면·마주·회의 시작)과 운영콘솔 조회 때 돌린다.
 * - 세션 시작에서는 응답 뒤(after)에 돌린다 — 밀린 세션이 많아도 통역 시작이 늦어지지 않게.
 * - 운영콘솔에서는 기다렸다가 조회한다 — 사용 로그에 빠진 세션이 없게.
 * 청소가 실패해도 본 요청은 막지 않는다.
 */
import { after } from 'next/server';
import { sweepStaleSessions, type LiveSessionRecord } from './session-store';
import { generateAndStoreSummary } from './summarize';

/**
 * 요약은 최근 세션만 새로 만든다.
 * 오래 버려졌던 세션까지 한꺼번에 요약하면 그만큼 gpt-5 호출이 몰린다 (첫 청소 때 수십 건).
 */
const SUMMARY_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

async function sweep(): Promise<LiveSessionRecord[]> {
  return sweepStaleSessions().catch((e) => {
    console.error('[sweep] failed', e);
    return [];
  });
}

async function summarize(billed: LiveSessionRecord[]): Promise<void> {
  const since = Date.now() - SUMMARY_WINDOW_MS;
  const targets = billed.filter((r) => r.uid && r.segmentCount > 0 && r.startedAtMs >= since);
  await Promise.all(targets.map((r) => generateAndStoreSummary(r.id, r.targetLang)));
}

/** 기다렸다가 끝낸다 (운영콘솔 조회 전). 요약은 응답을 붙잡지 않는다. */
export async function sweepAbandonedSessions(): Promise<void> {
  const billed = await sweep();
  if (billed.length > 0) after(() => summarize(billed));
}

/** 응답 뒤에 돌린다 (세션 시작 요청). */
export function sweepAbandonedSessionsLater(): void {
  after(async () => summarize(await sweep()));
}
