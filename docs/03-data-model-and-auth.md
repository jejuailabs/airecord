# 03 — 데이터 모델 & 인증

> 선행 문서: `core.md`, `docs/01-architecture.md`
> **Phase 1에서도 이 타입 정의를 따른다.** 나중에 마이그레이션하지 않기 위해서다.

---

## 1. 인증 — Firebase Auth (Google 로그인 전용)

### 방식
- 클라이언트: `signInWithPopup(GoogleAuthProvider)`. 팝업 차단 환경 대비 `signInWithRedirect` 폴백.
- 서버: 로그인 성공 시 ID 토큰을 `/api/auth/session`으로 보내 **`__session` HttpOnly 쿠키**로 교환한다(유효기간 5일). RSC와 API 라우트는 이 쿠키를 Admin SDK로 검증한다.
- 미들웨어: `(app)` 그룹 경로는 쿠키 없으면 `/login`으로 리다이렉트. `/v/[token]`은 **인증 검사에서 제외**.

### 최초 로그인 시 자동 처리
1. `users/{uid}` 생성
2. 이메일 도메인이 공개 도메인(gmail.com 등)이 **아니고** 같은 도메인의 워크스페이스가 이미 있으면 → 가입 요청 상태로 연결 제안
3. 아니면 → 개인 워크스페이스 자동 생성, `role: 'owner'`, Free 플랜 부여
4. **유저에게 워크스페이스 개념을 처음부터 설명하지 않는다.** 혼자 쓰는 사람에게는 존재하지 않는 것처럼 보여야 한다(`core.md §3-1`). 멤버를 초대하는 순간 처음 노출한다.

### 역할
| role | 통역 실행 | 기록 열람 | 멤버 관리 | 결제 |
|---|---|---|---|---|
| `owner` | ✅ | 전체 | ✅ | ✅ |
| `admin` | ✅ | 전체 | ✅ | ❌ |
| `member` | ✅ | 본인 것만 | ❌ | ❌ |

---

## 2. Firestore 컬렉션 구조

```
users/{uid}
workspaces/{workspaceId}
  members/{uid}
  invites/{inviteId}
sessions/{sessionId}
  segments/{segmentId}
usage/{workspaceId}
  daily/{YYYY-MM-DD}
viewerTokens/{token}
```

**`sessions`를 워크스페이스 하위가 아닌 최상위에 두는 이유:** 자막 뷰어가 인증 없이 토큰만으로 접근해야 하므로, 워크스페이스 경로 아래 있으면 보안 규칙이 복잡해진다.

---

## 3. 타입 정의 (`packages/shared/types`)

```ts
// ── 사용자 ─────────────────────────────────────────
export interface User {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  uiLocale: UiLocale;              // 화면 언어 (통역 언어 아님!)
  theme: 'light' | 'dark' | 'system';
  defaultSourceLang?: LangCode;    // 마지막 사용 언어쌍 기억 → 다음에 미리 채움
  defaultTargetLang?: LangCode;
  workspaceIds: string[];
  lastWorkspaceId?: string;
  createdAt: Timestamp;
}

// ── 워크스페이스 (과금 단위) ────────────────────────
export interface Workspace {
  id: string;
  name: string;
  ownerUid: string;
  emailDomain?: string;            // 회사 도메인 자동 합류용
  plan: PlanId;                    // 'free' | 'team' | 'business' | 'enterprise'
  billing: {
    includedMinutes: number;       // 플랜 포함 분
    usedMinutes: number;           // 이번 주기 사용 분
    overageMinutes: number;        // 초과 사용 분 (종량 과금 대상)
    cycleStart: Timestamp;
    cycleEnd: Timestamp;
    overageEnabled: boolean;       // false면 포함 분 소진 시 즉시 차단
    hardCapMinutes?: number;       // 예산 상한 (초과 방지)
  };
  retentionDays: number;           // 세션 기록 보관 일수. 플랜별 기본값
  storeAudio: boolean;             // 오디오 원본 저장 여부 (기본 false)
  createdAt: Timestamp;
}

export interface Member {
  uid: string;
  email: string;
  displayName: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: Timestamp;
}

// ── 세션 (과금 대상 1회 통역) ───────────────────────
export type SessionMode = 'inperson' | 'meeting';
export type SessionStatus =
  | 'starting' | 'joining' | 'live' | 'degraded'
  | 'ended' | 'failed' | 'orphaned';

export interface Session {
  id: string;
  workspaceId: string;
  startedByUid: string;
  mode: SessionMode;
  status: SessionStatus;

  sourceLang: LangCode;
  targetLang: LangCode;

  title?: string;                  // 모드 A는 회의 제목 자동, 모드 B는 유저 입력(선택)

  meeting?: {                      // mode === 'meeting'
    platform: 'zoom' | 'teams' | 'meet' | 'webex';
    url: string;
    botId?: string;                // Recall.ai bot id
    joinError?: string;
  };

  viewerToken?: string;            // 공개 자막 링크
  viewerTokenExpiresAt?: Timestamp;

  engine: {
    provider: 'openai' | 'google';
    model: string;
    fellBackAt?: Timestamp;        // 폴백 발생 시각 (품질 분석용)
  };

  startedAt: Timestamp;
  endedAt?: Timestamp;
  lastHeartbeatAt?: Timestamp;
  billedSeconds: number;           // 최종 확정 과금 초. 진행 중엔 누적값
  segmentCount: number;

  cost?: {                         // 종료 시 스냅샷 (docs/07)
    translateUsd: number;
    botUsd: number;
    totalUsd: number;
    rateSnapshot: { translatePerMin: number; botPerMin: number; usdKrw: number };
  };

  export?: { transcriptPath?: string; audioPath?: string };
  createdAt: Timestamp;
}

// ── 세그먼트 (자막 한 덩어리) ───────────────────────
export interface Segment {
  id: string;
  seq: number;                     // 순서 보장용 단조 증가
  startMs: number;                 // 세션 시작 기준 상대 시각
  endMs?: number;
  speaker?: string;                // 모드 A는 봇이 화자명 제공 가능
  sourceText: string;
  targetText: string;
  isFinal: boolean;                // false = 부분 전사. 확정 오면 덮어씀
  createdAt: Timestamp;
}
```

> **세그먼트 쓰기 규칙:** 부분 전사(`isFinal: false`)는 **Firestore에 쓰지 않는다.** 화면에만 그린다. 확정된 것만 배치(5초 또는 10건 단위)로 저장한다. 이걸 어기면 쓰기 비용과 지연이 동시에 터진다.

```ts
// ── 사용량 집계 ─────────────────────────────────────
export interface DailyUsage {
  date: string;                    // 'YYYY-MM-DD'
  workspaceId: string;
  minutesByMode: { inperson: number; meeting: number };
  sessionCount: number;
  costUsd: number;                 // 실원가 (마진 분석용, 유저 비노출)
  byUser: Record<string, number>;  // uid → 분
}

// ── 자막 뷰어 토큰 ──────────────────────────────────
export interface ViewerToken {
  token: string;                   // 32자 랜덤 (URL-safe)
  sessionId: string;
  workspaceId: string;
  expiresAt: Timestamp;            // 세션 종료 + 보관기간
  revokedAt?: Timestamp;
}
```

---

## 4. Firestore 보안 규칙 (핵심 원칙)

```
// 의사코드 — 실제 rules 파일로 옮길 것

users/{uid}
  read, write: request.auth.uid == uid

workspaces/{wsId}
  read:  isMember(wsId)
  write: isRole(wsId, ['owner','admin'])
  // billing 필드는 클라이언트 write 전면 금지 → Admin SDK만

workspaces/{wsId}/members/{uid}
  read:  isMember(wsId)
  write: isRole(wsId, ['owner','admin'])

sessions/{sid}
  read:  isMember(resource.data.workspaceId)
         || hasValidViewerToken(sid)      // 뷰어 공개 접근
  create/update: false                     // 서버(Admin SDK)만 씀

sessions/{sid}/segments/{segId}
  read:  위와 동일
  write: false                             // Worker/서버만

usage/**
  read:  isRole(wsId, ['owner','admin'])
  write: false
```

**절대 규칙:**
- `billing`, `billedSeconds`, `usedMinutes`는 **클라이언트가 쓸 수 없다.** 전부 Admin SDK 경유.
- 세션·세그먼트 쓰기는 서버 전용. 클라이언트는 읽기만.
- 뷰어 토큰 검증은 규칙 안에서 `viewerTokens/{token}` 문서 존재·만료·폐기 여부를 확인한다. 만료된 토큰으로는 아무것도 읽히지 않아야 한다.

---

## 5. 필요한 복합 인덱스

```
sessions: workspaceId ASC, startedAt DESC          # 세션 목록
sessions: workspaceId ASC, status ASC, startedAt DESC
sessions: status ASC, lastHeartbeatAt ASC          # 고아 세션 청소 배치
segments: seq ASC                                  # (하위 컬렉션 기본)
usage/{ws}/daily: date DESC
```

---

## 6. 보관 및 삭제

- 매일 실행되는 Cloud Function이 `retentionDays`를 넘긴 세션의 **세그먼트와 오디오를 삭제**하고, 세션 문서는 메타데이터(시간·분 수)만 남긴다. 과금 근거는 남아야 하기 때문이다.
- 워크스페이스 삭제 요청 시 30일 유예 후 전체 하드 삭제.
- 유저가 특정 세션을 즉시 삭제 요청하면 유예 없이 삭제하고, 삭제 사실만 감사 로그에 남긴다.
- 자세한 법적 근거와 고지 방식은 `docs/08`.
