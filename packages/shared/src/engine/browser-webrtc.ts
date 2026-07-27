/**
 * 모드 B — 브라우저 ↔ 번역 모델 WebRTC 직결 (docs/01 §1, docs/04 §3).
 * 서버 경유 홉이 없어야 한다. 이 모듈은 브라우저에서만 실행된다.
 *
 * 세션 설정(지시문·모달리티)은 mint 시점에 서버가 구웠다.
 * 브라우저는 SDP 교환과 음성 출력 토글만 담당한다.
 */
import type { EngineError, EngineSegment, EphemeralGrant } from './types';
import { createSegmentAssembler } from './segment-assembler';
import { createDiagnostics, type DiagSnapshot } from './diagnostics';

export interface BrowserSessionCallbacks {
  onSegment: (s: EngineSegment) => void;
  /** 번역 오디오 트랙 수신 — <audio> 엘리먼트에 붙여 재생 */
  onAudioTrack?: (stream: MediaStream) => void;
  onError?: (e: EngineError) => void;
  onStateChange?: (state: RTCPeerConnectionState) => void;
}

export interface BrowserTranslationSession {
  close(): void;
  /**
   * 통역 중 출력 언어 교체.
   * 실측(2026-07-27): 번역 엔드포인트는 `session.update`로 `audio.output.language`만
   * 부분 패치해도 `session.updated`로 확인해 준다 — 재연결이 필요 없다.
   * 응답까지 약 0.2초. 무전기 모드(듣기↔말하기)도 이 위에서 돈다.
   */
  setTargetLang(lang: string): void;
  /**
   * 수신 오디오 실측치.
   * "소리가 안 난다"를 추측으로 다루지 않기 위한 계기다.
   * 패킷이 0이면 전송 문제, 패킷은 오는데 레벨이 0이면 모델이 무음을 보낸 것,
   * 둘 다 정상인데 안 들리면 기기(iOS 출력 경로) 문제로 확정할 수 있다.
   */
  getAudioStats(): Promise<AudioInboundStats | null>;
  /** 원문·번역·음성 세 갈래 계측 — 어디서 끊겼는지 특정하는 데 쓴다 */
  getDiagnostics(): DiagSnapshot;
  readonly model: string;
}

export interface AudioInboundStats {
  packetsReceived: number;
  bytesReceived: number;
  /** 0~1. 마지막 관측 구간의 입력 레벨 */
  audioLevel: number;
  /** 누적 에너지 — 0이면 세션 내내 무음이었다는 뜻 */
  totalAudioEnergy: number;
}

export async function connectBrowserSession(
  grant: EphemeralGrant,
  micStream: MediaStream,
  cbs: BrowserSessionCallbacks,
): Promise<BrowserTranslationSession> {
  const pc = new RTCPeerConnection();

  // addTrack이 만드는 sendrecv 트랜시버 하나로 송신·수신을 모두 처리한다.
  // 여기에 recvonly 트랜시버를 추가하면 오디오 m-line이 둘이 되어 협상이 어긋난다.
  for (const track of micStream.getAudioTracks()) {
    pc.addTrack(track, micStream);
  }

  const dc = pc.createDataChannel('oai-events');
  const diag = createDiagnostics();
  const assembler = createSegmentAssembler(
    (s) => {
      if (s.isFinal) diag.recordSegment(s);
      cbs.onSegment(s);
    },
    (code, message) => {
      diag.record('error', 0);
      diag.note(`engine error: ${code} ${message}`.slice(0, 160));
      cbs.onError?.({ code, message, fatal: false });
    },
    { targetLang: grant.targetLang },
  );

  /** 이벤트를 세 갈래로 분류한다 — 계측의 기준이자 조립기의 기준과 같아야 한다 */
  const channelOf = (type: string) => {
    if (type.includes('input_transcript') || type.includes('input_audio_transcription')) {
      return 'source' as const;
    }
    if (type.includes('output_transcript') || type.includes('output_text')) return 'target' as const;
    if (type.includes('output_audio')) return 'audio' as const;
    if (type === 'error' || type.endsWith('.error')) return 'error' as const;
    return 'other' as const;
  };

  dc.addEventListener('message', (ev) => {
    let parsed: { type?: string; delta?: string; error?: unknown };
    try {
      parsed = JSON.parse(ev.data as string);
    } catch {
      return; // 비JSON 프레임 무시
    }
    const type = parsed.type ?? '';
    const ch = channelOf(type);
    diag.record(ch, (parsed.delta ?? '').length);
    if (ch === 'error' || parsed.error) {
      diag.note(`server: ${JSON.stringify(parsed).slice(0, 200)}`);
    } else if (ch === 'other') {
      // 예상 못 한 이벤트가 오면 그것도 남긴다 — 프로토콜이 바뀌면 여기서 먼저 보인다
      diag.note(`event: ${type}`);
    }
    assembler.handle(parsed as Parameters<typeof assembler.handle>[0]);
  });

  dc.addEventListener('open', () => diag.note('datachannel open'));
  dc.addEventListener('close', () => diag.note('datachannel close'));

  // 번역 오디오 수신 채널 (옵션 — 음성은 2순위, core.md §3-2)
  pc.addEventListener('track', (ev) => {
    if (ev.track.kind !== 'audio') return;
    // msid가 없으면 streams가 비어 온다 — 트랙만으로 스트림을 만들어 유실을 막는다
    const stream = ev.streams[0] ?? new MediaStream([ev.track]);
    diag.note(`audio track (streams=${ev.streams.length}, muted=${ev.track.muted})`);
    ev.track.addEventListener('mute', () => diag.note('audio track muted'));
    ev.track.addEventListener('unmute', () => diag.note('audio track unmuted'));
    ev.track.addEventListener('ended', () => diag.note('audio track ended'));
    cbs.onAudioTrack?.(stream);
  });
  pc.addEventListener('connectionstatechange', () => {
    diag.note(`pc ${pc.connectionState}`);
    cbs.onStateChange?.(pc.connectionState);
    if (pc.connectionState === 'failed') {
      cbs.onError?.({ code: 'webrtc_failed', message: 'WebRTC connection failed', fatal: true });
    }
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const res = await fetch(`${grant.callUrl}?model=${encodeURIComponent(grant.model)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${grant.key}`,
      'Content-Type': 'application/sdp',
    },
    body: offer.sdp,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    pc.close();
    throw new Error(`Realtime SDP exchange failed: ${res.status} ${body.slice(0, 300)}`);
  }
  await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });

  return {
    model: grant.model,
    // ⚠ 음성 on/off는 session.update로 바꾸지 않는다.
    // 번역 엔드포인트는 output_modalities를 모르며, 잘못된 session.update를 보내면
    // 세션 설정이 깨져 번역이 멈춘다 — 재생 측에서 음소거로만 제어한다.
    // 반면 audio.output.language 패치는 실측으로 안전함을 확인했다.
    getDiagnostics() {
      return diag.snapshot();
    },
    async getAudioStats() {
      try {
        const report = await pc.getStats();
        let found: AudioInboundStats | null = null;
        report.forEach((s) => {
          const stat = s as RTCStats & {
            kind?: string;
            mediaType?: string;
            packetsReceived?: number;
            bytesReceived?: number;
            audioLevel?: number;
            totalAudioEnergy?: number;
          };
          if (stat.type !== 'inbound-rtp') return;
          if ((stat.kind ?? stat.mediaType) !== 'audio') return;
          found = {
            packetsReceived: stat.packetsReceived ?? 0,
            bytesReceived: stat.bytesReceived ?? 0,
            audioLevel: stat.audioLevel ?? 0,
            totalAudioEnergy: stat.totalAudioEnergy ?? 0,
          };
        });
        return found;
      } catch {
        return null;
      }
    },
    setTargetLang(lang) {
      if (dc.readyState !== 'open') return;
      assembler.setTargetLang(lang);
      dc.send(
        JSON.stringify({
          type: 'session.update',
          session: { audio: { output: { language: lang } } },
        }),
      );
    },
    close() {
      assembler.dispose();
      try {
        dc.close();
      } catch {
        /* noop */
      }
      pc.getSenders().forEach((s) => s.track?.stop());
      pc.close();
    },
  };
}
