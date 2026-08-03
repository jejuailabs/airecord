/**
 * 번역 기록(마이페이지) — 텍스트·파일·원본형 재구성 결과를 보관한다 (사용자 지시 2026-08-03).
 *
 * 그동안 파일 번역 결과는 브라우저(localStorage)에만 남겨 기기를 옮기면 사라졌다.
 * 이제 결과물을 Storage에, 메타데이터를 Firestore에 남겨 마이페이지에서 다시 받게 한다.
 *
 * 보관 정책:
 *   · 등급별 보관일(plan.retentionDays)을 만료 시각으로 계산해 함께 저장한다.
 *   · **Business는 무제한**(expiresAtMs=null). 나머지는 만료일이 지나면 화면에서 "삭제 예정"으로 보인다.
 *   · ⚠ 자동 삭제는 아직 안 한다 — 경고만 띄운다(사용자 지시). 나중에 배치로 실제 삭제를 얹는다.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getPlan } from '@sotong/shared/constants';
import type { PlanId } from '@sotong/shared/types';

const COL = 'translationRecords';
const DAY_MS = 86_400_000;

export type RecordKind = 'text' | 'file' | 'layout';

export interface TranslationRecordInput {
  uid: string;
  workspaceId?: string;
  plan: PlanId;
  kind: RecordKind;
  /** 목록에 보이는 제목 — 파일명이나 원문 첫머리 */
  title: string;
  sourceLang: string;
  targetLang: string;
  /** 목록 미리보기 (번역문 앞부분) */
  preview: string;
  /** Storage에 저장한 결과물 경로 (텍스트 기록은 없을 수 있다) */
  storagePath?: string;
  /** 내려받을 때의 파일명 */
  downloadName?: string;
  /** 결과물 MIME */
  contentType?: string;
  pageCount?: number;
  charCount?: number;
}

export interface TranslationRecord {
  id: string;
  kind: RecordKind;
  title: string;
  sourceLang: string;
  targetLang: string;
  preview: string;
  storagePath: string | null;
  downloadName: string | null;
  contentType: string | null;
  pageCount: number | null;
  charCount: number | null;
  createdAtMs: number | null;
  /** null이면 무제한 보관 (Business) */
  expiresAtMs: number | null;
}

/**
 * 이 플랜의 보관일. **Business는 무제한(null).**
 * (plan.retentionDays는 free 7·starter 30·pro 90·business 365이지만 사용자 지시로 business만 무제한 처리)
 */
export function retentionDaysFor(plan: PlanId): number | null {
  if (plan === 'business') return null;
  return getPlan(plan)?.retentionDays ?? 7;
}

function toMs(v: unknown): number | null {
  const t = v as { toMillis?: () => number } | undefined;
  return typeof t?.toMillis === 'function' ? t.toMillis() : null;
}

/** 기록 하나를 남긴다. 저장 실패가 번역 자체를 막지 않도록 호출부는 예외를 삼킨다. */
export async function saveRecord(input: TranslationRecordInput): Promise<string> {
  const days = retentionDaysFor(input.plan);
  const expiresAtMs = days == null ? null : Date.now() + days * DAY_MS;
  const ref = adminDb().collection(COL).doc();
  await ref.set({
    uid: input.uid,
    workspaceId: input.workspaceId ?? null,
    kind: input.kind,
    title: input.title.slice(0, 200),
    sourceLang: input.sourceLang,
    targetLang: input.targetLang,
    preview: input.preview.slice(0, 300),
    storagePath: input.storagePath ?? null,
    downloadName: input.downloadName ?? null,
    contentType: input.contentType ?? null,
    pageCount: input.pageCount ?? null,
    charCount: input.charCount ?? null,
    createdAt: FieldValue.serverTimestamp(),
    expiresAtMs,
  });
  return ref.id;
}

/** 사용자의 기록 목록 — 최신순. 마이페이지가 이걸 페이지네이션한다. */
export async function listRecords(uid: string, limit = 200): Promise<TranslationRecord[]> {
  try {
    const snap = await adminDb().collection(COL).where('uid', '==', uid).limit(limit).get();
    return snap.docs
      .map((d) => ({
        id: d.id,
        kind: (d.get('kind') as RecordKind) ?? 'file',
        title: (d.get('title') as string) ?? '',
        sourceLang: (d.get('sourceLang') as string) ?? 'auto',
        targetLang: (d.get('targetLang') as string) ?? 'en',
        preview: (d.get('preview') as string) ?? '',
        storagePath: (d.get('storagePath') as string | null) ?? null,
        downloadName: (d.get('downloadName') as string | null) ?? null,
        contentType: (d.get('contentType') as string | null) ?? null,
        pageCount: (d.get('pageCount') as number | null) ?? null,
        charCount: (d.get('charCount') as number | null) ?? null,
        createdAtMs: toMs(d.get('createdAt')),
        expiresAtMs: (d.get('expiresAtMs') as number | null) ?? null,
      }))
      .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
  } catch (e) {
    console.error('[records] list failed', e);
    return [];
  }
}

/** 소유자 확인 후 기록 하나 (다운로드·삭제용) */
export async function getRecord(uid: string, id: string): Promise<TranslationRecord | null> {
  try {
    const doc = await adminDb().collection(COL).doc(id).get();
    if (!doc.exists || doc.get('uid') !== uid) return null;
    return {
      id: doc.id,
      kind: (doc.get('kind') as RecordKind) ?? 'file',
      title: (doc.get('title') as string) ?? '',
      sourceLang: (doc.get('sourceLang') as string) ?? 'auto',
      targetLang: (doc.get('targetLang') as string) ?? 'en',
      preview: (doc.get('preview') as string) ?? '',
      storagePath: (doc.get('storagePath') as string | null) ?? null,
      downloadName: (doc.get('downloadName') as string | null) ?? null,
      contentType: (doc.get('contentType') as string | null) ?? null,
      pageCount: (doc.get('pageCount') as number | null) ?? null,
      charCount: (doc.get('charCount') as number | null) ?? null,
      createdAtMs: toMs(doc.get('createdAt')),
      expiresAtMs: (doc.get('expiresAtMs') as number | null) ?? null,
    };
  } catch (e) {
    console.error('[records] get failed', e);
    return null;
  }
}

/** 소유자 확인 후 기록 삭제 (메타 + Storage 파일) */
export async function deleteRecord(uid: string, id: string): Promise<boolean> {
  const rec = await getRecord(uid, id);
  if (!rec) return false;
  if (rec.storagePath) await deleteRecordFile(rec.storagePath).catch(() => undefined);
  await adminDb().collection(COL).doc(id).delete().catch(() => undefined);
  return true;
}

// deleteRecordFile은 records-storage.ts에 있다 (순환 참조 피하려 지연 import)
async function deleteRecordFile(path: string): Promise<void> {
  const { deleteRecordObject } = await import('./records-storage');
  await deleteRecordObject(path);
}
