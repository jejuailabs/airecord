/**
 * 벤더 실시간 이벤트 스트림 → EngineSegment 조립.
 * 모드 B(브라우저 데이터 채널)와 모드 A(워커 WebSocket)가 같은 조립기를 쓴다
 * — 번역 코어는 하나 (core.md §3-3).
 *
 * 원문(입력 전사)과 번역문(응답)은 별개 이벤트 스트림으로 오므로,
 * 발화 시작(speech_started)마다 세그먼트를 열고 양쪽 텍스트를 같은 seq에 모은다.
 * 부분 상태도 매번 emit한다 — 자막은 부분 전사를 즉시 그린다 (docs/01 §5).
 */
import type { EngineSegment } from './types';

interface RealtimeEvent {
  type: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  language?: string;
  error?: { code?: string; message?: string };
  [key: string]: unknown;
}

export interface SegmentAssembler {
  /** 벤더 이벤트(JSON 파싱된 것) 하나를 소화한다 */
  handle(evt: RealtimeEvent): void;
}

export function createSegmentAssembler(
  onSegment: (s: EngineSegment) => void,
  onError?: (code: string, message: string) => void,
): SegmentAssembler {
  const startedAt = Date.now();
  let nextSeq = 0;
  /** item_id → 세그먼트 (입력 전사 이벤트 매칭용) */
  const byItem = new Map<string, EngineSegment>();
  /** 응답 델타가 붙을 가장 최근 세그먼트 */
  let current: EngineSegment | null = null;

  const emit = (s: EngineSegment) => onSegment({ ...s });

  function openSegment(itemId?: string): EngineSegment {
    const seg: EngineSegment = {
      seq: nextSeq++,
      startMs: Date.now() - startedAt,
      sourceText: '',
      targetText: '',
      isFinal: false,
    };
    if (itemId) byItem.set(itemId, seg);
    current = seg;
    return seg;
  }

  function segmentFor(itemId?: string): EngineSegment {
    if (itemId) {
      const found = byItem.get(itemId);
      if (found) return found;
      // speech_started를 놓친 경우(재연결 등) — 새로 연다
      return openSegment(itemId);
    }
    return current ?? openSegment();
  }

  return {
    handle(evt) {
      switch (evt.type) {
        case 'input_audio_buffer.speech_started': {
          openSegment(evt.item_id);
          break;
        }

        // ── 원문(입력 전사) ──────────────────────────
        case 'conversation.item.input_audio_transcription.delta': {
          const seg = segmentFor(evt.item_id);
          seg.sourceText += evt.delta ?? '';
          emit(seg);
          break;
        }
        case 'conversation.item.input_audio_transcription.completed': {
          const seg = segmentFor(evt.item_id);
          seg.sourceText = evt.transcript ?? seg.sourceText;
          if (evt.language) seg.detectedLang = evt.language;
          emit(seg);
          break;
        }

        // ── 번역문(응답) — GA/구 이벤트명 모두 수용 ───
        case 'response.output_text.delta':
        case 'response.text.delta':
        case 'response.output_audio_transcript.delta':
        case 'response.audio_transcript.delta': {
          const seg = current ?? openSegment();
          seg.targetText += evt.delta ?? '';
          emit(seg);
          break;
        }

        case 'response.done': {
          if (current) {
            current.endMs = Date.now() - startedAt;
            current.isFinal = true;
            emit(current);
          }
          break;
        }

        case 'error': {
          onError?.(evt.error?.code ?? 'engine_error', evt.error?.message ?? 'Unknown engine error');
          break;
        }

        default:
          break; // 관심 없는 이벤트는 무시
      }
    },
  };
}
