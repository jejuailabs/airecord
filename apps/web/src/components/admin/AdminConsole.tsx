'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Building2,
  Clock,
  Infinity as InfinityIcon,
  Loader2,
  Radio,
  Users,
  Wallet,
} from 'lucide-react';
import type { AdminOverview, AdminUserRow, UsageLogRow } from '@/lib/server/admin-query';

/**
 * 운영 콘솔 (docs/06 §2.6).
 *
 * 원가·마진은 유저에게 보여주지 않는다 — 여기가 그걸 보는 유일한 화면이다 (docs/06 §3).
 *
 * 무제한 토글은 **슈퍼관리자만** 보인다. 일반 관리자에게는 아예 그리지 않는다 —
 * 눌렀다가 403을 보는 것보다, 없는 게 낫다.
 */
const fmt = (n: number) => n.toLocaleString('ko-KR');

function Stat({
  icon,
  label,
  value,
  sub,
  warn,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-1.5 rounded-xl border p-4 ${
        warn ? 'border-warn/40 bg-warn/10' : 'border-border bg-bg-raised'
      }`}
    >
      <span className="flex items-center gap-1.5 text-[12.5px] font-semibold uppercase tracking-wide text-text-muted">
        <span aria-hidden className={warn ? 'text-warn' : 'text-accent'}>
          {icon}
        </span>
        {label}
      </span>
      <span className="tabular text-[26px] font-bold leading-none">{value}</span>
      {sub ? <span className="text-[12.5px] text-text-faint">{sub}</span> : null}
    </div>
  );
}

/** 일별 추이 — 라이브러리 없이 막대만. 여기서 필요한 건 추세 하나다. */
function DailyBars({ daily }: { daily: AdminOverview['daily'] }) {
  const max = Math.max(1, ...daily.map((d) => d.minutes));
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-bg-raised p-4">
      <span className="text-[12.5px] font-semibold uppercase tracking-wide text-text-muted">
        일별 통역 시간 (최근 14일)
      </span>
      <div className="flex h-28 items-end gap-1">
        {daily.map((d) => (
          <div key={d.day} className="group relative flex flex-1 flex-col justify-end">
            <div
              className="rounded-t bg-accent/70 transition-colors group-hover:bg-accent"
              style={{ height: `${Math.max(2, (d.minutes / max) * 100)}%` }}
            />
            <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-bg-sunken px-1.5 py-0.5 text-[11px] group-hover:block">
              {d.day.slice(5)} · {fmt(d.minutes)}분
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminConsole() {
  const [data, setData] = useState<{
    overview: AdminOverview;
    users: AdminUserRow[];
    usageLog: UsageLogRow[];
    isSuper: boolean;
    flags?: { faceoffSingle: boolean };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [busyFlag, setBusyFlag] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/admin/overview', { cache: 'no-store' });
      if (!res.ok) {
        setError(res.status === 404 ? 'no_access' : 'load_failed');
        return;
      }
      setData((await res.json()) as never);
      setError(null);
    } catch {
      setError('load_failed');
    } finally {
      // 데이터가 그대로여도 버튼이 "돌았다"는 게 보이게 최소 시간을 준다
      setTimeout(() => setRefreshing(false), 350);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 무제한 토글 — 응답을 받고 나서야 목록을 새로 읽는다(낙관적 갱신 금지, 돈이 걸린 값이다) */
  const setFlag = async (uid: string, patch: { unlimited?: boolean; overageEnabled?: boolean }) => {
    setBusyUid(uid);
    try {
      const res = await fetch(`/api/admin/users/${uid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? 'update_failed');
        return;
      }
      await load();
    } finally {
      setBusyUid(null);
    }
  };

  /** 전역 실험 플래그 토글 (슈퍼관리자 전용). 응답 후 다시 읽는다. */
  const setAppFlag = async (patch: { faceoffSingle?: boolean }) => {
    setBusyFlag(true);
    try {
      const res = await fetch('/api/admin/flags', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? 'update_failed');
        return;
      }
      await load();
    } finally {
      setBusyFlag(false);
    }
  };

  if (error === 'no_access') {
    return <p className="py-20 text-center text-text-muted">접근 권한이 없습니다.</p>;
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-text-muted">
        <Loader2 size={18} className="animate-spin" aria-hidden />
        불러오는 중…
      </div>
    );
  }

  const o = data.overview;
  const rows = q.trim()
    ? data.users.filter((u) =>
        `${u.email ?? ''} ${u.name ?? ''} ${u.workspaceName ?? ''}`
          .toLowerCase()
          .includes(q.trim().toLowerCase()),
      )
    : data.users;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">운영 콘솔</h1>
          <p className="mt-0.5 text-[14px] text-text-muted">
            {data.isSuper ? '슈퍼관리자' : '관리자 (열람 전용)'}
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={refreshing}
          className="flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-[14px] font-semibold text-text-muted hover:text-text disabled:opacity-60"
        >
          {refreshing ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
          새로고침
        </button>
      </div>

      {error && error !== 'no_access' ? (
        <div className="flex items-center gap-2 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-[14px]">
          <AlertTriangle size={16} aria-hidden className="text-warn" />
          {error === 'super_admin_required'
            ? '무제한 설정은 슈퍼관리자만 변경할 수 있습니다.'
            : '요청이 실패했습니다.'}
        </div>
      ) : null}

      {/* 지표 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Users size={14} />} label="회원" value={fmt(o.users)} sub={`워크스페이스 ${fmt(o.workspaces)}`} />
        <Stat
          icon={<Clock size={14} />}
          label="누적 통역"
          value={`${fmt(o.billedMinutes)}분`}
          sub={`최근 30일 ${fmt(o.billedMinutes30d)}분`}
        />
        <Stat
          icon={<Activity size={14} />}
          label="세션"
          value={fmt(o.sessions.total)}
          sub={`대면 ${fmt(o.sessions.inperson)} · 회의 ${fmt(o.sessions.meeting)}`}
        />
        <Stat
          icon={<Radio size={14} />}
          label="진행 중"
          value={fmt(o.liveSessions)}
          sub={o.liveSessions > 0 ? '지금 과금되는 중' : '없음'}
          warn={o.liveSessions > 0}
        />
        <Stat
          icon={<Wallet size={14} />}
          label="추정 원가 (30일)"
          value={o.estCostKrw > 0 ? `₩${fmt(o.estCostKrw)}` : '미설정'}
          sub={o.estCostKrw > 0 ? 'mode별 단가 반영' : '원가 환경변수 없음'}
        />
        <Stat
          icon={<InfinityIcon size={14} />}
          label="무제한 계정"
          value={fmt(o.unlimitedWorkspaces)}
          sub={o.unlimitedWorkspaces > 0 ? '한도 없이 사용 중' : '없음'}
          warn={o.unlimitedWorkspaces > 0}
        />
        <div className="col-span-2">
          <DailyBars daily={o.daily} />
        </div>
      </div>

      {/* 테스트 기능 — 실험 플래그. 슈퍼관리자만 켜고 끈다. */}
      <div className="flex flex-col gap-3 rounded-xl border border-warn/40 bg-warn/5 p-5">
        <h2 className="flex items-center gap-2 text-[18px] font-semibold">
          <AlertTriangle size={17} aria-hidden className="text-warn" />
          테스트 기능
          <span className="rounded-sm bg-warn/20 px-1.5 py-0.5 text-[11px] font-semibold text-warn">
            실험
          </span>
        </h2>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg-raised px-4 py-3">
          <div className="min-w-0">
            <div className="font-semibold">마주 1세션 (턴 방식)</div>
            <p className="mt-0.5 text-[13px] text-text-muted">
              한 번에 한 방향만 통역한다. 음성 겹침·언어 혼란이 없고 토큰도 절반이지만,
              말할 차례를 버튼으로 넘겨야 한다. 켜면 마주 화면에 「1세션」 선택지가 뜬다.
            </p>
            {/* 이 테스트가 얼마나 소비됐는지만 가볍게 — 원가 판정은 하지 않는다 */}
            <p className="mt-1.5 text-[12.5px] text-text-faint">
              지금까지 이 테스트로{' '}
              <span className="font-semibold text-text-muted">{fmt(o.singleTest.sessions)}회</span>
              {' · 총 '}
              <span className="font-semibold text-text-muted">{fmt(o.singleTest.minutes)}분</span>
              {' 통역됨'}
            </p>
          </div>
          {data.isSuper ? (
            <button
              onClick={() => void setAppFlag({ faceoffSingle: !data.flags?.faceoffSingle })}
              disabled={busyFlag}
              className={`flex h-9 shrink-0 items-center gap-2 rounded-lg px-4 text-[13px] font-semibold transition-colors disabled:opacity-60 ${
                data.flags?.faceoffSingle
                  ? 'bg-accent text-accent-text'
                  : 'border border-border text-text-muted hover:text-text'
              }`}
            >
              {busyFlag ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
              {data.flags?.faceoffSingle ? '켜짐' : '꺼짐'}
            </button>
          ) : (
            <span className="shrink-0 text-[13px] text-text-faint">
              {data.flags?.faceoffSingle ? '켜짐' : '꺼짐'} · 슈퍼관리자만 변경
            </span>
          )}
        </div>
      </div>

      {/* 회원 */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[18px] font-semibold">
            <Building2 size={17} aria-hidden className="text-accent" />
            회원 {fmt(rows.length)}
            {rows.length !== data.users.length ? (
              <span className="text-[14px] font-normal text-text-faint">/ {fmt(data.users.length)}</span>
            ) : null}
          </h2>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이메일·이름 검색"
            className="h-10 w-full rounded-lg border border-border bg-bg-raised px-3 text-[14px] sm:w-64"
          />
        </div>

        <div className="overflow-x-auto rounded-xl border border-border bg-bg-raised">
          <table className="w-full min-w-[720px] text-[14px]">
            <thead>
              <tr className="border-b border-border text-left text-[12px] uppercase tracking-wide text-text-muted">
                <th className="px-4 py-3 font-semibold">회원</th>
                <th className="px-4 py-3 font-semibold">플랜</th>
                <th className="px-4 py-3 font-semibold">사용량</th>
                <th className="px-4 py-3 font-semibold">가입</th>
                <th className="px-4 py-3 text-right font-semibold">무제한</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.uid} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-semibold">{u.email ?? u.uid}</div>
                    <div className="text-[12.5px] text-text-faint">
                      {u.name ?? '—'}
                      {u.role === 'admin' ? (
                        <span className="ml-2 rounded-sm bg-accent-weak px-1.5 py-0.5 text-[11px] font-semibold text-accent">
                          관리자
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {u.plan}
                    {u.overageEnabled ? (
                      <span className="ml-2 text-[12px] text-text-faint">초과허용</span>
                    ) : null}
                  </td>
                  <td className="tabular px-4 py-3">
                    {u.unlimited ? (
                      <span className="text-accent">{fmt(u.usedMinutes)}분 / 무제한</span>
                    ) : (
                      <span className={u.usedMinutes >= u.includedMinutes ? 'text-warn' : ''}>
                        {fmt(u.usedMinutes)} / {fmt(u.includedMinutes)}분
                      </span>
                    )}
                  </td>
                  <td className="tabular px-4 py-3 text-text-faint">
                    {u.createdAtMs ? new Date(u.createdAtMs).toLocaleDateString('ko-KR') : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {data.isSuper ? (
                      <button
                        onClick={() => void setFlag(u.uid, { unlimited: !u.unlimited })}
                        disabled={busyUid === u.uid}
                        className={`h-9 rounded-lg px-3 text-[13px] font-bold disabled:opacity-60 ${
                          u.unlimited
                            ? 'bg-accent text-white'
                            : 'border border-border text-text-muted hover:text-text'
                        }`}
                      >
                        {busyUid === u.uid ? '…' : u.unlimited ? '해제' : '부여'}
                      </button>
                    ) : (
                      <span className="text-[13px] text-text-faint">{u.unlimited ? '켜짐' : '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-text-muted">
                    해당하는 회원이 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* 사용 로그 — 날짜 × 계정 × mode별 분 + 추정 원가 */}
      <div className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-[18px] font-semibold">
          <Wallet size={17} aria-hidden className="text-accent" />
          사용 로그 <span className="text-[14px] font-normal text-text-faint">최근 30일</span>
        </h2>
        <div className="overflow-x-auto rounded-xl border border-border bg-bg-raised">
          <table className="w-full min-w-[720px] text-[14px]">
            <thead>
              <tr className="border-b border-border text-left text-[12px] uppercase tracking-wide text-text-muted">
                <th className="px-4 py-3 font-semibold">날짜</th>
                <th className="px-4 py-3 font-semibold">계정</th>
                <th className="px-4 py-3 text-right font-semibold">대면</th>
                <th className="px-4 py-3 text-right font-semibold">회의</th>
                <th className="px-4 py-3 text-right font-semibold">마주</th>
                <th className="px-4 py-3 text-right font-semibold">합계</th>
                <th className="px-4 py-3 text-right font-semibold">추정 원가</th>
              </tr>
            </thead>
            <tbody>
              {data.usageLog.map((r) => (
                <tr key={`${r.day}-${r.workspaceId}`} className="border-b border-border last:border-0">
                  <td className="tabular px-4 py-2.5 text-text-muted">{r.day}</td>
                  <td className="px-4 py-2.5">{r.workspaceName ?? r.workspaceId.slice(0, 8)}</td>
                  <td className="tabular px-4 py-2.5 text-right">{r.inpersonMin || '—'}</td>
                  <td className="tabular px-4 py-2.5 text-right">{r.meetingMin || '—'}</td>
                  <td className="tabular px-4 py-2.5 text-right">{r.faceoffMin || '—'}</td>
                  <td className="tabular px-4 py-2.5 text-right font-semibold">{r.totalMin}분</td>
                  <td className="tabular px-4 py-2.5 text-right text-text-muted">
                    {r.estCostKrw > 0 ? `₩${fmt(r.estCostKrw)}` : '—'}
                  </td>
                </tr>
              ))}
              {data.usageLog.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-text-muted">
                    아직 사용 기록이 없습니다. 세션이 끝나면 여기 날짜별로 쌓입니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
