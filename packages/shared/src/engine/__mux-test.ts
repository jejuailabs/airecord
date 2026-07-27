/**
 * 원문 출처 선택기 검증 — 앱 빌드에 들어가지 않는 개발 도구.
 *
 *   tsx packages/shared/src/engine/__mux-test.ts
 *
 * 여기서 잡는 사고: 두 출처가 동시에 통과해 같은 말이 자막에 두 번 들어가는 것.
 */
import { createSourceMux } from './source-mux';

let t = 0;
const now = () => t;
let failed = 0;

function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? '통과' : '실패'}  ${label}${ok ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
}

// ── 1. 전용 레그 사용 — 부가 전사는 처음부터 전부 차단 ──
{
  t = 0;
  const mux = createSourceMux({ useDedicated: true, now });
  // 연결 전(부가 전사가 먼저 나오는 2.4초 구간)에도 이미 막혀 있어야 한다
  t = 2400;
  check('전용 사용 시 부가 전사 차단(연결 전)', mux.acceptBuiltin(), false);
  t = 5000;
  check('전용 레그 통과', mux.acceptDedicated(), true);
  t = 5200;
  check('전용 가동 중 부가 전사 차단', mux.acceptBuiltin(), false);
}

// ── 2. 전용 레그 미사용(키 발급 실패) — 부가 전사만 통과 ──
{
  t = 0;
  const mux = createSourceMux({ useDedicated: false, now });
  check('전용 없음 → 부가 전사 통과', mux.acceptBuiltin(), true);
  check('전용 없음 → 모드 builtin', mux.mode(), 'builtin');
}

// ── 3. 연결 실패 → 부가 전사로 복귀 ──
{
  t = 0;
  const mux = createSourceMux({ useDedicated: true, now });
  check('복귀 전 부가 전사 차단', mux.acceptBuiltin(), false);
  mux.fallbackToBuiltin();
  check('복귀 후 부가 전사 통과', mux.acceptBuiltin(), true);
}

// ── 4. 전용 레그가 도중에 죽음 → 12초 뒤 부가 전사로 한 번만 넘어가고 되돌아가지 않는다 ──
{
  t = 0;
  const mux = createSourceMux({ useDedicated: true, deadMs: 12_000, now });
  t = 5000;
  mux.acceptDedicated(); // 마지막 생존 신호
  t = 10_000;
  check('침묵 5초 — 아직 전용 유지', mux.acceptBuiltin(), false);
  t = 18_000;
  check('침묵 13초 — 부가 전사로 전환', mux.acceptBuiltin(), true);
  check('전환 후 모드 builtin', mux.mode(), 'builtin');
  // 죽었던 전용이 되살아나도 다시 가져가지 않는다 (오가면 원문이 뒤섞인다)
  t = 19_000;
  check('전용 부활해도 재전환 없음', mux.acceptDedicated(), false);
  check('부가 전사 계속 통과', mux.acceptBuiltin(), true);
}

// ── 5. 실사고 재현: 두 출처가 같은 구간에 이벤트를 쏟아도 통과는 한쪽뿐 ──
{
  t = 0;
  const mux = createSourceMux({ useDedicated: true, now });
  let builtinPassed = 0;
  let dedicatedPassed = 0;
  for (let i = 0; i < 200; i++) {
    t = i * 100; // 20초간 100ms 간격
    if (mux.acceptBuiltin()) builtinPassed++;
    if (mux.acceptDedicated()) dedicatedPassed++;
  }
  check('중복 통과 0 (부가)', builtinPassed, 0);
  check('전용만 통과', dedicatedPassed, 200);
}

console.log(failed === 0 ? '\n전체 통과' : `\n실패 ${failed}건`);
if (failed > 0) process.exitCode = 1;
