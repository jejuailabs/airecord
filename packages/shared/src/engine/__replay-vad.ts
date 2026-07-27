/**
 * 1층(병렬 스트림) 회귀 검사 — 앱 빌드에 들어가지 않는 개발 도구.
 *
 *   SPEED=1 tsx packages/shared/src/engine/__replay-vad.ts
 *
 * __fixture-vad.json은 통역 레그 + 전용 전사 레그를 동시에 물려 받은 실제 이벤트다.
 *
 * 통과 기준 (짝짓기는 2층 담당이라 여기서 보지 않는다):
 *  - 번역 스트림이 **한 글자도 변형·유실되지 않을 것** (음성과 100% 일치해야 한다)
 *  - 원문 스트림이 유실되지 않을 것
 *  - 두 스트림이 서로 섞이지 않을 것 (한 줄에 둘 다 들어가면 안 된다)
 * ⚠ SPEED>1은 타이머가 왜곡돼 무효.
 */
import fs from 'node:fs';
import { createSegmentAssembler } from './segment-assembler';
import type { EngineSegment } from './types';

type Row =
  | [number, 'T', string]
  | [number, 'VS' | 'VE', string, number]
  | [number, 'SD' | 'SC', string, string];

const raw = JSON.parse(
  fs.readFileSync(new URL('./__fixture-vad.json', import.meta.url), 'utf8'),
) as Row[];

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
for (const row of raw) {
  const [at, kind] = row;
  await sleep(Math.max(0, (at - prev) / SPEED));
  prev = at;
  if (kind === 'T') asm.handle({ type: 'session.output_transcript.delta', delta: row[2] as string });
  else if (kind === 'VS')
    asm.handle({
      type: 'input_audio_buffer.speech_started',
      item_id: row[2] as string,
      audio_start_ms: row[3] as number,
    });
  else if (kind === 'VE')
    asm.handle({
      type: 'input_audio_buffer.speech_stopped',
      item_id: row[2] as string,
      audio_end_ms: row[3] as number,
    });
  else if (kind === 'SD')
    asm.handle({
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: row[2] as string,
      delta: row[3] as string,
    });
  else
    asm.handle({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: row[2] as string,
      transcript: row[3] as string,
    });
}
await sleep(3_000 / SPEED);
asm.dispose();

const norm = (s: string) => s.replace(/\s+/g, '');
const fullTarget = raw.filter((r) => r[1] === 'T').map((r) => r[2] as string).join('');
const fullSource = raw.filter((r) => r[1] === 'SC').map((r) => r[3] as string).join(' ');

const targetRows = emitted.filter((e) => e.kind === 'target');
const sourceRows = emitted.filter((e) => e.kind === 'source');
const mixed = emitted.filter((e) => e.sourceText.trim() && e.targetText.trim());

const outTarget = targetRows.map((e) => e.targetText).join('');
const outSource = sourceRows.map((e) => e.sourceText).join(' ');

console.log('─'.repeat(72));
console.log(`[번역 스트림] ${targetRows.length}줄`);
for (const e of targetRows.slice(0, 6)) console.log(`   ${e.targetText}`);
console.log(`[원문 스트림] ${sourceRows.length}줄`);
for (const e of sourceRows.slice(0, 4)) console.log(`   ${e.sourceText}`);
console.log('─'.repeat(72));

const tLost = norm(fullTarget).length - norm(outTarget).length;
const sLost = norm(fullSource).length - norm(outSource).length;
console.log(`번역 ${norm(fullTarget).length}자 → ${norm(outTarget).length}자 (유실 ${tLost})`);
console.log(`원문 ${norm(fullSource).length}자 → ${norm(outSource).length}자 (유실 ${sLost})`);
console.log(`스트림 혼입: ${mixed.length}줄`);

let bad = 0;
if (tLost !== 0) { console.log('✗ 번역이 변형·유실됐다 — 음성과 달라진다'); bad++; }
if (sLost !== 0) { console.log('✗ 원문이 유실됐다'); bad++; }
if (mixed.length !== 0) { console.log('✗ 두 스트림이 한 줄에 섞였다'); bad++; }
console.log(bad === 0 ? '\n전체 통과' : `\n실패 ${bad}건`);
if (bad > 0) process.exitCode = 1;
