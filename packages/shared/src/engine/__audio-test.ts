/** 회의 봇 오디오 변환 — 실측으로 확인한 규격을 코드로 못 박는다 */
import {
  resamplePcm16,
  pcm16FromBytes,
  bytesFromPcm16,
  base64FromBytes,
  bytesFromBase64,
  meetingAudioToEngine,
  ENGINE_INPUT_RATE,
  MEETING_BOT_RATE,
} from './audio';

let failed = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '통과' : '실패'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failed++;
};

/** 16k → 24k는 길이가 1.5배 */
{
  const src = new Int16Array(1600); // 0.1초
  const out = resamplePcm16(src, MEETING_BOT_RATE, ENGINE_INPUT_RATE);
  ok('16k→24k 길이가 1.5배', out.length === 2400, `${src.length} → ${out.length}`);
}

/** 같은 레이트면 그대로 (쓸데없는 복사·손실 금지) */
{
  const src = new Int16Array([1, -2, 3]);
  ok('같은 레이트면 원본 그대로', resamplePcm16(src, 24000, 24000) === src);
}

/** 사인파를 리샘플해도 파형이 유지되는가 — 진폭·부호가 뭉개지면 음성이 상한다 */
{
  const n = 16000;
  const src = new Int16Array(n);
  for (let i = 0; i < n; i++) src[i] = Math.round(Math.sin((i / MEETING_BOT_RATE) * 2 * Math.PI * 440) * 20000);
  const out = resamplePcm16(src, MEETING_BOT_RATE, ENGINE_INPUT_RATE);
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  ok('440Hz 사인파 진폭이 유지된다', peak > 19000 && peak <= 20001, `peak ${peak}`);

  // 0교차 횟수 ≈ 주파수 × 2 × 길이(초). 440Hz · 1초 → 880회 부근
  let cross = 0;
  for (let i = 1; i < out.length; i++) if ((out[i - 1]! < 0) !== (out[i]! < 0)) cross++;
  ok('주파수가 변하지 않는다 (0교차 880±10)', Math.abs(cross - 880) <= 10, `${cross}회`);
}

/** 바이트 ↔ PCM 왕복 */
{
  const pcm = new Int16Array([0, 1, -1, 32767, -32768, 1234, -4321]);
  const back = pcm16FromBytes(bytesFromPcm16(pcm));
  ok('PCM↔바이트 왕복이 정확하다', Array.from(back).join() === Array.from(pcm).join());
}

/** base64 왕복 — 큰 청크에서 스택이 넘치지 않아야 한다 */
{
  const big = new Uint8Array(300_000);
  for (let i = 0; i < big.length; i++) big[i] = i & 0xff;
  let threw = false;
  let same = false;
  try {
    const round = bytesFromBase64(base64FromBytes(big));
    same = round.length === big.length && round[0] === big[0] && round[299_999] === big[299_999];
  } catch {
    threw = true;
  }
  ok('300KB base64 왕복에서 스택이 넘치지 않는다', !threw && same);
}

/** 봇 오디오 → 엔진 입력: 16kHz 0.5초가 24kHz 0.5초로 나와야 한다 */
{
  const half = new Int16Array(MEETING_BOT_RATE / 2);
  for (let i = 0; i < half.length; i++) half[i] = ((i * 37) % 5000) - 2500;
  const b64 = base64FromBytes(bytesFromPcm16(half));
  const engine = meetingAudioToEngine(b64);
  const expectBytes = (ENGINE_INPUT_RATE / 2) * 2;
  ok('봇 0.5초 → 엔진 0.5초', engine.byteLength === expectBytes, `${engine.byteLength}B (기대 ${expectBytes}B)`);
}

/** 빈 프레임에도 죽지 않아야 한다 — 봇은 무음 구간에 빈 버퍼를 보낼 수 있다 */
{
  let threw = false;
  try {
    meetingAudioToEngine('');
  } catch {
    threw = true;
  }
  ok('빈 프레임을 받아도 죽지 않는다', !threw);
}

console.log(failed === 0 ? '\n전체 통과' : `\n${failed}건 실패`);
if (failed > 0) process.exitCode = 1;
