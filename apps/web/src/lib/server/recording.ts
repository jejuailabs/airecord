/**
 * 세션 오디오(원본 발화) 저장 — Firebase Storage.
 *
 * ⚠ Storage 규칙은 `if false`로 완전 잠겨 있다(실측). 브라우저는 Storage를 직접 못 건드린다.
 *   대신 서버가 **서명 URL**을 발급하고, 브라우저는 그 URL로만 PUT/GET 한다.
 *   서명 URL은 서비스 계정이 서명한 1회성 사전허가라 규칙을 우회하지만, 만료가 짧고 경로가 고정이라
 *   그 파일 하나에만, 정해진 시간 동안만 유효하다. 규칙은 그대로 잠가 둘 수 있다(실측 확인).
 *
 * 경로: recordings/{uid}/{sessionId}.webm  — uid를 경로에 박아 소유자 스코프를 강제한다.
 * 오디오는 민감정보다 — 소유자만, 짧은 만료로만 접근한다.
 */
import { getStorage } from 'firebase-admin/storage';
import { adminApp } from '@/lib/firebase/admin';

/** MediaRecorder 기본 산출물 — webm/opus. 브라우저 지원이 안 되면 클라이언트가 대체 타입을 보낸다. */
export const RECORDING_CONTENT_TYPE = 'audio/webm';
const UPLOAD_TTL_MS = 15 * 60 * 1000; // 긴 세션 업로드도 넉넉히
const PLAYBACK_TTL_MS = 60 * 60 * 1000; // 재생 링크는 1시간

function bucket() {
  const name = process.env.STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  return getStorage(adminApp()).bucket(name);
}

const objectPath = (uid: string, sessionId: string) => `recordings/${uid}/${sessionId}.webm`;

/** 브라우저가 녹음본을 올릴 서명 PUT URL */
export async function signUploadUrl(
  uid: string,
  sessionId: string,
  contentType = RECORDING_CONTENT_TYPE,
): Promise<{ url: string; contentType: string }> {
  const [url] = await bucket()
    .file(objectPath(uid, sessionId))
    .getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + UPLOAD_TTL_MS,
      contentType,
    });
  return { url, contentType };
}

/** 소유자에게 줄 서명 재생 URL — 파일이 없으면 null */
export async function signPlaybackUrl(uid: string, sessionId: string): Promise<string | null> {
  const file = bucket().file(objectPath(uid, sessionId));
  const [exists] = await file.exists();
  if (!exists) return null;
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + PLAYBACK_TTL_MS,
  });
  return url;
}

/** 세션·계정 삭제 시 녹음도 지운다 (보관기간 초과 정리에도 쓴다) */
export async function deleteRecording(uid: string, sessionId: string): Promise<void> {
  await bucket()
    .file(objectPath(uid, sessionId))
    .delete()
    .catch(() => undefined); // 없으면 그냥 넘어간다
}
