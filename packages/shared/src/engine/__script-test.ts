/**
 * 스크립트 재구성 검증 — 앱 빌드에 들어가지 않는 개발 도구.
 *   tsx packages/shared/src/engine/__script-test.ts
 *
 * 여기서 잡는 사고: 기록·PDF에서 원문과 번역이 어긋난 채 한 줄에 묶이는 것.
 */
import { buildScript, scriptPlainText } from './script';

let failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? '통과' : '실패'}  ${label}`);
  if (!ok) console.log(`   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`);
};

// ── 1. 짝지어진 줄은 그대로 한 줄 ──
{
  const b = buildScript([
    { seq: 0, startMs: 0, sourceText: 'Good morning.', targetText: '좋은 아침입니다.', kind: 'paired' },
  ]);
  check('짝지어진 줄 1개', b, [
    { type: 'paired', seq: 0, startMs: 0, sourceText: 'Good morning.', targetText: '좋은 아침입니다.' },
  ]);
}

// ── 2. 짝 못 지은 줄들은 연속된 것끼리 한 병렬 블록으로 ──
{
  const b = buildScript([
    { seq: 1, startMs: 100, sourceText: '', targetText: '먼저 숫자로', kind: 'target' },
    { seq: 2, startMs: 200, sourceText: '', targetText: '시작하겠습니다.', kind: 'target' },
    { seq: 3, startMs: 300, sourceText: 'I wanna start.', targetText: '', kind: 'source' },
  ]);
  check('연속 미짝지음 → 병렬 블록 1개', b.length, 1);
  check('병렬 블록 내용', b[0], {
    type: 'parallel',
    seq: 1,
    startMs: 100,
    target: ['먼저 숫자로', '시작하겠습니다.'],
    source: ['I wanna start.'],
  });
}

// ── 3. 짝지음과 미짝지음이 섞여도 순서가 유지되고 블록이 갈린다 ──
{
  const b = buildScript([
    { seq: 0, startMs: 0, sourceText: 'A.', targetText: '가.', kind: 'paired' },
    { seq: 1, startMs: 100, sourceText: '', targetText: '나.', kind: 'target' },
    { seq: 2, startMs: 200, sourceText: 'B.', targetText: '', kind: 'source' },
    { seq: 3, startMs: 300, sourceText: 'C.', targetText: '다.', kind: 'paired' },
  ]);
  check('블록 순서', b.map((x) => `${x.type}@${x.seq}`), [
    'paired@0',
    'parallel@1',
    'paired@3',
  ]);
}

// ── 4. kind가 없던 옛 기록도 양쪽 차 있으면 짝으로 본다 ──
{
  const b = buildScript([
    { seq: 0, startMs: 0, sourceText: 'Old.', targetText: '옛 기록.' },
    { seq: 1, startMs: 100, sourceText: '', targetText: '번역만.' },
  ]);
  check('옛 기록 호환', b.map((x) => x.type), ['paired', 'parallel']);
}

// ── 5. 빈 줄은 버린다 (자막에 빈 칸이 생기면 안 된다) ──
{
  const b = buildScript([
    { seq: 0, startMs: 0, sourceText: '  ', targetText: '  ', kind: 'target' },
    { seq: 1, startMs: 100, sourceText: '', targetText: '실제 내용', kind: 'target' },
  ]);
  check('빈 줄 제거', b, [
    { type: 'parallel', seq: 1, startMs: 100, target: ['실제 내용'], source: [] },
  ]);
}

// ── 6. 요약에 넘길 평문은 번역만 뽑는다 (같은 말 두 번 읽지 않게) ──
{
  const txt = scriptPlainText([
    { seq: 0, startMs: 0, sourceText: 'A.', targetText: '가.', kind: 'paired' },
    { seq: 1, startMs: 100, sourceText: 'B.', targetText: '', kind: 'source' },
    { seq: 2, startMs: 200, sourceText: '', targetText: '나.', kind: 'target' },
  ]);
  check('요약용 평문', txt, '가.\n나.');
}

console.log(failed === 0 ? '\n전체 통과' : `\n실패 ${failed}건`);
if (failed > 0) process.exitCode = 1;
