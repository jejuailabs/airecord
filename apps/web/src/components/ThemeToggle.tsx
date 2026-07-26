'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon, MonitorSmartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';

type Theme = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'sotong-theme';

function applyTheme(t: Theme) {
  const dark =
    t === 'dark' ||
    (t === 'system' && !window.matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

/** 3분할 세그먼트 컨트롤 — 스위치 하나로 3상태를 표현할 수 없다 (docs/05 §5) */
export function ThemeToggle() {
  const t = useTranslations('common.theme');
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const saved = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'system';
    setTheme(saved);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      if ((localStorage.getItem(STORAGE_KEY) ?? 'system') === 'system') applyTheme('system');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const select = (next: Theme) => {
    setTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  };

  const options: Array<{ value: Theme; icon: React.ReactNode; label: string }> = [
    { value: 'light', icon: <Sun size={14} aria-hidden />, label: t('light') },
    { value: 'dark', icon: <Moon size={14} aria-hidden />, label: t('dark') },
    { value: 'system', icon: <MonitorSmartphone size={14} aria-hidden />, label: t('system') },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={t('label')}
      className="flex h-8 items-center rounded-md border border-border bg-bg-sunken p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={theme === o.value}
          title={o.label}
          onClick={() => select(o.value)}
          className={`flex h-7 items-center gap-1 rounded-sm px-2 text-xs transition-colors duration-150 ${
            theme === o.value
              ? 'bg-bg-raised text-text shadow-token'
              : 'text-text-muted hover:text-text'
          }`}
        >
          {o.icon}
          <span className="hidden sm:inline">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
