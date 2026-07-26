# 04 — 번역 파이프라인

> 선행 문서: `core.md`, `docs/01-architecture.md`
> **이 문서의 목적:** 모드 A와 모드 B가 같은 번역 코어를 쓰도록 강제하는 것.

---

## 1. 코어 추상화

`packages/shared/engine/` 하나만 번역 모델을 안다. 그 밖의 코드는 벤더 이름을 몰라야 한다.

```ts
export interface TranslationSession {
  /** PCM16 오디오 청크 전송 */
  pushAudio(chunk: ArrayBuffer): void;
  /** 세그먼트 스트림 구독 */
  onSegment(cb: (s: EngineSegment) => void): void;
  /** 번역 오디오 수신 (옵션 채널) */
  onAudio?(cb: (chunk: ArrayBuffer) => void): void;
  onError(cb: (e: EngineError) => void): void;
  close(): Promise<void>;
  readonly provider: 'openai' | 'google';
  readonly model: string;
}

export interface EngineSegment {
  seq: number;
  startMs: number;
  endMs?: number;
  sourceText: string;
  targetText: string;
  isFinal: boolean;
  speaker?: string;
}

export interface TranslationEngine {
  /** 서버가 직접 스트림을 릴레이 (모드 A) */
  openServerSession(opts: OpenOpts): Promise<TranslationSession>;
  /** 브라우저 직결용 단명 토큰 발급 (모드 B) */
  mintEphemeralKey(opts: OpenOpts): Promise<{ key: string; expiresAt: number }>;
  supports(source: LangCode, target: LangCode): boolean;
  readonly capabilities: {
    audioOut: boolean;
    browserDirect: boolean;      // WebRTC 직결 가능 여부
    maxSessionSec: number;
  };
}

export interface OpenOpts {
  sourceLang: LangCode;
  targetLang: LangCode;
  audioOut: boolean;
  sessionId: string;
}
```

### 어댑터
```
packages/shared/engine/
├── index.ts                 getEngine(provider) → TranslationEngine
├── types.ts
├── openai-realtime.ts       gpt-realtime-translate
├── google-live.ts           gemini live translate
└── fallback.ts              1순위 실패 시 2순위로 승계
```

**금지:** `apps/web`이나 `apps/worker`에서 OpenAI/Google SDK를 직접 import 하는 것. 반드시 `getEngine()`을 거친다. 이 규칙이 `core.md §3-3`(번역 코어는 하나)을 코드 레벨에서 강제한다.

---

## 2. 엔진 후보 (2026-07-26 조사 기준)

| | 1순위 | 폴백 |
|---|---|---|
| 모델 | `gpt-realtime-translate` (OpenAI) | `gemini-3.5-live-translate` (Google) |
| 과금 | 분당 정액 $0.034 | 오디오 토큰 과금, 분당 ≈$0.037 |
| 언어 | 입력 70개 / 출력 13개 (조사값) | 70개 이상 |
| 특성 | 번역 전용 엔드포인트 | 번역 전용. 함수호출·캐싱·구조화출력 없음 |

**중요한 함의:**
- 1순위의 **출력 언어가 입력보다 훨씬 적다**(조사값 기준 13개). 지원 언어 목록을 UI에 하드코딩하지 말고 `engine.supports()`로 검사해서 **선택 불가능한 조합은 애초에 못 고르게** 한다.
- 폴백 엔진은 **스트림 단위 과금**이다. 양방향 대화를 두 스트림으로 구현하면 비용이 2배가 된다. 설계 시 스트림 수를 명시적으로 센다.
- **두 단가가 거의 같다**(차이 약 9%). 따라서 폴백 전환은 비용이 아니라 **품질·가용성 기준**으로 판단한다.

> ⚠ 위 수치는 2026-07-26 웹 조사 기준이며 벤더가 예고 없이 변경한다. `docs/07 §1`에 출처를 남겼다. 코드에는 환경변수로 주입하고, 분기마다 재확인한다.

---

## 3. 모드 B (대면) 구현

### 흐름
```
브라우저
  ├─ getUserMedia({ audio: { echoCancellation, noiseSuppression, autoGainControl } })
  ├─ POST /api/session/start        → { sessionId, ephemeralKey, maxDurationSec }
  ├─ RTCPeerConnection 생성 → ephemeralKey로 모델에 직결
  ├─ 마이크 트랙 추가 → 전송 시작
  ├─ 데이터 채널로 세그먼트 수신 → 즉시 렌더
  ├─ (옵션) 번역 오디오 트랙 수신 → 헤드셋 재생
  ├─ 10초마다 POST /api/session/heartbeat  (+확정 세그먼트 배치)
  └─ 종료 → POST /api/session/end
```

### 렌더링 규칙 (지연의 대부분은 여기서 발생한다)
- 부분 전사는 **마지막 세그먼트 하나만** 갱신한다. 전체 리스트를 다시 그리지 않는다.
- 세그먼트 리스트는 `key={seq}`로 안정화하고, 확정 세그먼트는 `React.memo`로 리렌더를 차단한다.
- 자동 스크롤은 `requestAnimationFrame` 안에서 하되, 유저가 위로 스크롤했으면 **따라가지 않는다**(읽는 중일 수 있다). "최신으로" 버튼을 띄운다.
- 세그먼트가 500개를 넘으면 가상 스크롤로 전환한다.

### 오디오 출력 규칙 (드리프트 방어)
```ts
// 재생 큐가 임계치를 넘으면 오래된 것을 버린다.
// 밀린 음성을 끝까지 재생하면 지연이 무한히 누적된다 — core.md §3-2
const MAX_QUEUE_MS = 2500;
if (queuedMs > MAX_QUEUE_MS) dropOldestUntil(MAX_QUEUE_MS);
```
UI에는 "음성 번역은 자막보다 늦을 수 있습니다" 를 옵션 토글 옆에 **한 줄**로 적는다. 사과하지 말고 사실만 적는다.

### 에코 방지
- 기본은 **헤드셋 사용 권장** 안내. 마이크와 스피커가 한 공간에 있으면 번역 음성이 다시 입력으로 들어간다.
- 스피커 출력이 감지되고 음성 출력이 켜져 있으면 시작 전에 한 번 경고한다.
- 모니터 자막만 쓰면 이 문제 자체가 없다. 그래서 자막이 기본값이다.

---

## 4. 모드 A (화상회의) 구현

### 흐름
```
Vercel /api/meeting/join
  ├─ URL 파싱 → platform 판별 (zoom | teams | meet | webex)
  ├─ 잔여 분 확인 (부족하면 402)
  ├─ sessions/{id} 생성 + viewerToken 발급
  └─ Recall.ai 봇 생성
        · meeting_url
        · 실시간 오디오 스트림 목적지 = wss://<worker>/relay/{sessionId}?sig=...
        · 봇 이름: "<브랜드> 통역"

Worker
  ├─ WS 연결 수락 → 서명 검증 (WORKER_SHARED_SECRET)
  ├─ getEngine().openServerSession() 으로 모델 연결
  ├─ 봇 오디오 → 모델 / 모델 세그먼트 → Firestore 배치 기록
  ├─ 30초마다 세션 상태·경과 시간 갱신 + 하드 캡 검사
  └─ 회의 종료 이벤트 → 봇 leave → 세션 종료 → 분 확정

뷰어 /v/{token}
  └─ Firestore onSnapshot 구독 → 자막 실시간 표시
```

### 자막 링크 자동 게시
봇 입장 직후 회의 채팅에 **한 줄만** 보낸다.
```
🌐 실시간 통역 자막: https://<host>/v/xxxxxxxx
```
- 재전송은 하지 않는다(스팸으로 느껴진다). 참가자가 늦게 들어오는 경우를 위해 **중간에 새 참가자가 들어오면 1회만** 재게시하는 것은 Phase 6에서 검토.
- 채팅 전송이 실패해도 세션은 계속된다. 대신 시작한 사람의 화면에 링크를 크게 보여주고 복사 버튼을 둔다.

### 봇 입장 실패 처리
| 사유 | 유저에게 보여줄 문구 (예시) |
|---|---|
| 대기실 승인 대기 | "호스트가 봇을 승인하면 통역이 시작됩니다." |
| 링크 오류 | "회의 링크를 다시 확인해 주세요. Zoom·Teams·Meet·Webex 주소를 지원합니다." |
| 회의 미시작 | "회의가 아직 시작되지 않았습니다. 시작되면 자동으로 입장합니다." |
| 비밀번호 필요 | "비밀번호가 포함된 전체 초대 링크를 붙여넣어 주세요." |

**입장 실패 시 봇 시간을 과금하지 않는다.**

---

## 5. 폴백 로직

```
1순위 연결 실패 또는 세션 중 3회 연속 끊김
  → 지수 백오프 재연결 (1s, 2s, 4s)
  → 그래도 실패하면 폴백 엔진으로 새 세션 오픈
  → session.engine.fellBackAt 기록
  → 자막 화면 상단에 "연결을 복구하는 중" 배너 (자막은 남아 있음)
폴백도 실패
  → status = 'failed', 그 시점까지만 과금, 유저에게 사유 표시
```

**Phase 1에서는 폴백을 구현하지 않는다.** 인터페이스만 만들어 두고 1순위 단일 엔진으로 간다(`core.md §3` — 심플함 우선). Phase 4에서 활성화한다.

---

## 6. Phase 1 종료 시 실측할 것

엔진 최종 선택은 조사값이 아니라 **직접 측정한 값**으로 한다.

| 측정 항목 | 방법 |
|---|---|
| 첫 자막까지 지연 | 발화 시작 → 첫 부분 전사 렌더까지 |
| 드리프트 누적 | 10분 연속 발화에서 자막·음성 각각의 지연 변화 |
| 한↔영 / 한↔일 번역 품질 | 동일 스크립트 30문장, 사람 평가 |
| 화자 전환 대응 | 두 사람이 겹쳐 말할 때 |
| 실제 분당 청구액 | 벤더 대시보드 실제 청구 vs 우리 계산값 (`docs/07 §6`) |

측정 결과를 `docs/04`에 표로 추가하고, 그때 1순위를 확정한다. **측정 전까지 "gpt-realtime-translate가 더 낫다"고 문서나 코드에 단정하지 않는다.**
