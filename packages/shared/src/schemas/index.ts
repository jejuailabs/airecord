/**
 * API 입출력 zod 스키마 (docs/02 §1 — 폼/검증과 API가 스키마를 공유한다).
 */
import { z } from 'zod';

export const langCodeSchema = z.enum([
  'ko', 'en', 'ja', 'zh', 'es', 'fr', 'de', 'pt', 'it',
  'ru', 'vi', 'th', 'id', 'ar', 'hi',
]);
export const sourceLangSchema = z.union([langCodeSchema, z.literal('auto')]);

// ── POST /api/session/start ─────────────────────────
export const sessionStartRequestSchema = z.object({
  mode: z.literal('inperson'),
  sourceLang: sourceLangSchema,
  targetLang: langCodeSchema,
  audioOut: z.boolean(),
  title: z.string().max(200).optional(),
  /** 비회원 체험 세션 — 서버가 더 짧은 하드 캡을 적용한다 */
  trial: z.boolean().optional().default(false),
});
export type SessionStartRequest = z.infer<typeof sessionStartRequestSchema>;

export const sessionStartResponseSchema = z.object({
  sessionId: z.string(),
  ephemeralKey: z.string(),
  model: z.string(),
  provider: z.enum(['openai', 'google']),
  callUrl: z.string(),
  keyExpiresAt: z.number(),
  maxDurationSec: z.number(),
  /** 체험 세션에 허용된 번역 글자수. 비체험이면 null */
  charBudget: z.number().nullable().default(null),
});
export type SessionStartResponse = z.infer<typeof sessionStartResponseSchema>;

// ── POST /api/session/heartbeat ─────────────────────
// 서버는 클라이언트가 보낸 경과 시간을 믿지 않는다 — 수신 시각 간격만 센다 (docs/07 §5.1)
export const heartbeatSegmentSchema = z.object({
  seq: z.number().int().nonnegative(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative().optional(),
  sourceText: z.string(),
  targetText: z.string(),
  detectedLang: z.string().optional(),
});
export const sessionHeartbeatRequestSchema = z.object({
  sessionId: z.string(),
  /** 확정 세그먼트 배치 — 개별 쓰기 금지 (docs/01 §4.1) */
  segments: z.array(heartbeatSegmentSchema).max(100).default([]),
  /** 체험 세션이면 서버가 비회원 월 한도에 글자수를 누적한다 */
  trial: z.boolean().optional().default(false),
});
export type SessionHeartbeatRequest = z.infer<typeof sessionHeartbeatRequestSchema>;

export const sessionHeartbeatResponseSchema = z.object({
  terminate: z.boolean(),
  remainingSec: z.number(),
});
export type SessionHeartbeatResponse = z.infer<typeof sessionHeartbeatResponseSchema>;

// ── POST /api/session/end ───────────────────────────
export const sessionEndRequestSchema = z.object({
  sessionId: z.string(),
  reason: z.enum(['user', 'cap', 'error']).default('user'),
  /** 아직 하트비트로 못 보낸 마지막 확정 세그먼트 */
  segments: z.array(heartbeatSegmentSchema).max(200).optional(),
});
export type SessionEndRequest = z.infer<typeof sessionEndRequestSchema>;

export const sessionEndResponseSchema = z.object({
  billedSeconds: z.number(),
  segmentCount: z.number(),
  /** 기록이 저장되었는지 (비회원 체험은 저장하지 않는다) */
  saved: z.boolean().default(false),
});
export type SessionEndResponse = z.infer<typeof sessionEndResponseSchema>;

// ── POST /api/translate/text ────────────────────────
export const translateTextRequestSchema = z.object({
  text: z.string().max(20_000),
  sourceLang: sourceLangSchema,
  targetLang: langCodeSchema,
  tone: z.enum(['plain', 'formal', 'casual']).default('plain'),
});
export type TranslateTextRequest = z.infer<typeof translateTextRequestSchema>;

export const translateTextResponseSchema = z.object({
  translated: z.string(),
  detectedLang: z.string().optional(),
  notes: z.array(z.string()).optional(),
  /** 비회원 체험 잔여 글자수 (로그인 사용자는 null) */
  remainingChars: z.number().nullable().default(null),
});
export type TranslateTextResponse = z.infer<typeof translateTextResponseSchema>;

// ── POST /api/meeting/join (모드 A — Phase 4) ───────
export const meetingJoinRequestSchema = z.object({
  url: z.string().url(),
  sourceLang: sourceLangSchema,
  targetLang: langCodeSchema,
});
export type MeetingJoinRequest = z.infer<typeof meetingJoinRequestSchema>;

export const meetingPlatformSchema = z.enum(['zoom', 'teams', 'meet', 'webex']);

/** 회의 URL → 플랫폼 판별. 붙여넣는 즉시 판별해 아이콘을 띄운다 (docs/06 §2.1) */
export function detectMeetingPlatform(
  url: string,
): z.infer<typeof meetingPlatformSchema> | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.endsWith('zoom.us') || host.endsWith('zoom.com')) return 'zoom';
  if (host.includes('teams.microsoft') || host.includes('teams.live')) return 'teams';
  if (host === 'meet.google.com') return 'meet';
  if (host.endsWith('webex.com')) return 'webex';
  return null;
}
