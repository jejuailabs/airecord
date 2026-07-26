/**
 * Tailwind preset — docs/05 §2 색 토큰의 시맨틱 매핑.
 * 임의 색상 클래스(bg-blue-500 등) 대신 이 토큰만 쓴다.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        'bg-raised': 'var(--bg-raised)',
        'bg-sunken': 'var(--bg-sunken)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        text: 'var(--text)',
        'text-muted': 'var(--text-muted)',
        'text-faint': 'var(--text-faint)',
        accent: 'var(--accent)',
        'accent-weak': 'var(--accent-weak)',
        'accent-text': 'var(--accent-text)',
        'accent-2': 'var(--accent-2)',
        'accent-2-weak': 'var(--accent-2-weak)',
        'accent-2-text': 'var(--accent-2-text)',
        'chart-1': 'var(--chart-1)',
        'chart-2': 'var(--chart-2)',
        warn: 'var(--warn)',
        'warn-weak': 'var(--warn-weak)',
        danger: 'var(--danger)',
        'danger-weak': 'var(--danger-weak)',
        'caption-bg': 'var(--caption-bg)',
        'caption-target': 'var(--caption-target)',
        'caption-source': 'var(--caption-source)',
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '14px',
      },
      boxShadow: {
        token: 'var(--shadow)',
      },
      spacing: {
        // docs/05 §6 간격 스케일 외 값 사용 금지 (tailwind 기본 4px 배수와 호환)
      },
      fontFamily: {
        sans: [
          'Pretendard Variable',
          'Pretendard',
          'Inter',
          'system-ui',
          'sans-serif',
        ],
      },
    },
  },
};
