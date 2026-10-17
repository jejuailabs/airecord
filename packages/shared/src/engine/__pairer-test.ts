/**
 * 짝짓기 검증 — 2026-10-17 실측(스페인어 대면 통역) 도착 순서를 재현한다.
 * 실행: npx tsx packages/shared/src/engine/__pairer-test.ts
 */
import { createSourcePairer } from './source-pairer';

let t = 0;
const p = createSourcePairer({ now: () => t });
const rows = new Map<number, string>();
const apply = (fills: { seq: number; sourceText: string }[]) =>
  fills.forEach((f) => rows.set(f.seq, f.sourceText));
const target = (seq: number, text: string) => {
  rows.set(seq, p.takeForTarget(seq, text).sourceText);
};
const src = (text: string) => apply(p.pushSource(text, 'es'));

// 원문이 번역보다 먼저, 조각(문장부호 없음)으로도 온다
t = 1000; src('Buenos días a todos.');
t = 2500; src('Gracias por venir a la reunión de hoy.');
t = 3000; target(0, '안녕하세요 여러분. 회의에 와 주셔서 감사합니다.');
t = 5000; src('Primero, quiero hablar sobre los resultados del último trimestre.');
t = 6500; src('Las ventas subieron un quince por ciento en comparación con el año pasado.');
t = 7000; target(1, '먼저 지난 분기의 결과를 말씀드리고 싶습니다.');
t = 8000; src('Sin embargo,');
t = 9000; target(2, '매출은 전년 대비 15% 상승했습니다.');
t = 9500; src('los costos de transporte también aumentaron bastante.');
// 번역이 원문보다 먼저 확정되는 경우 — 뒤늦게 채워져야 한다
t = 11000; target(3, '하지만 운송비도 많이 늘었습니다.');
t = 12000; target(4, '그래서 이번 달 말 전에 공급업체와의 계약을');  // 문장 중간에서 잘림
t = 12500; target(5, '검토해야 합니다.');
t = 13000; src('Por eso necesitamos revisar el contrato con el proveedor antes de fin de mes.');
t = 14000; src('¿Alguien tiene preguntas hasta aquí?');
t = 15000; src('Muy bien.');
t = 15500; target(6, '여기까지 질문 있으신가요? 좋습니다.');
apply(p.flush());

const want: Record<number, string> = {
  0: 'Buenos días a todos. Gracias por venir a la reunión de hoy.',
  1: 'Primero, quiero hablar sobre los resultados del último trimestre.',
  2: 'Las ventas subieron un quince por ciento en comparación con el año pasado.',
  3: 'Sin embargo, los costos de transporte también aumentaron bastante.',
  4: '',
  5: 'Por eso necesitamos revisar el contrato con el proveedor antes de fin de mes.',
  6: '¿Alguien tiene preguntas hasta aquí? Muy bien.',
};
let fail = 0;
for (const [seq, w] of Object.entries(want)) {
  const got = rows.get(Number(seq)) ?? '';
  const ok = got === w;
  if (!ok) fail++;
  console.log(ok ? 'ok  ' : 'FAIL', seq, JSON.stringify(got), ok ? '' : `\n     want ${JSON.stringify(w)}`);
}

// 어긋남이 쌓이지 않는지: 번역이 두 문장을 한 문장으로 합친 경우
const q = createSourcePairer({ now: () => t, staleMs: 10_000 });
t = 0; q.pushSource('Uno. Dos.');
t = 12_000; q.pushSource('Tres.');
t = 12_500;
// 묵은 두 문장(Uno, Dos)은 이번 줄이 함께 가져가고, 새 문장(Tres)은 다음 줄 몫으로 남긴다
const merged = q.takeForTarget(10, '하나, 둘.');
const next = q.takeForTarget(11, '셋.');
const okMerge = merged.sourceText === 'Uno. Dos.' && next.sourceText === 'Tres.';
if (!okMerge) fail++;
console.log(okMerge ? 'ok  ' : 'FAIL', 'stale catch-up', JSON.stringify(merged.sourceText), JSON.stringify(next.sourceText));

// 실측 2: 전사가 문장 중간에 마침표를 찍음 ("…con el proveedor. / antes de fin de mes.")
const r = createSourcePairer({ now: () => t });
const rows2 = new Map<number, string>();
const ap2 = (fs: { seq: number; sourceText: string }[]) => fs.forEach((f) => rows2.set(f.seq, f.sourceText));
t = 0; ap2(r.pushSource('Por eso, necesitamos revisar contrato con el proveedor.'));
t = 500; rows2.set(20, r.takeForTarget(20, '그래서 공급업체와의 계약을 이달 말 전까지 검토해야 합니다.').sourceText);
t = 900; ap2(r.pushSource('antes de fin de mes.'));
t = 1500; ap2(r.pushSource('¿Alguien tiene preguntas hasta aquí? Muy bien.'));
t = 2000; rows2.set(21, r.takeForTarget(21, '지금까지 질문이 있는 분 있나요? 좋습니다.').sourceText);
const want2: Record<number, string> = {
  20: 'Por eso, necesitamos revisar contrato con el proveedor. antes de fin de mes.',
  21: '¿Alguien tiene preguntas hasta aquí? Muy bien.',
};
for (const [seq, w] of Object.entries(want2)) {
  const got = rows2.get(Number(seq)) ?? '';
  if (got !== w) fail++;
  console.log(got === w ? 'ok  ' : 'FAIL', seq, JSON.stringify(got));
}

process.exit(fail ? 1 : 0);
