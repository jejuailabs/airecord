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
import { createSourceMux } from './source-mux';

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
   * 원문(입력) 언어 교체.
   *
   * 통역 모델은 입력 언어를 받지 않지만 **전사 레그는 받는다.** 그래서 이건 자막 전용이다.
   * 무전기가 방향을 뒤집으면(듣기↔말하기) 마이크에 들어오는 언어도 뒤집히므로 같이 불러야 한다.
   * 'auto'를 주면 다시 자동 감지로 돌아간다.
   */
  setSourceLang(lang: string): void;
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

/** 원문 자막 전용 전사 레그 — 통역과 별개 세션 (openai-transcribe.ts 참고) */
export interface TranscribeLegGrant {
  ephemeralKey: string;
  model: string;
  callUrl: string;
  /** 서버가 알고 있으면 넣어준다. 'auto'이거나 없으면 아래에서 스스로 정한다. */
  sourceLang?: string;
}

/**
 * 전사 결과의 문자만 보고 언어를 가늠한다.
 * 길게 판별할 필요가 없다 — 여기서 필요한 건 "무슨 문자를 쓰는 언어인가"뿐이다.
 * 애매하면 null을 돌려 잠그지 않는다 (틀린 언어로 잠그는 것이 가장 나쁘다).
 */
function guessTranscriptLang(text: string): string | null {
  const t = text.trim();
  if (t.length < 2) return null;
  if (/[가-힣]/.test(t)) return 'ko';
  if (/[぀-ヿ]/.test(t)) return 'ja';
  if (/[一-鿿]/.test(t)) return 'zh';
  if (/[Ѐ-ӿ]/.test(t)) return 'ru';
  if (/[฀-๿]/.test(t)) return 'th';
  if (/[؀-ۿ]/.test(t)) return 'ar';
  // 라틴 문자는 언어가 갈리지 않으므로 잠그지 않는다
  return null;
}

export async function connectBrowserSession(
  grant: EphemeralGrant,
  micStream: MediaStream,
  cbs: BrowserSessionCallbacks,
  transcribeGrant?: TranscribeLegGrant | null,
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

  /** 원문 출처는 항상 하나만 — 판단 로직은 source-mux.ts (검증 가능하게 분리) */
  const mux = createSourceMux({ useDedicated: Boolean(transcribeGrant) });

  dc.addEventListener('message', (ev) => {
    let parsed: { type?: string; delta?: string; error?: unknown };
    try {
      parsed = JSON.parse(ev.data as string);
    } catch {
      return; // 비JSON 프레임 무시
    }
    const type = parsed.type ?? '';
    const ch = channelOf(type);

    if (ch === 'source') {
      const before = mux.mode();
      if (!mux.acceptBuiltin()) return; // 전용 레그가 살아 있다 — 부가 전사는 버린다
      if (before !== 'builtin') diag.note('전용 전사 침묵 — 부가 전사로 폴백');
    }

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

  /**
   * 원문 자막 전용 전사 레그 — 같은 마이크 트랙을 두 번째 세션에도 보낸다.
   * 통역 레그는 이미 연결된 뒤이므로, 여기서 실패해도 통역은 그대로 간다.
   */
  let transcribePc: RTCPeerConnection | null = null;
  /** 전사 레그가 붙었을 때만 채워진다. 없으면 원문 언어를 바꿀 방법도 없다. */
  let applySourceLang: ((lang: string) => void) | null = null;
  if (transcribeGrant) {
    try {
      const tpc = new RTCPeerConnection();
      for (const track of micStream.getAudioTracks()) tpc.addTrack(track, micStream);
      const tdc = tpc.createDataChannel('oai-events');

      tdc.addEventListener('message', (ev) => {
        let parsed: { type?: string; delta?: string; error?: unknown };
        try {
          parsed = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        const type = parsed.type ?? '';
        if (type === 'error' || parsed.error) {
          diag.record('error', 0);
          diag.note(`transcribe: ${JSON.stringify(parsed).slice(0, 200)}`);
          return;
        }
        /**
         * VAD 경계(speech_started/stopped)도 조립기에 넘긴다 — 자막 칸의 뼈대가 된다.
         * 이게 번역보다 먼저 오기 때문에 자막이 밀리지 않는다.
         */
        const isVad =
          type === 'input_audio_buffer.speech_started' ||
          type === 'input_audio_buffer.speech_stopped';
        if (!isVad && !type.includes('input_audio_transcription')) return;

        if (!mux.acceptDedicated()) return; // 이미 부가 전사로 넘어갔다 — 섞지 않는다

        // 확정된 발화의 문자로 언어를 가늠한다. 짧은 것은 못 믿으니 세 번 이상 같아야 잠근다.
        if (!langLocked && type.endsWith('input_audio_transcription.completed')) {
          const transcript = typeof (parsed as { transcript?: string }).transcript === 'string'
            ? (parsed as { transcript?: string }).transcript!
            : '';
          const guess = guessTranscriptLang(transcript);
          if (guess) {
            langVotes.push(guess);
            const top = langVotes.filter((v) => v === guess).length;
            if (top >= 3) lockLanguage(guess);
          }
        }

        if (!isVad) diag.record('source', (parsed.delta ?? '').length);
        assembler.handle(parsed as Parameters<typeof assembler.handle>[0]);
      });

      tpc.addEventListener('connectionstatechange', () => {
        if (tpc.connectionState === 'failed' || tpc.connectionState === 'closed') {
          diag.note(`transcribe pc ${tpc.connectionState}`);
        }
      });

      /**
       * 원문 언어 자동 잠금.
       *
       * 전사 모델은 힌트가 없으면 **발화마다 언어를 새로 추측한다.** 긴 문장은 잘 맞히지만
       * 짧은 발화("아 네", "그쵸")에서 자주 틀려 한국어를 중국어·태국어로 받아적는다
       * (실사용 화면에 "安定化" "อะ" "我要看"이 그렇게 떴다).
       *
       * 실측(2026-07-28, 짧은 조각 26개):
       *   자동 감지   → 다른 언어 4개, 한글 없는 발화 9개
       *   language=ko → 다른 언어 0개, 한글 없는 발화 1개
       *
       * 화면에 원문 언어를 고르는 자리가 없으므로, **처음 몇 발화를 보고 스스로 정한 뒤 잠근다.**
       * 잠근 뒤에는 바꾸지 않는다 — 오가면 같은 세션에서 언어가 널뛴다.
       */
      let langLocked = Boolean(transcribeGrant.sourceLang && transcribeGrant.sourceLang !== 'auto');
      const langVotes: string[] = [];

      /** 전사 세션에 언어를 실제로 밀어 넣는다. 실측: 세션 도중에도 받아준다(약 0.2초). */
      const sendLang = (lang: string | null) => {
        if (tdc.readyState !== 'open') return false;
        tdc.send(
          JSON.stringify({
            type: 'session.update',
            // ⚠ session.type을 빼면 missing_required_parameter로 거부된다 (실측)
            session: {
              type: 'transcription',
              audio: {
                input: {
                  transcription: {
                    model: transcribeGrant.model,
                    ...(lang ? { language: lang } : {}),
                  },
                },
              },
            },
          }),
        );
        return true;
      };

      /** 자동 감지가 스스로 정한 결과 — 이미 잠겼거나 사용자가 지정했으면 무시된다 */
      const lockLanguage = (lang: string) => {
        if (langLocked || !sendLang(lang)) return;
        langLocked = true;
        diag.note(`원문 언어 ${lang}로 잠금 (자동 감지, 짧은 발화 오판 방지)`);
      };

      /** 사용자·모드가 명시한 값 — 자동 감지보다 항상 우선한다 */
      applySourceLang = (lang: string) => {
        const explicit = lang && lang !== 'auto' ? lang : null;
        if (!sendLang(explicit)) return;
        langLocked = Boolean(explicit);
        langVotes.length = 0;
        diag.note(explicit ? `원문 언어 ${explicit} 지정` : '원문 언어 자동 감지로 되돌림');
      };

      const toffer = await tpc.createOffer();
      await tpc.setLocalDescription(toffer);
      const tres = await fetch(transcribeGrant.callUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${transcribeGrant.ephemeralKey}`,
          'Content-Type': 'application/sdp',
        },
        body: toffer.sdp,
      });
      if (!tres.ok) {
        mux.fallbackToBuiltin();
        diag.note(`transcribe SDP 실패 ${tres.status} — 부가 전사로 복귀`);
        tpc.close();
      } else {
        await tpc.setRemoteDescription({ type: 'answer', sdp: await tres.text() });
        transcribePc = tpc;
        diag.note(`transcribe leg connected (${transcribeGrant.model}) — 원문은 이쪽만 쓴다`);
      }
    } catch (e) {
      // 원문 레그 실패가 통역을 멈추게 하면 안 된다
      mux.fallbackToBuiltin();
      diag.note(`transcribe leg error: ${String(e).slice(0, 120)} — 부가 전사로 복귀`);
    }
  }

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
    setSourceLang(lang) {
      // 전사 레그가 없으면 원문 언어를 바꿀 대상 자체가 없다 — 조용히 넘어간다
      applySourceLang?.(lang);
    },
    close() {
      assembler.dispose();
      try {
        dc.close();
      } catch {
        /* noop */
      }
      // ⚠ 전사 레그를 먼저 닫는다. 같은 트랙을 공유하므로 트랙 정지는 아래에서 한 번만 한다.
      try {
        transcribePc?.close();
      } catch {
        /* noop */
      }
      pc.getSenders().forEach((s) => s.track?.stop());
      pc.close();
    },
  };
}
