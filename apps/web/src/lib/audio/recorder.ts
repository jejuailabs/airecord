/**
 * 세션 마이크 녹음 — 원본 발화를 담는다.
 *
 * 통역 세션의 mic 스트림을 MediaRecorder로 그대로 녹음한다. 번역 음성이 아니라
 * "실제로 무슨 말을 했는가"(원본)를 남긴다 — 기록의 근거로 쓰인다.
 *
 * ⚠ 통역용 WebRTC와 **같은 mic 트랙**을 쓴다. 트랙 하나를 두 곳(번역 세션 + 녹음)이
 *   공유해도 된다 — 녹음이 통역을 방해하지 않는다.
 *
 * 브라우저 지원: webm/opus가 기본. iOS 사파리는 mp4/aac만 되므로 지원 타입을 골라 쓴다.
 */
export interface SessionRecorder {
  stop(): Promise<{ blob: Blob; contentType: string } | null>;
  readonly contentType: string;
}

/** 이 브라우저가 실제로 지원하는 녹음 타입을 고른다 (없으면 null → 녹음 생략) */
function pickMimeType(): string | null {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mpeg'];
  const supported = typeof MediaRecorder !== 'undefined' ? MediaRecorder.isTypeSupported : null;
  if (!supported) return null;
  for (const t of candidates) {
    if (supported(t)) return t;
  }
  return null;
}

/**
 * 녹음을 시작한다. 실패하거나 미지원이면 null을 돌려준다 —
 * 녹음은 부가기능이라, 안 돼도 통역·자막은 그대로 진행돼야 한다.
 */
export function startSessionRecorder(mic: MediaStream): SessionRecorder | null {
  const mimeType = pickMimeType();
  if (!mimeType) return null;
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(mic, { mimeType, audioBitsPerSecond: 32_000 });
  } catch {
    return null;
  }

  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  // 1초마다 조각을 받아 둔다 — 중간에 탭이 죽어도 그때까지는 남는다
  rec.start(1_000);

  const baseType = mimeType.split(';')[0]!; // 'audio/webm' 등 (업로드 Content-Type)

  return {
    contentType: baseType,
    async stop() {
      if (rec.state === 'inactive') return null;
      const done = new Promise<Blob>((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: baseType }));
      });
      try {
        rec.stop();
      } catch {
        return null;
      }
      const blob = await done;
      if (blob.size === 0) return null;
      return { blob, contentType: baseType };
    },
  };
}

/**
 * 녹음본을 서명 URL로 업로드한다.
 * 1) 서버에서 서명 PUT URL 받기 → 2) 그 URL로 직접 PUT (MB가 서버를 안 거친다).
 * 실패해도 예외를 던지지 않는다 — 녹음 업로드 실패가 세션 종료를 막으면 안 된다.
 */
export async function uploadRecording(
  sessionId: string,
  blob: Blob,
  contentType: string,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/sessions/${sessionId}/recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType }),
    });
    if (!res.ok) return false;
    const { uploadUrl, contentType: ct } = (await res.json()) as {
      uploadUrl: string;
      contentType: string;
    };
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': ct },
      body: blob,
    });
    return put.ok;
  } catch {
    return false;
  }
}
