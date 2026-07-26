# 05 — 디자인 시스템

> 선행 문서: `core.md`
> **모든 UI 작업 전에 읽는다.** 여기 없는 색·크기·간격을 새로 만들지 않는다.

---

## 1. 디자인 방향

**이 제품이 놓이는 자리:** 회의실 대형 모니터, 상담 데스크의 세로 화면, 노트북 옆의 보조 창. 사람들은 화면을 **보러** 오지 않는다. 대화하는 동안 곁눈으로 읽는다.

**따라서 단 하나의 목표:** 곁눈질로 읽어도 즉시 이해되는 자막.

세 가지 결정이 여기서 나온다.

1. **어두운 화면이 기본이다.** 회의실 조명은 어둡고, 프로젝터에 흰 배경을 띄우면 눈이 부시다. 다크가 기본, 라이트는 선택. (일반적인 SaaS와 반대 방향이며 의도된 것이다.)
2. **색으로 언어를 구분하지 않는다.** 원문과 번역문을 파랑/초록으로 나누는 건 흔하지만, 색각 이상자에게 무너지고 화면이 시끄러워진다. **글자 무게와 명도의 위계**로 나눈다. 번역문은 크고 밝고 굵게, 원문은 작고 흐리게.
3. **강조색은 오직 "지금 살아있음"에만 쓴다.** 라이브 인디케이터 외에는 무채색. 통역이 도는 동안 화면이 반짝이면 안 된다.

**시그니처 요소 — 타임 레일(Time Rail).** 자막 세그먼트 왼쪽에 1px 세로선이 흐르고, 30초마다 짧은 눈금과 경과 시각이 찍힌다. 장식이 아니라 진짜 정보다. 나중에 기록을 훑을 때 "회의 12분쯤 그 얘기"를 눈으로 찾게 해준다. 라이브 중에는 맨 아래 눈금 위에 신호색 점이 얹혀 현재 위치를 표시한다. **화면의 모든 대담함을 여기에만 쓴다.** 나머지는 조용하게.

---

## 2. 색 토큰

Tailwind 임의 색상 클래스(`bg-blue-500` 등) 사용 금지. **아래 시맨틱 토큰만** 쓴다.

```css
/* apps/web/src/app/globals.css */

:root {                                   /* ── LIGHT ── */
  --bg:            #F6F5F2;   /* 종이. 순백 아님 — 형광등 아래 눈부심 억제 */
  --bg-raised:     #FFFFFF;   /* 카드 */
  --bg-sunken:     #EDECE8;   /* 입력 필드, 코드 블록 */
  --border:        #DCDAD4;
  --border-strong: #C2BFB7;

  --text:          #14181F;   /* 본문 */
  --text-muted:    #5C636E;   /* 보조 */
  --text-faint:    #8A9099;   /* 원문 트랙, 타임스탬프 */

  --accent:        #0E9384;   /* 신호색 — 라이브 상태 전용 */
  --accent-weak:   #E0F2EF;
  --accent-text:   #FFFFFF;

  --warn:          #B26A12;   /* 잔여 분 부족 */
  --warn-weak:     #FBF0DE;
  --danger:        #B23B32;   /* 오류, 녹음 중 */
  --danger-weak:   #FBE9E7;

  --caption-bg:    #101720;   /* 자막 패널은 라이트 모드에서도 어둡다 (§4) */
  --caption-target:#F3F6F8;
  --caption-source:#7E8A97;

  --focus:         #0E9384;
  --shadow:        0 1px 2px rgb(20 24 31 / .06), 0 8px 24px rgb(20 24 31 / .06);
}

.dark {                                   /* ── DARK (기본) ── */
  --bg:            #0B1220;   /* 심야 잉크 */
  --bg-raised:     #131C2C;
  --bg-sunken:     #070D18;
  --border:        #223047;
  --border-strong: #33445F;

  --text:          #E8ECF2;
  --text-muted:    #9AA6B8;
  --text-faint:    #66748A;

  --accent:        #2DD4BF;
  --accent-weak:   #0D2E2C;
  --accent-text:   #04211E;

  --warn:          #E0A340;
  --warn-weak:     #2C220E;
  --danger:        #E4685C;
  --danger-weak:   #2E1512;

  --caption-bg:    #070D18;
  --caption-target:#F3F6F8;
  --caption-source:#78879B;

  --focus:         #2DD4BF;
  --shadow:        0 1px 2px rgb(0 0 0 / .4), 0 8px 24px rgb(0 0 0 / .3);
}
```

Tailwind 연결 (`packages/config/tailwind-preset.ts`):
```ts
colors: {
  bg: 'var(--bg)', 'bg-raised': 'var(--bg-raised)', 'bg-sunken': 'var(--bg-sunken)',
  border: 'var(--border)', 'border-strong': 'var(--border-strong)',
  text: 'var(--text)', 'text-muted': 'var(--text-muted)', 'text-faint': 'var(--text-faint)',
  accent: 'var(--accent)', 'accent-weak': 'var(--accent-weak)', 'accent-text': 'var(--accent-text)',
  warn: 'var(--warn)', 'warn-weak': 'var(--warn-weak)',
  danger: 'var(--danger)', 'danger-weak': 'var(--danger-weak)',
  'caption-bg': 'var(--caption-bg)',
  'caption-target': 'var(--caption-target)',
  'caption-source': 'var(--caption-source)',
}
```

**왜 이 배색이 회사 환경에 맞나:** 채도 높은 브랜드색을 넓게 깔지 않아 어떤 회사 화면에 띄워도 튀지 않는다. 강조색은 화면의 1% 미만만 차지한다. 경고·오류색은 각각 하나뿐이라 의미가 흐려지지 않는다.

---

## 3. 타이포그래피

**한 가족만 쓴다: Pretendard Variable.** 이유는 명확하다. 이 화면의 절반은 한글 자막이고, 한글 가독성이 전부다. 장식적 디스플레이 폰트를 얹으면 자막에서 방해가 되고, 자막에 안 쓸 폰트를 헤더에만 쓰는 건 통일성을 깬다. 대신 **weight 대비를 크게 벌려** 위계를 만든다.

- 숫자(타이머·사용량·금액)는 `font-variant-numeric: tabular-nums` 강제. 초 단위가 흔들리면 안 된다.
- 라틴 fallback: `Inter, system-ui`.

```
display-lg   40 / 1.15 / 700 / -0.02em    페이지 제목
display      28 / 1.2  / 700 / -0.015em   섹션 제목
title        20 / 1.35 / 600
body         15 / 1.6  / 400              기본
body-sm      13 / 1.55 / 400              보조 설명
label        12 / 1.4  / 600 / +0.04em / uppercase   폼 라벨, 표 헤더
mono-num     14 / 1.4  / 500 / tabular    타이머, 금액
```

**자막 전용 스케일 (별도):**
```
caption-target   28 / 1.45 / 600     번역문 — 주 트랙
caption-source   15 / 1.5  / 400     원문 — 보조 트랙
caption-time     11 / 1    / 500 / tabular
```
뷰어 화면에서는 유저가 **3단계(보통·크게·아주 크게)** 로 자막 크기를 조절할 수 있다. 각 단계는 위 값에 ×1.0 / ×1.35 / ×1.75. 이 조절은 `core.md §3-1`(설정 zero)의 예외다 — 시력과 화면 크기는 사람마다 다르고, 이건 "설정"이 아니라 "확대"다.

---

## 4. 자막 패널 규격 (가장 중요한 컴포넌트)

```
┌───────────────────────────────────────────────────────┐
│  ● LIVE   한국어 → English            12:04    [Aa][⤢] │  ← 상태 바 56px
├──┬────────────────────────────────────────────────────┤
│  │                                                    │
│ ┃│  We need to move the deadline to next Friday.      │  ← 번역문 28px/600
│ ┃│  마감을 다음 주 금요일로 옮겨야 할 것 같습니다.        │  ← 원문 15px/400 faint
│ ┃│                                                    │
│ ┼ 11:30 ─────────────────────────────────────────     │  ← 타임 레일 눈금
│ ┃│                                                    │
│ ┃│  Is that okay for the client?                      │
│ ┃│  클라이언트 쪽은 괜찮을까요?                          │
│ ┃│                                                    │
│ ●│  Let me check and get back to you—                 │  ← 진행 중(부분 전사)
│  │  확인하고 다시 말씀드릴게…                           │
└──┴────────────────────────────────────────────────────┘
   ↑ 타임 레일 (1px 선 + 30초 눈금 + 현재 위치 점)
```

**규격**
- 배경은 `--caption-bg`. 라이트 모드에서도 자막 패널만 어둡게 유지한다. 밝은 배경의 검은 글씨는 큰 화면·먼 거리에서 번져 보인다.
- 한 줄 최대 길이(measure): **번역문 42자 내외**. 그 이상 늘어나면 시선이 줄 시작으로 돌아오지 못한다. `max-w-[42ch]`.
- 번역문↔원문 간격 `8px`, 세그먼트 간격 `24px`.
- 진행 중 세그먼트는 텍스트 끝에 신호색 캐럿 하나. **깜빡이지 않는다**(`prefers-reduced-motion` 무관하게 — 읽는 도중의 깜빡임은 방해다).
- 대비: 번역문 vs 배경 **12:1 이상**, 원문 vs 배경 **4.5:1 이상**을 지킨다.
- 전체화면 모드(`⤢`) 지원. 회의실 모니터에 띄우는 실제 사용 시나리오다.

---

## 5. 라이트/다크 토글

**동작**
- 값은 `light | dark | system` 3상태. 저장 위치: `users/{uid}.theme` (로그인 시) + `localStorage` (즉시 반영·비로그인).
- FOUC 방지: `<head>`에 인라인 스크립트로 `documentElement.classList` 를 페인트 전에 설정. 이건 필수다.
- **기본값은 `system`이되, `system`이 판별 불가하면 `dark`로 떨어진다.** (§1-1)
- 자막 뷰어(`/v/[token]`)는 로그인 없이 열리므로 `localStorage`만 사용하고, 자막 패널 자체는 테마와 무관하게 항상 어둡다.

**모양** — 스위치 하나가 세 상태를 표현할 수 없으므로 **3분할 세그먼트 컨트롤**을 쓴다.
```
┌──────┬──────┬────────┐
│  ☀   │  ☾   │  ⌾ 자동 │      높이 32px, 선택된 칸만 --bg-raised + shadow
└──────┴──────┴────────┘
```
- 위치: 앱 헤더 우측 계정 메뉴 안. 헤더에 직접 노출하지 않는다(자주 바꾸는 값이 아니다).
- 전환 시 `transition: background-color 150ms, color 150ms`. 그 이상 화려하게 하지 않는다.
- `prefers-reduced-motion: reduce` 면 전환 시간 0.

---

## 6. 간격 · 모서리 · 그림자 · 모션

```
간격 스케일   4 · 8 · 12 · 16 · 24 · 32 · 48 · 64   (그 외 금지)
모서리       sm 6px (뱃지·인풋) / md 10px (버튼·카드) / lg 14px (모달·패널) / full (아바타·라이브 점)
그림자       --shadow 하나만. 떠 있는 요소(드롭다운·모달·토스트)에만.
             카드에는 그림자 대신 1px --border 를 쓴다.
모션         기본 150ms ease-out. 모달 진입 200ms. 그 이상 없음.
             prefers-reduced-motion: reduce → 모든 transition/animation 사실상 제거.
```

**라이브 인디케이터만 예외:** 신호색 점이 2초 주기로 부드럽게 밝기 변화(0.6→1.0). 이건 "지금 녹음·통역 중"이라는 안전 고지 성격이므로 유지한다. 단 `reduce` 설정 시에는 정지하고 대신 "LIVE" 텍스트를 항상 표시한다.

---

## 7. 컴포넌트 규칙

| 컴포넌트 | 규칙 |
|---|---|
| 버튼 | primary 1개/화면. primary는 `--accent` 배경. secondary는 border만. destructive는 `--danger`. 최소 높이 36px, 모바일 44px |
| 입력 | 배경 `--bg-sunken`, 포커스 시 2px `--focus` 링(offset 2px). placeholder에 설명 넣지 말고 라벨을 쓴다 |
| 뱃지 | 상태만 표현. `live`(accent) `ended`(muted) `failed`(danger) `degraded`(warn) |
| 표 | 헤더는 label 스케일. 숫자 컬럼 우측 정렬 + tabular-nums. 행 높이 48px |
| 토스트 | 우하단. 성공 3초, 오류는 수동 닫기 |
| 빈 상태 | 아이콘 + 한 줄 설명 + 행동 버튼 1개. "데이터가 없습니다"만 있는 화면 금지 |
| 로딩 | 스켈레톤 사용. 스피너는 500ms 이상 걸릴 때만 |

---

## 8. 접근성 하한선 (타협 없음)

- 모든 인터랙티브 요소에 보이는 포커스 링.
- 자막 영역은 `aria-live="polite"` (`assertive`는 스크린리더가 매 세그먼트마다 끊어 읽어 오히려 방해).
- 색만으로 상태를 전달하지 않는다 — 라이브 점 옆에 항상 "LIVE" 텍스트.
- 본문 대비 4.5:1, 큰 텍스트 3:1 이상.
- 키보드만으로 세션 시작·종료가 가능해야 한다.
- 375px 폭에서 레이아웃이 깨지지 않는다.
