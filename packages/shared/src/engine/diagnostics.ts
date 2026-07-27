/**
 * 통역 파이프라인 계측.
 *
 * "원문이 안 나온다"를 눈으로만 보면 어디가 끊겼는지 알 수 없다.
 * 갈래가 셋이고 각각 다른 이유로 멈춘다:
 *   1. 원문 전사 (session.input_transcript.delta)
 *   2. 번역 텍스트 (session.output_transcript.delta)
 *   3. 통역 음성 (WebRTC inbound-rtp)
 * 세 갈래를 따로 세고 마지막 도착 시각을 남기면, 멈춘 지점이 바로 특정된다.
 */

export type DiagChannel = 'source' | 'target' | 'audio' | 'other' | 'error';

export interface ChannelStat {
  /** 이벤트 수 */
  events: number;
  /** 누적 글자수 (audio는 0) */
  chars: number;
  /** 세션 시작 기준 첫 도착 (ms). 아직 없으면 null */
  firstAtMs: number | null;
  /** 세션 시작 기준 마지막 도착 (ms) */
  lastAtMs: number | null;
  /** 도착 간격이 가장 길었던 구간 (ms) — 여기서 멈췄었다는 뜻 */
  maxGapMs: number;
}

export interface DiagSnapshot {
  elapsedMs: number;
  channels: Record<DiagChannel, ChannelStat>;
  /** 조립기가 내보낸 자막 통계 */
  segments: {
    total: number;
    /** 원문이 비어 있는 자막 — 이게 많으면 원문 전사가 끊긴 것이다 */
    missingSource: number;
    /** 번역이 비어 있는 자막 */
    missingTarget: number;
    /** 같은 언어라 번역을 건너뛴 자막 */
    passthrough: number;
  };
  /** 최근 이벤트 흐름 (오래된 것부터) */
  timeline: Array<{ atMs: number; ch: DiagChannel; chars: number }>;
  notes: string[];
}

const TIMELINE_MAX = 600;

function emptyStat(): ChannelStat {
  return { events: 0, chars: 0, firstAtMs: null, lastAtMs: null, maxGapMs: 0 };
}

export interface EngineDiagnostics {
  record(ch: DiagChannel, chars: number): void;
  /** 조립기가 자막을 확정할 때 호출 */
  recordSegment(s: { sourceText: string; targetText: string; sameAsTarget?: boolean }): void;
  note(message: string): void;
  snapshot(): DiagSnapshot;
}

export function createDiagnostics(now: () => number = Date.now): EngineDiagnostics {
  const startedAt = now();
  const channels: Record<DiagChannel, ChannelStat> = {
    source: emptyStat(),
    target: emptyStat(),
    audio: emptyStat(),
    other: emptyStat(),
    error: emptyStat(),
  };
  const timeline: DiagSnapshot['timeline'] = [];
  const notes: string[] = [];
  const seg = { total: 0, missingSource: 0, missingTarget: 0, passthrough: 0 };

  return {
    record(ch, chars) {
      const at = now() - startedAt;
      const c = channels[ch];
      if (c.lastAtMs !== null) c.maxGapMs = Math.max(c.maxGapMs, at - c.lastAtMs);
      if (c.firstAtMs === null) c.firstAtMs = at;
      c.lastAtMs = at;
      c.events += 1;
      c.chars += chars;
      timeline.push({ atMs: at, ch, chars });
      if (timeline.length > TIMELINE_MAX) timeline.shift();
    },

    recordSegment(s) {
      seg.total += 1;
      if (!s.sourceText.trim()) seg.missingSource += 1;
      if (!s.targetText.trim()) seg.missingTarget += 1;
      if (s.sameAsTarget) seg.passthrough += 1;
    },

    note(message) {
      notes.push(`+${((now() - startedAt) / 1000).toFixed(1)}s ${message}`);
      if (notes.length > 100) notes.shift();
    },

    snapshot() {
      return {
        elapsedMs: now() - startedAt,
        channels: {
          source: { ...channels.source },
          target: { ...channels.target },
          audio: { ...channels.audio },
          other: { ...channels.other },
          error: { ...channels.error },
        },
        segments: { ...seg },
        timeline: [...timeline],
        notes: [...notes],
      };
    },
  };
}

/** 사람이 읽는 한 줄 요약 — 화면과 로그에 같은 문장을 쓴다 */
export function summarizeDiag(d: DiagSnapshot): string {
  const sec = (ms: number | null) => (ms === null ? '없음' : `${(ms / 1000).toFixed(1)}s`);
  const since = (ms: number | null) =>
    ms === null ? '—' : `${((d.elapsedMs - ms) / 1000).toFixed(0)}초 전`;
  return [
    `경과 ${(d.elapsedMs / 1000).toFixed(0)}초`,
    `원문 ${d.channels.source.events}회/${d.channels.source.chars}자 (마지막 ${since(d.channels.source.lastAtMs)}, 최대공백 ${sec(d.channels.source.maxGapMs)})`,
    `번역 ${d.channels.target.events}회/${d.channels.target.chars}자 (마지막 ${since(d.channels.target.lastAtMs)}, 최대공백 ${sec(d.channels.target.maxGapMs)})`,
    `음성 ${d.channels.audio.events}회`,
    `자막 ${d.segments.total}개 (원문없음 ${d.segments.missingSource}, 번역없음 ${d.segments.missingTarget}, 동일언어 ${d.segments.passthrough})`,
    d.channels.error.events ? `오류 ${d.channels.error.events}회` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
