/**
 * VAD 주도 조립 회귀 검사 — 앱 빌드에 들어가지 않는 개발 도구.
 *
 *   SPEED=1 tsx packages/shared/src/engine/__replay-vad.ts
 *
 * __fixture-vad.json은 통역 레그 + 전용 전사 레그를 **동시에** 물려 받은 실제 이벤트다
 * (영어 연속 발화 → 한국어). VAD 경계(VS/VE)와 원문(SD/SC), 번역(T)이 실제 도착 순서 그대로 들어 있다.
 *
 * 여기서 잡는 사고: 번역이 원문보다 2~3초 먼저 도착해 자막이 한 칸씩 밀리는 것
 * (실사용 2026-07-28: 한글 "모두 무료입니다" ↔ 원문 "One.").
 *
 * 통과 기준: 각 칸의 원문과 번역이 **같은 발화**여야 한다. ⚠ SPEED>1은 타이머가 왜곡돼 무효.
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
  if (kind === 'T') {
    asm.handle({ type: 'session.output_transcript.delta', delta: row[2] as string });
  } else if (kind === 'VS') {
    asm.handle({
      type: 'input_audio_buffer.speech_started',
      item_id: row[2] as string,
      audio_start_ms: row[3] as number,
    });
  } else if (kind === 'VE') {
    asm.handle({
      type: 'input_audio_buffer.speech_stopped',
      item_id: row[2] as string,
      audio_end_ms: row[3] as number,
    });
  } else if (kind === 'SD') {
    asm.handle({
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: row[2] as string,
      delta: row[3] as string,
    });
  } else {
    asm.handle({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: row[2] as string,
      transcript: row[3] as string,
    });
  }
}
await sleep(4_000 / SPEED);
asm.dispose();

/** 정답: 발화별 원문 → 그에 대응하는 한국어 핵심 단어 */
const EXPECT: Array<[string, string[]]> = [
  ['quarterly review', ['아침', '리뷰']],
  ['start with the numbers', ['숫자', '시작']],
  ['clearest story', ['분명', '이야기']],
  ['$42 million', ['4,200만', '18%']],
  ['enterprise segment', ['엔터프라이즈']],
  ['small business segment was flat', ['중소기업', '보합']],
  ['why that matters', ['이유', '중요']],
];

console.log('─'.repeat(74));
for (const e of emitted) {
  const tag = !e.sourceText.trim() ? ' ⚠원문없음' : '';
  const win =
    e.audioStartMs != null && e.audioEndMs != null
      ? `${(e.audioStartMs / 1000).toFixed(1)}~${(e.audioEndMs / 1000).toFixed(1)}s`
      : '—';
  console.log(`[${String(e.seq).padStart(2)}] ${win}${tag}`);
  console.log(`   원문: ${e.sourceText || '(비어 있음)'}`);
  console.log(`   번역: ${e.targetText || '(비어 있음)'}`);
}
console.log('─'.repeat(74));

let matched = 0;
for (const [srcKey, tgtWords] of EXPECT) {
  const seg = emitted.find((e) => e.sourceText.includes(srcKey));
  const ok = seg ? tgtWords.some((w) => seg.targetText.includes(w)) : false;
  if (ok) matched++;
  console.log(`${ok ? '맞음' : '어긋남'}  "${srcKey}" ↔ ${seg ? `"${seg.targetText.slice(0, 34)}"` : '(칸 없음)'}`);
}
const noSource = emitted.filter((e) => !e.sourceText.trim()).length;
console.log(`\n짝 일치 ${matched}/${EXPECT.length} · 원문없음 ${noSource}개 · 자막 ${emitted.length}개`);
if (matched < EXPECT.length) process.exitCode = 1;
