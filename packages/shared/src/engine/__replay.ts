/**
 * 자막 조립 회귀 검사 — 앱 빌드에 들어가지 않는 개발 도구다.
 *
 * __fixture.json은 gpt-realtime-translate에서 실제로 받은 60초치 이벤트 스트림이다
 * (영어 연속 발화 → 한국어). 타이밍까지 그대로 재현하므로 타이머가 얽힌 버그도 잡힌다.
 *
 * 이 파일이 있는 이유: 이 조립기는 같은 자리에서 여러 번 깨졌다
 * (원문 유실 → 번역 순서 뒤섞임 → 정렬 한 칸 밀림). 눈으로 보면 매번 놓친다.
 *
 *   SPEED=1 tsx packages/shared/src/engine/__replay.ts
 *
 * 통과 기준: 원문 유실 0, 번역 유실 0, 원문없음 0, 그리고 각 덩어리의 원문·번역이 서로 맞을 것.
 * ⚠ SPEED>1로 돌리면 타이머가 실제와 달라져 결과를 믿을 수 없다.
 */
import fs from 'node:fs';
import { createSegmentAssembler } from './segment-assembler';
import type { EngineSegment } from './types';

const raw = JSON.parse(
  fs.readFileSync(new URL('./__fixture.json', import.meta.url), 'utf8'),
) as Array<[number, 's' | 't', string]>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SPEED = Number(process.env.SPEED ?? 1);

const emitted: EngineSegment[] = [];
const asm = createSegmentAssembler(
  (s) => {
    const i = emitted.findIndex((e) => e.seq === s.seq);
    if (i >= 0) emitted[i] = s;
    else emitted.push(s);
  },
  undefined,
  { targetLang: 'ko' },
);

let prev = 0;
for (const [at, ch, delta] of raw) {
  await sleep(Math.max(0, (at - prev) / SPEED));
  prev = at;
  asm.handle({
    type: ch === 's' ? 'session.input_transcript.delta' : 'session.output_transcript.delta',
    delta,
  });
}
await sleep(4_000 / SPEED);
asm.dispose();

const norm = (s: string) => s.replace(/\s+/g, '');
const fullSrc = raw.filter((r) => r[1] === 's').map((r) => r[2]).join('');
const fullTgt = raw.filter((r) => r[1] === 't').map((r) => r[2]).join('');
const outSrc = emitted.map((e) => e.sourceText).join(' ');
const outTgt = emitted.filter((e) => !e.sameAsTarget).map((e) => e.targetText).join(' ');

console.log('─'.repeat(70));
for (const e of emitted) {
  const tag = !e.sourceText.trim() ? ' ⚠원문없음' : !e.targetText.trim() ? ' ⚠번역없음' : '';
  console.log(`[${String(e.seq).padStart(2)}]${tag}`);
  console.log(`   원문: ${e.sourceText || '(비어 있음)'}`);
  console.log(`   번역: ${e.targetText || '(비어 있음)'}`);
}
console.log('─'.repeat(70));
console.log(`자막 ${emitted.length}개`);
console.log(`  원문 없음 : ${emitted.filter((e) => !e.sourceText.trim()).length}개`);
console.log(`  번역 없음 : ${emitted.filter((e) => !e.targetText.trim()).length}개`);
console.log(`  동일언어  : ${emitted.filter((e) => e.sameAsTarget).length}개`);
console.log(`원문 ${norm(fullSrc).length}자 → 자막 ${norm(outSrc).length}자 (유실 ${norm(fullSrc).length - norm(outSrc).length})`);
console.log(`번역 ${norm(fullTgt).length}자 → 자막 ${norm(outTgt).length}자 (유실 ${norm(fullTgt).length - norm(outTgt).length})`);
