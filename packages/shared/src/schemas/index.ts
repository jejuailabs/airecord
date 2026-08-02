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
  /**
   * 세션 시작 후 이 시점(초)부터는 잔액이 아니라 **후불 크레딧**으로 달린다 (Pro 이상).
   * 화면이 "포함 토큰 소진 — 후불 과금 중" 배너를 띄우는 기준. 해당 없으면 null.
   */
  postpaidFromSec: z.number().nullable().default(null),
  /** 체험 세션에 허용된 번역 글자수. 비체험이면 null */
  charBudget: z.number().nullable().default(null),
  /**
   * 원문 자막 전용 전사 레그(선택).
   * 통역 모델에 딸린 부가 전사가 실환경 오디오에서 죽는 문제 때문에 분리했다
   * (실측 2026-07-28: 부가 전사 144초에 30자 vs 전용 레그 45초에 741자).
   * 발급 실패 시 null — 그때는 기존 부가 전사로 돌아간다.
   */
  transcribe: z
    .object({
      ephemeralKey: z.string(),
      model: z.string(),
      callUrl: z.string(),
      keyExpiresAt: z.number(),
      /**
       * 이 키에 구워진 원문 언어. 'auto'면 브라우저가 첫 발화들의 문자를 보고
       * `session.update`로 직접 잠근다 — 짧은 발화의 언어 오판을 막는다.
       */
      sourceLang: z.string().default('auto'),
    })
    .nullable()
    .default(null),
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
  /**
   * 이 줄이 어느 스트림에서 왔는가 (engine/types.ts 참고).
   * 'paired'면 원문·번역이 짝지어진 줄, 아니면 한쪽만 채워진 줄이다.
   * 기록·PDF가 이걸 보고 나란히 배치할지 갈라 놓을지 정한다.
   */
  kind: z.enum(['target', 'source', 'paired']).optional(),
  /** 마주통역 화자 구분 (A=내 쪽, B=맞은편). 다른 모드는 넣지 않는다. */
  speaker: z.enum(['A', 'B']).optional(),
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

// ── POST /api/translate/file ────────────────────────
export const translateFilePageSchema = z.object({
  page: z.number().int().positive(),
  text: z.string(),
});

export const translateFilePageImageSchema = z.object({
  page: z.number().int().positive(),
  /** 브라우저가 그린 페이지 이미지 (data URL) */
  dataUrl: z.string().max(3_000_000),
});

export const translateFileRequestSchema = z.object({
  /**
   * 'pdf'      — 글자 레이어에서 뽑은 텍스트
   * 'pdf-scan' — 글자가 없어 페이지를 이미지로 그린 것 (OCR로 읽는다)
   * 'image'    — 사진 한 장
   */
  kind: z.enum(['pdf', 'pdf-scan', 'image']),
  fileName: z.string().max(200),
  sourceLang: sourceLangSchema,
  targetLang: langCodeSchema,
  /** kind === 'pdf' — 클라이언트에서 뽑은 페이지별 텍스트 */
  pages: z.array(translateFilePageSchema).max(200).optional(),
  /** kind === 'pdf-scan' — 페이지별 렌더 이미지 */
  pageImages: z.array(translateFilePageImageSchema).max(20).optional(),
  /** kind === 'image' — data URL */
  dataUrl: z.string().max(12_000_000).optional(),
});
export type TranslateFileRequest = z.infer<typeof translateFileRequestSchema>;

export const translateFileResponseSchema = z.object({
  fileName: z.string(),
  pages: z.array(
    z.object({
      page: z.number(),
      source: z.string(),
      translated: z.string(),
      notes: z.array(z.string()).optional(),
      /**
       * 문단별 원문·번역 짝.
       * 기본 화면은 translated만 쓰고, "원문과 합치기"를 누르면 이걸로 번갈아 배치한다.
       * 서버가 이미 만들어 두므로 합칠 때 API를 다시 부르지 않는다.
       */
      pairs: z
        .array(z.object({ source: z.string(), translated: z.string() }))
        .optional(),
    }),
  ),
  totalChars: z.number(),
});
export type TranslateFileResponse = z.infer<typeof translateFileResponseSchema>;

// ── POST /api/translate/docx ───────────────────────
/**
 * 워드 문서 번역.
 *
 * PDF와 달리 **파일을 서버로 보내지 않는다.** 브라우저가 .docx(=ZIP)를 풀어
 * 문단 글자만 뽑아 보내고, 번역을 받아 제자리에 되쓴 뒤 다시 압축한다.
 * 그래야 원본 서식이 그대로 남고, "파일은 서버에 저장되지 않습니다"도 지켜진다.
 */
export const translateDocxRequestSchema = z.object({
  items: z
    .array(z.object({ n: z.number().int().nonnegative(), text: z.string().max(20_000) }))
    .min(1)
    .max(400),
  sourceLang: sourceLangSchema,
  targetLang: langCodeSchema,
  tone: z.enum(['plain', 'formal', 'casual']).default('plain'),
});
export type TranslateDocxRequest = z.infer<typeof translateDocxRequestSchema>;

export const translateDocxResponseSchema = z.object({
  items: z.array(z.object({ n: z.number(), text: z.string() })),
  /** 모델이 번호를 빠뜨려 번역이 안 온 문단 수 — 호출부는 원문을 그대로 둔다 */
  missing: z.number().default(0),
});
export type TranslateDocxResponse = z.infer<typeof translateDocxResponseSchema>;

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
