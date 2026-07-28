/** 기록 유실 회귀 — 실제로 났던 사고를 그대로 재현해 둔다 */
import { unsavedRows, chunkForSave, type SaveRow } from './save-queue';

let failed = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '통과' : '실패'}  ${name}${extra && !cond ? ` — ${extra}` : ''}`);
  if (!cond) failed++;
};

type Row = SaveRow & { kind?: 'target' | 'source' | 'paired' };
const row = (seq: number, kind: Row['kind'], src = 'ㅇ', tgt = 'x'): Row => ({
  seq,
  kind,
  sourceText: src,
  targetText: tgt,
  isFinal: true,
});

/**
 * 사고 재현: 정렬이 성공한 줄(paired)이 저장에서 빠졌다.
 * 옛 규칙(kind !== 'paired')이었다면 3번 줄이 사라진다.
 */
{
  const rows = [row(1, 'target'), row(2, 'source'), row(3, 'paired')];
  const got = unsavedRows(rows, new Set());
  ok('짝지은 줄도 저장 대상이다', got.length === 3, `${got.length}줄만 골랐다`);
  ok(
    '제일 멀쩡한 줄(paired)이 빠지지 않는다',
    got.some((r) => (r as Row).kind === 'paired'),
  );
}

/** 이미 보낸 줄은 다시 보내지 않는다 — 같은 말이 두 번 저장되면 그것도 사고다 */
{
  const rows = [row(1, 'paired'), row(2, 'target')];
  const got = unsavedRows(rows, new Set([1]));
  ok('보낸 줄은 제외', got.length === 1 && got[0]!.seq === 2);
}

/** 양쪽이 빈 줄은 저장해도 화면에 안 나온다 */
{
  const got = unsavedRows([row(1, 'target', '', '  '), row(2, 'target')], new Set());
  ok('빈 줄 제외', got.length === 1 && got[0]!.seq === 2);
}

/** 확정 안 된 줄은 저장하지 않는다 (부분 전사 저장 금지) */
{
  const rows: Row[] = [{ ...row(1, 'target'), isFinal: false }, row(2, 'target')];
  const got = unsavedRows(rows, new Set());
  ok('미확정 줄 제외', got.length === 1 && got[0]!.seq === 2);
}

/**
 * 상한 초과 사고: 250줄을 한 번에 보내면 서버가 요청 전체를 되돌려 0줄이 저장된다.
 * 잘라 보내면 250줄이 전부 남는다.
 */
{
  const rows = Array.from({ length: 250 }, (_, i) => row(i + 1, 'target'));
  const chunks = chunkForSave(rows, 100);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  ok('상한 초과분을 잘라도 한 줄도 안 잃는다', total === 250 && chunks.length === 3);
  ok(
    '어느 묶음도 상한을 넘지 않는다',
    chunks.every((c) => c.length <= 100),
  );
}

console.log(failed === 0 ? '\n전체 통과' : `\n${failed}건 실패`);
if (failed > 0) process.exitCode = 1;
