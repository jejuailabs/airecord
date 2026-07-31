/**
 * 엔진 입력 오디오 규격 맞추기.
 *
 * 왜 필요한가 — 회의 봇(Recall.ai)과 번역 엔진의 샘플레이트가 다르다.
 *   Recall.ai가 보내는 것 : 16kHz · 16bit · mono · PCM little-endian (공식 스키마)
 *   번역 엔드포인트가 받는 것 : 24kHz (기본값 고정)
 *
 * ⚠ `session.audio.input.format`으로 레이트를 알려줄 수 없다 —
 *   번역 엔드포인트는 그 파라미터를 아예 모른다(실측 2026-07-29: unknown_parameter).
 *   그래서 **보내는 쪽에서 변환해야 한다.**
 *
 * 안 하면 어떻게 되는가 (실측, 같은 문장):
 *   24kHz 원본       "오늘 함께해 주셔서 감사합니다. 3분기 실적을 검토하고,"
 *   16kHz 그대로     "감사합니다오늘 함께해 주셔서2분기 실적을 살펴보고그다음엔"
 * 말이 반쯤 통하는 것처럼 보이지만 **어순이 뒤집히고 3분기가 2분기로 바뀐다.**
 * 회의록에서 제일 치명적인 종류의 오류다.
 */

/** 번역 엔드포인트가 기대하는 입력 레이트 */
export const ENGINE_INPUT_RATE = 24_000;

/** 회의 봇이 보내는 입력 레이트 (Recall.ai 공식 스키마) */
export const MEETING_BOT_RATE = 16_000;

/**
 * PCM16 리샘플 — 선형 보간.
 *
 * 고급 필터를 쓰지 않는 이유: 16k→24k는 업샘플이라 에일리어싱이 생기지 않고,
 * 실측에서 선형 보간만으로 원본과 같은 번역 품질이 나왔다. 회의 오디오에 충분하다.
 */
export function resamplePcm16(src: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate || src.length === 0) return src;
  const outLen = Math.floor((src.length * toRate) / fromRate);
  const out = new Int16Array(outLen);
  const step = fromRate / toRate;
  for (let i = 0; i < outLen; i++) {
    const pos = i * step;
    const j = Math.floor(pos);
    const frac = pos - j;
    const a = src[j] ?? 0;
    const b = src[j + 1] ?? a;
    out[i] = Math.round(a + (b - a) * frac);
  }
  return out;
}

/** 바이트열 → Int16Array (little-endian). 홀수 바이트는 버린다. */
export function pcm16FromBytes(bytes: Uint8Array): Int16Array {
  const n = bytes.length >> 1;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    // DataView를 안 쓰는 이유 — 오프셋이 어긋난 Buffer에서도 안전하게 읽으려면 직접 조립이 낫다
    out[i] = ((bytes[i * 2]! | (bytes[i * 2 + 1]! << 8)) << 16) >> 16;
  }
  return out;
}

/** Int16Array → 바이트열 (little-endian) */
export function bytesFromPcm16(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i]!;
    out[i * 2] = v & 0xff;
    out[i * 2 + 1] = (v >> 8) & 0xff;
  }
  return out;
}

/**
 * 바이트열 → base64.
 *
 * ⚠ `String.fromCharCode(...bytes)`로 한 번에 만들면 안 된다.
 *   전개(spread)는 인자를 스택에 다 올리므로 큰 청크에서 스택이 넘친다
 *   (브라우저·노드 공통, 대략 6만 바이트 부근부터 터진다).
 *   회의 봇 오디오는 청크가 크게 올 수 있어 실제로 걸린다.
 */
export function base64FromBytes(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let s = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return typeof Buffer !== 'undefined' ? Buffer.from(bytes).toString('base64') : btoa(s);
}

/** base64 → 바이트열 */
export function bytesFromBase64(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 회의 봇 오디오(16kHz base64) → 엔진 입력(24kHz ArrayBuffer) */
export function meetingAudioToEngine(b64: string): ArrayBuffer {
  const pcm16k = pcm16FromBytes(bytesFromBase64(b64));
  const pcm24k = resamplePcm16(pcm16k, MEETING_BOT_RATE, ENGINE_INPUT_RATE);
  const bytes = bytesFromPcm16(pcm24k);
  // 정확히 이 길이만 담은 ArrayBuffer를 넘긴다 — 풀에서 잘라온 버퍼를 그대로 주면 뒤가 붙는다
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
