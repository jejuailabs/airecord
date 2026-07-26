'use client';

import { Check } from 'lucide-react';

export interface StepDef {
  id: number;
  icon: React.ReactNode;
  label: string;
  /** 이 단계가 완료되었는가 */
  done: boolean;
  /** 아직 열리지 않은 단계인가 */
  locked: boolean;
}

/**
 * 시작 화면 상단 스텝 인디케이터.
 * 완료된 단계는 그라데이션으로 채워지고, 현재 단계는 강조 링, 이후 단계는 흐리게.
 * 완료·현재 단계는 눌러서 되돌아갈 수 있다.
 */
export function SetupStepper({
  steps,
  current,
  onSelect,
}: {
  steps: StepDef[];
  current: number;
  onSelect: (id: number) => void;
}) {
  return (
    <ol className="flex items-start justify-center gap-1 sm:gap-2">
      {steps.map((s, i) => {
        const active = s.id === current;
        const state = s.done ? 'done' : active ? 'active' : 'todo';
        return (
          <li key={s.id} className="flex items-start">
            <button
              type="button"
              disabled={s.locked}
              onClick={() => onSelect(s.id)}
              aria-current={active ? 'step' : undefined}
              className="flex w-[84px] flex-col items-center gap-2 disabled:cursor-not-allowed sm:w-[104px]"
            >
              <span
                className={`flex h-14 w-14 items-center justify-center rounded-2xl transition-all duration-200 ${
                  state === 'done'
                    ? 'cta-orb-violet text-white shadow-token'
                    : state === 'active'
                      ? 'bg-accent-weak text-accent ring-2 ring-[color:var(--accent)]'
                      : 'bg-bg-sunken text-text-faint opacity-60'
                }`}
              >
                {s.done ? <Check size={24} /> : s.icon}
              </span>
              <span
                className={`text-center text-[12.5px] leading-tight ${
                  state === 'todo' ? 'text-text-faint' : 'font-semibold text-text'
                }`}
              >
                <span className="block text-[10.5px] font-medium text-text-faint">
                  STEP {s.id}
                </span>
                {s.label}
              </span>
            </button>
            {i < steps.length - 1 ? (
              <span
                aria-hidden
                className={`mt-7 h-[2px] w-3 rounded-full sm:w-6 ${
                  steps[i]!.done ? 'bg-accent' : 'bg-border'
                }`}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
