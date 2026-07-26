'use client';

/**
 * 시안의 설정 행 — 왼쪽 아이콘 칩 + 라벨/설명 + 우측 컨트롤.
 * 대면/회의 통역 시작 화면이 같은 구조를 공유한다.
 */
export function SettingRow({
  icon,
  tone = 'default',
  label,
  hint,
  children,
  right,
}: {
  icon: React.ReactNode;
  tone?: 'default' | 'accent' | 'teal';
  label: string;
  hint?: string;
  /** 라벨 아래 전체 폭 컨트롤 (셀렉트 등) */
  children?: React.ReactNode;
  /** 우측 정렬 컨트롤 (토글 등) */
  right?: React.ReactNode;
}) {
  const chipClass =
    tone === 'accent' ? 'icon-chip icon-chip-accent' : tone === 'teal' ? 'icon-chip icon-chip-teal' : 'icon-chip';

  return (
    <div className="flex items-start gap-4 px-6 py-5">
      <span className={chipClass} aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <span className="text-[15px] font-semibold">{label}</span>
          {right ? <span className="ml-auto shrink-0">{right}</span> : null}
        </div>
        {children ? <div className="mt-2.5">{children}</div> : null}
        {hint ? <p className="mt-2 text-[13.5px] leading-snug text-text-faint">{hint}</p> : null}
      </div>
    </div>
  );
}

/** 시안의 알약형 토글 스위치 */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-150 ${
        checked ? 'bg-accent' : 'bg-bg-sunken border border-border'
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-token transition-[left] duration-150 ${
          checked ? 'left-[26px]' : 'left-[3px]'
        }`}
      />
    </button>
  );
}

/** 카드 안에서 쓰는 셀렉트 — 시안의 어두운 입력 필드 */
export function FieldSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', ...rest } = props;
  return (
    <select
      {...rest}
      className={`h-12 w-full rounded-lg border border-border bg-bg-sunken px-4 text-[16px] font-medium text-text ${className}`}
    />
  );
}
