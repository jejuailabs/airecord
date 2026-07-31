/**
 * 번역 엔진 진입점 (docs/04 §1).
 * apps/web·apps/worker에서 OpenAI/Google SDK를 직접 import하는 것 금지 —
 * 반드시 getEngine()을 거친다.
 */
import type { TranslationEngine } from './types';
import { openaiRealtimeEngine } from './openai-realtime';
import { googleLiveEngine } from './google-live';

export type Provider = 'openai' | 'google';

export function getEngine(provider?: Provider): TranslationEngine {
  const p =
    provider ??
    ((typeof process !== 'undefined' && process.env?.TRANSLATION_PRIMARY_PROVIDER) as Provider | undefined) ??
    'openai';
  return p === 'google' ? googleLiveEngine : openaiRealtimeEngine;
}

export * from './types';
export { createSegmentAssembler } from './segment-assembler';
export { mintTranscriptionKey } from './openai-transcribe';
export type { TranscriptionGrant } from './openai-transcribe';
export { createDiagnostics, summarizeDiag, sourceProviderOf } from './diagnostics';
export {
  resamplePcm16,
  pcm16FromBytes,
  bytesFromPcm16,
  base64FromBytes,
  bytesFromBase64,
  meetingAudioToEngine,
  ENGINE_INPUT_RATE,
  MEETING_BOT_RATE,
} from './audio';
export { unsavedRows, chunkForSave } from './save-queue';
export type { SaveRow } from './save-queue';
export { buildScript, scriptPlainText } from './script';
export type { ScriptBlock, ScriptSegmentInput } from './script';
export type { DiagSnapshot, DiagChannel, ChannelStat } from './diagnostics';
