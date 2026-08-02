/**
 * docs/03 §3 타입 정의.
 * Phase 1부터 이 스키마를 따른다 — 나중에 갈아엎지 않기 위해서 (core.md §5).
 *
 * Timestamp: Firestore Timestamp 의존을 shared에 끌고 오지 않기 위해
 * epoch milliseconds(number)로 통일한다. Firestore 경계(admin/client)에서 변환한다.
 */
export type TimestampMs = number;

/** 화면(UI) 언어 — 통역 언어와 완전히 별개 개념 (core.md §4, docs/06 §4.1) */
export type UiLocale = 'ko' | 'en' | 'ja' | 'zh-CN';

/** 통역 대상 언어. 엔진 지원 목록은 engine.supports()로 검사한다 — 하드코딩 금지 (docs/04 §2) */
export type LangCode =
  | 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'fr' | 'de' | 'pt' | 'it'
  | 'ru' | 'vi' | 'th' | 'id' | 'ar' | 'hi';

/**
 * 소스 언어 설정. 'auto'면 엔진이 발화 언어를 자동 감지한다.
 * 여러 언어(예: 한·영·일 혼합)가 한 세션에 섞여도 목적 언어 하나로 수렴시키는 것이
 * 기본 UX다 — 유저가 만지는 값은 목적 언어뿐 (core.md §3-1).
 */
export type SourceLangSetting = LangCode | 'auto';

// ── 사용자 ─────────────────────────────────────────
export interface User {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  uiLocale: UiLocale;              // 화면 언어 (통역 언어 아님!)
  theme: 'light' | 'dark' | 'system';
  defaultSourceLang?: SourceLangSetting; // 마지막 사용 언어쌍 기억 → 다음에 미리 채움
  defaultTargetLang?: LangCode;
  workspaceIds: string[];
  lastWorkspaceId?: string;
  createdAt: TimestampMs;
}

// ── 워크스페이스 (과금 단위) ────────────────────────
export type PlanId = 'free' | 'starter' | 'pro' | 'business';

export interface Workspace {
  id: string;
  name: string;
  ownerUid: string;
  emailDomain?: string;            // 회사 도메인 자동 합류용
  plan: PlanId;
  billing: {
    includedMinutes: number;
    usedMinutes: number;
    overageMinutes: number;
    cycleStart: TimestampMs;
    cycleEnd: TimestampMs;
    overageEnabled: boolean;       // false면 포함 분 소진 시 즉시 차단 (기본 false — docs/07 §5.3)
    hardCapMinutes?: number;
  };
  retentionDays: number;
  storeAudio: boolean;             // 기본 false (docs/08 §1)
  createdAt: TimestampMs;
}

export interface Member {
  uid: string;
  email: string;
  displayName: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: TimestampMs;
}

// ── 세션 (과금 대상 1회 통역) ───────────────────────
export type SessionMode = 'inperson' | 'meeting' | 'faceoff';
export type SessionStatus =
  | 'starting' | 'joining' | 'live' | 'degraded'
  | 'ended' | 'failed' | 'orphaned';

export type MeetingPlatform = 'zoom' | 'teams' | 'meet' | 'webex';

export interface Session {
  id: string;
  workspaceId: string;
  startedByUid: string;
  mode: SessionMode;
  status: SessionStatus;

  sourceLang: SourceLangSetting;
  targetLang: LangCode;

  title?: string;

  meeting?: {
    platform: MeetingPlatform;
    url: string;
    botId?: string;                // Recall.ai bot id
    joinError?: string;
  };

  viewerToken?: string;
  viewerTokenExpiresAt?: TimestampMs;

  engine: {
    provider: 'openai' | 'google';
    model: string;
    fellBackAt?: TimestampMs;
  };

  startedAt: TimestampMs;
  endedAt?: TimestampMs;
  lastHeartbeatAt?: TimestampMs;
  billedSeconds: number;
  degradedSeconds?: number;        // 과금 제외 구간 (docs/07 §5.2)
  segmentCount: number;

  cost?: {
    translateUsd: number;
    botUsd: number;
    totalUsd: number;
    rateSnapshot: { translatePerMin: number; botPerMin: number; usdKrw: number };
  };

  export?: { transcriptPath?: string; audioPath?: string };
  logIncomplete?: boolean;         // 저장 재시도 최종 실패 시 (docs/08 §1)
  createdAt: TimestampMs;
}

// ── 세그먼트 (자막 한 덩어리) ───────────────────────
// 부분 전사(isFinal: false)는 Firestore에 쓰지 않는다. 화면에만 그린다 (docs/03 §3).
export interface Segment {
  id: string;
  seq: number;                     // 순서 보장용 단조 증가
  startMs: number;                 // 세션 시작 기준 상대 시각
  endMs?: number;
  speaker?: string;
  /** 감지된 발화 언어 (auto 모드에서 엔진이 보고. 다국어 혼합 세션 분석용) */
  detectedLang?: string;
  sourceText: string;
  targetText: string;
  isFinal: boolean;
  createdAt: TimestampMs;
}

// ── 사용량 집계 ─────────────────────────────────────
export interface DailyUsage {
  date: string;                    // 'YYYY-MM-DD'
  workspaceId: string;
  minutesByMode: { inperson: number; meeting: number };
  sessionCount: number;
  costUsd: number;                 // 실원가 (유저 비노출)
  byUser: Record<string, number>;
}

// ── 자막 뷰어 토큰 ──────────────────────────────────
export interface ViewerToken {
  token: string;                   // 32자 랜덤 (URL-safe)
  sessionId: string;
  workspaceId: string;
  expiresAt: TimestampMs;
  revokedAt?: TimestampMs;
}
