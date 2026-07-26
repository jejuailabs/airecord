# 02 — 기술 스택 & 프로젝트 셋업

> 선행 문서: `core.md`, `docs/01-architecture.md`

---

## 1. 스택 확정 목록

여기 없는 라이브러리를 추가할 때는 **왜 필요한지 한 줄 근거**를 PR 설명에 남긴다. 기본은 추가하지 않는 것이다.

| 영역 | 선택 | 이유 |
|---|---|---|
| 프레임워크 | **Next.js (App Router) 최신 안정판** | Vercel 배포 최적, RSC로 대시보드 초기 로드 가벼움 |
| 언어 | **TypeScript strict** | `any` 금지. 불가피하면 `unknown` + 좁히기 |
| 호스팅 | **Vercel** | |
| 인증 | **Firebase Auth — Google 로그인만** | 이메일/비번 미지원. 회사 계정 = 구글 워크스페이스 가정 |
| DB | **Firestore** | 자막 실시간 구독이 기본 기능으로 필요 |
| 파일 | **Firebase Storage** | 오디오·내보내기 파일 |
| 배치 | **Cloud Functions for Firebase** | 사용량 일별 집계, 보관기간 만료 정리 |
| 상시 서버 | **Cloud Run** (Realtime Worker) | `docs/01 §3.2` |
| 스타일 | **Tailwind CSS + shadcn/ui** | 토큰은 `docs/05`에서 정의한 CSS 변수를 Tailwind 테마에 주입 |
| 다국어 | **next-intl** | `docs/06 §4` |
| 폼/검증 | **react-hook-form + zod** | API 입출력도 zod 스키마 공유 |
| 서버 상태 | **TanStack Query** | Firestore 실시간 구독은 예외적으로 직접 훅 사용 |
| 차트 | **Recharts** | 사용량 대시보드용 |
| 아이콘 | **lucide-react** | |
| 테스트 | **Vitest** (유닛) + **Playwright** (E2E 핵심 흐름 3개) | |
| 패키지 매니저 | **pnpm** | 모노레포 워크스페이스 |

**의도적으로 쓰지 않는 것:** 상태관리 전역 스토어(Redux/Zustand — 필요해지면 그때 도입), ORM, GraphQL, 자체 인증, 자체 회의 봇.

---

## 2. 레포 구조 (pnpm 모노레포)

```
sotong/
├── core.md
├── docs/                          ← 이 문서 세트
├── package.json                   ← pnpm workspaces 루트
├── pnpm-workspace.yaml
├── turbo.json                     ← (선택) 빌드 캐시
│
├── apps/
│   ├── web/                       ← Next.js — Vercel 배포
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── [locale]/
│   │   │   │   │   ├── (marketing)/      랜딩·요금제
│   │   │   │   │   ├── (app)/            로그인 필요 영역
│   │   │   │   │   │   ├── dashboard/
│   │   │   │   │   │   ├── live/         모드 B 통역 화면
│   │   │   │   │   │   ├── meeting/      모드 A 시작·모니터
│   │   │   │   │   │   ├── sessions/     기록
│   │   │   │   │   │   └── settings/     워크스페이스·멤버·요금제
│   │   │   │   │   └── layout.tsx
│   │   │   │   ├── v/[token]/            자막 뷰어 (인증 불필요, locale 밖)
│   │   │   │   └── api/
│   │   │   │       ├── session/          start · heartbeat · end · token
│   │   │   │       ├── meeting/          join · leave · webhook
│   │   │   │       ├── usage/
│   │   │   │       └── billing/
│   │   │   ├── components/
│   │   │   │   ├── ui/                   shadcn 생성물
│   │   │   │   ├── caption/              자막 렌더 (성능 민감 — docs/05 §6)
│   │   │   │   └── ...
│   │   │   ├── lib/
│   │   │   │   ├── firebase/  client.ts · admin.ts
│   │   │   │   ├── auth/
│   │   │   │   └── pricing/   원가·요금 계산 (docs/07)
│   │   │   ├── hooks/
│   │   │   └── messages/      ko.json · en.json · ja.json · zh-CN.json
│   │   └── ...
│   │
│   └── worker/                    ← Realtime Worker — Cloud Run 배포
│       ├── src/
│       │   ├── server.ts          WebSocket 서버
│       │   ├── relay/             봇 오디오 ↔ 모델 릴레이
│       │   ├── recall/            Recall.ai 클라이언트
│       │   └── firestore.ts
│       └── Dockerfile
│
└── packages/
    ├── shared/                    ← 양쪽이 함께 쓰는 것만
    │   ├── types/                 Session · Segment · Workspace · Usage
    │   ├── schemas/               zod
    │   ├── engine/                TranslationEngine 인터페이스 + 어댑터 (docs/04)
    │   └── constants/             언어 목록, 요금 상수
    └── config/                    eslint · tsconfig · tailwind preset
```

**규칙:** `apps/web`과 `apps/worker`는 서로를 직접 import 하지 않는다. 공유는 반드시 `packages/shared`를 통한다.

---

## 3. 환경변수

`.env.example`을 레포에 커밋하고, 실제 값은 절대 커밋하지 않는다.

### apps/web
```bash
# --- Firebase (클라이언트 — 공개되어도 되는 값) ---
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_APP_ID=

# --- Firebase Admin (서버 전용 — 절대 NEXT_PUBLIC_ 금지) ---
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=

# --- 번역 엔진 ---
TRANSLATION_PRIMARY_PROVIDER=openai        # openai | google
OPENAI_API_KEY=
GOOGLE_AI_API_KEY=

# --- 회의 봇 (Phase 4) ---
RECALL_API_KEY=
RECALL_REGION=
RECALL_WEBHOOK_SECRET=

# --- Worker 연동 ---
WORKER_BASE_URL=
WORKER_SHARED_SECRET=                       # Vercel↔Worker 요청 서명

# --- 과금·원가 (docs/07 — 하드코딩 금지, 여기서 주입) ---
COST_TRANSLATE_USD_PER_MIN=0.034
COST_BOT_USD_PER_MIN=0.00833
USD_KRW_RATE=1400                           # ⚠ 확정 아님. 운영 시 실환율로 갱신
SESSION_MAX_DURATION_SEC=7200               # 세션당 하드 캡 (2시간)

# --- 기타 ---
NEXT_PUBLIC_APP_URL=
```

### apps/worker
```bash
GOOGLE_APPLICATION_CREDENTIALS=   # Cloud Run은 기본 서비스 계정 사용 시 불필요
OPENAI_API_KEY=
GOOGLE_AI_API_KEY=
RECALL_API_KEY=
RECALL_WEBHOOK_SECRET=
WORKER_SHARED_SECRET=
FIREBASE_PROJECT_ID=
PORT=8080
```

---

## 4. 로컬 실행

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local     # 값 채우기
pnpm firebase emulators:start                    # Auth + Firestore + Storage
pnpm --filter web dev                            # http://localhost:3000
pnpm --filter worker dev                         # Phase 4부터
```

**Firebase Emulator를 기본 개발 환경으로 쓴다.** 로컬 개발이 운영 Firestore를 건드리면 안 된다. 단, 번역 모델 API는 에뮬레이터가 없으므로 실제 키를 쓰되 **개발용 하드 캡을 짧게**(`SESSION_MAX_DURATION_SEC=300`) 설정해 실비 사고를 막는다.

---

## 5. 배포

| 대상 | 방법 | 트리거 |
|---|---|---|
| `apps/web` | Vercel Git 연동 | `main` push → production, PR → preview |
| `apps/worker` | Cloud Run (컨테이너) | `main` push 시 GitHub Actions로 빌드·배포 |
| Firestore 규칙·인덱스 | `firebase deploy --only firestore` | 수동 또는 CI |
| Functions | `firebase deploy --only functions` | CI |

**Cloud Run 설정 주의:** `min-instances=1` 권장(콜드 스타트가 봇 입장 지연이 되면 UX가 무너짐), 요청 타임아웃은 최대치로, 동시성은 세션 수 기준으로 조정.

---

## 6. 아직 결정하지 않은 것 (착수 전 확정 필요)

| 항목 | 후보 | 언제까지 |
|---|---|---|
| 결제 PG | 국내 대상이면 토스페이먼츠/포트원, 해외 포함이면 Stripe. **국내 B2B 세금계산서 요건 확인 필요** | Phase 3 시작 전 |
| Worker 호스팅 | Cloud Run(권장) / Fly.io / Railway | Phase 4 시작 전 |
| 브랜드·도메인 | `sotong`은 임시 코드네임 | Phase 3 |
| 번역 엔진 1순위 | 실측 비교 후 결정 (`docs/04 §6`) | Phase 1 종료 시 |

이 항목들은 **결정될 때까지 코드에 하드코딩하지 않는다.** 인터페이스 뒤에 숨겨두고 어댑터로 교체 가능하게 만든다.
