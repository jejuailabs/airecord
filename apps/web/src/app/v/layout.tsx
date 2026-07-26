import '../globals.css';

/**
 * 자막 뷰어 루트 레이아웃 — locale 세그먼트 밖, 인증 불필요 (docs/06 §1).
 * 로그인 없이 열리므로 테마는 localStorage만 사용하고,
 * 자막 패널 자체는 테마와 무관하게 항상 어둡다 (docs/05 §5).
 */
const themeInitScript = `
(function () {
  try {
    var t = localStorage.getItem('sotong-theme') || 'system';
    var dark = t === 'dark';
    if (t === 'system') {
      dark = !window.matchMedia('(prefers-color-scheme: light)').matches;
    }
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`;

export default function ViewerLayout({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-screen bg-bg text-text antialiased">{children}</body>
    </html>
  );
}
