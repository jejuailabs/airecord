/**
 * 번역 기록 결과물 저장 — Firebase Storage (records.ts의 메타와 짝).
 *
 * 녹음(recording.ts)과 같은 원칙: Storage 규칙은 잠겨 있고, 서버(admin SDK)만 쓰고 읽는다.
 * 결과물은 서버가 직접 저장하고(bucket.save), 다운로드는 짧은 만료의 서명 URL로만 준다.
 * 경로에 uid를 박아 소유자 스코프를 강제한다.
 */
import { getStorage } from 'firebase-admin/storage';
import { adminApp } from '@/lib/firebase/admin';

const DOWNLOAD_TTL_MS = 10 * 60 * 1000; // 다운로드 링크 10분
const UPLOAD_TTL_MS = 10 * 60 * 1000; // 업로드 링크 10분 (브라우저에서 만든 파일용)

function bucket() {
  const name = process.env.STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  return getStorage(adminApp()).bucket(name);
}

/** 결과물 바이트를 저장하고 경로를 돌려준다. ext는 확장자(json·html·docx·hwpx 등). */
export async function saveRecordObject(
  uid: string,
  recordId: string,
  data: Buffer | Uint8Array | string,
  contentType: string,
  ext: string,
): Promise<string> {
  const path = `records/${uid}/${recordId}.${ext}`;
  const body = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  await bucket().file(path).save(body, {
    contentType,
    resumable: false,
    metadata: { cacheControl: 'private, max-age=0' },
  });
  return path;
}

/**
 * 브라우저에서 만든 파일(docx·hwpx)을 올릴 서명 PUT URL.
 * 서버를 거치지 않고 브라우저가 직접 Storage에 올린다 (녹음과 같은 방식).
 * recordId를 새로 만들어 경로와 함께 돌려준다 — 커밋 때 이 경로를 그대로 저장한다.
 */
export async function signRecordUpload(
  uid: string,
  ext: string,
  contentType: string,
): Promise<{ uploadUrl: string; storagePath: string }> {
  const recordId = crypto.randomUUID();
  const storagePath = `records/${uid}/${recordId}.${ext}`;
  const [uploadUrl] = await bucket()
    .file(storagePath)
    .getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + UPLOAD_TTL_MS,
      contentType,
    });
  return { uploadUrl, storagePath };
}

/** 저장된 경로가 이 사용자 것인지 (커밋 때 위조 방지) */
export function isOwnedRecordPath(uid: string, path: string): boolean {
  return path.startsWith(`records/${uid}/`);
}

/** 소유자에게 줄 서명 다운로드 URL — 파일이 없으면 null */
export async function signRecordDownload(
  path: string,
  downloadName?: string | null,
): Promise<string | null> {
  const file = bucket().file(path);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + DOWNLOAD_TTL_MS,
    // 브라우저가 원래 파일명으로 받게 한다
    ...(downloadName
      ? { responseDisposition: `attachment; filename="${encodeURIComponent(downloadName)}"` }
      : {}),
  });
  return url;
}

/** 기록 삭제 시 결과물도 지운다 */
export async function deleteRecordObject(path: string): Promise<void> {
  await bucket().file(path).delete().catch(() => undefined);
}
