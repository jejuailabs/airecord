/**
 * 모드 B — 브라우저 ↔ 번역 모델 WebRTC 직결 (docs/01 §1, docs/04 §3).
 * 서버 경유 홉이 없어야 한다. 이 모듈은 브라우저에서만 실행된다.
 *
 * 세션 설정(지시문·모달리티)은 mint 시점에 서버가 구웠다.
 * 브라우저는 SDP 교환과 음성 출력 토글만 담당한다.
 */
import type { EngineError, EngineSegment, EphemeralGrant } from './types';
import { createSegmentAssembler } from './segment-assembler';

export interface BrowserSessionCallbacks {
  onSegment: (s: EngineSegment) => void;
  /** 번역 오디오 트랙 수신 — <audio> 엘리먼트에 붙여 재생 */
  onAudioTrack?: (stream: MediaStream) => void;
  onError?: (e: EngineError) => void;
  onStateChange?: (state: RTCPeerConnectionState) => void;
}

export interface BrowserTranslationSession {
  close(): void;
  readonly model: string;
}

export async function connectBrowserSession(
  grant: EphemeralGrant,
  micStream: MediaStream,
  cbs: BrowserSessionCallbacks,
): Promise<BrowserTranslationSession> {
  const pc = new RTCPeerConnection();

  // 번역 오디오 수신 채널 (옵션 — 음성은 2순위, core.md §3-2)
  pc.addEventListener('track', (ev) => {
    if (ev.track.kind === 'audio' && ev.streams[0]) {
      cbs.onAudioTrack?.(ev.streams[0]);
    }
  });
  pc.addEventListener('connectionstatechange', () => {
    cbs.onStateChange?.(pc.connectionState);
    if (pc.connectionState === 'failed') {
      cbs.onError?.({ code: 'webrtc_failed', message: 'WebRTC connection failed', fatal: true });
    }
  });

  for (const track of micStream.getAudioTracks()) {
    pc.addTrack(track, micStream);
  }

  // 번역 오디오를 받기 위한 수신 전용 트랜시버 — 마이크 트랙만으로는 협상되지 않을 수 있다
  pc.addTransceiver('audio', { direction: 'recvonly' });

  const dc = pc.createDataChannel('oai-events');
  const assembler = createSegmentAssembler(
    (s) => cbs.onSegment(s),
    (code, message) => cbs.onError?.({ code, message, fatal: false }),
  );
  dc.addEventListener('message', (ev) => {
    try {
      assembler.handle(JSON.parse(ev.data as string));
    } catch {
      /* 비JSON 프레임 무시 */
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
    // ⚠ 음성 on/off를 session.update로 바꾸지 않는다.
    // 번역 엔드포인트는 output_modalities를 모르며, 잘못된 session.update를 보내면
    // 세션 설정(출력 언어)이 깨져 번역이 멈춘다 — 재생 측에서 음소거로만 제어한다.
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
