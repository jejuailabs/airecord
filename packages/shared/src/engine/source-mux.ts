/**
 * 원문 출처 선택기.
 *
 * 원문 자막을 만들 수 있는 곳이 둘이다:
 *   1. 통역 모델에 딸린 부가 전사 (builtin)  — 실환경 오디오에서 죽는다
 *   2. 전용 전사 레그 (dedicated)            — 죽지 않지만 붙는 데 1초쯤 걸린다
 *
 * 둘을 동시에 조립기에 넣으면 같은 말이 두 번 들어가 원문이 중복된다.
 * 그래서 **항상 하나만** 통과시킨다. WebRTC와 무관한 순수 로직이라 따로 뺐다 — 검증 가능해야 한다.
 */
export type SourceProvider = 'builtin' | 'dedicated';

export interface SourceMux {
  /** 부가 전사 이벤트를 조립기에 넣어도 되는가 */
  acceptBuiltin(now?: number): boolean;
  /** 전용 레그 이벤트를 넣어도 되는가 (넣는 순간 살아있음으로 기록) */
  acceptDedicated(now?: number): boolean;
  /** 전용 레그 연결 실패 — 부가 전사로 되돌린다 */
  fallbackToBuiltin(): void;
  mode(): SourceProvider;
}

export interface SourceMuxOptions {
  /** 전용 레그를 쓸 예정인가 (키 발급 성공 여부) */
  useDedicated: boolean;
  /** 전용 레그가 이 시간 동안 조용하면 부가 전사로 넘어간다 */
  deadMs?: number;
  now?: () => number;
}

export function createSourceMux(opts: SourceMuxOptions): SourceMux {
  const now = opts.now ?? Date.now;
  const deadMs = opts.deadMs ?? 12_000;

  /**
   * ⚠ 연결을 기다리지 않고 처음부터 'dedicated'로 잠근다.
   * 실측: 부가 전사는 2.4초부터, 전용 레그는 5초쯤부터 나온다.
   * 연결 완료를 기다리면 그 사이 발화가 두 출처로 중복 입력된다.
   */
  let mode: SourceProvider = opts.useDedicated ? 'dedicated' : 'builtin';
  let lastDedicatedAt = now();

  return {
    acceptBuiltin(t = now()) {
      if (mode === 'builtin') return true;
      // 전용 레그가 오래 조용하다 — 한 번만, 되돌아가지 않게 넘어간다
      if (t - lastDedicatedAt < deadMs) return false;
      mode = 'builtin';
      return true;
    },
    acceptDedicated(t = now()) {
      lastDedicatedAt = t;
      // 이미 부가 전사로 넘어갔으면 다시 돌아가지 않는다 — 오가면 원문이 뒤섞인다
      return mode === 'dedicated';
    },
    fallbackToBuiltin() {
      mode = 'builtin';
    },
    mode: () => mode,
  };
}
