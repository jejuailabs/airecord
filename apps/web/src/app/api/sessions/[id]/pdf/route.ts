import { NextResponse } from 'next/server';
import { currentUid, getSessionDetail } from '@/lib/server/sessions-query';
import { languageLabel } from '@sotong/shared/constants';
import type { SourceLangSetting } from '@sotong/shared/types';

export const runtime = 'nodejs';

/**
 * 세션 기록 PDF 내보내기 (docs/08 §1).
 *
 * 서버에서 PDF 바이너리를 직접 굽지 않고, 인쇄용 HTML을 내려보내
 * 브라우저의 인쇄→PDF 저장을 띄운다. 한글 폰트 임베딩 문제(서버 PDF 라이브러리는
 * CJK 폰트를 따로 넣어야 한다)를 피하면서 표지·2열 대조 레이아웃을 그대로 얻는다.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMs(ms: number) {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const uid = await currentUid();
  if (!uid) {
    return NextResponse.json({ error: 'auth_required' }, { status: 401 });
  }
  const d = await getSessionDetail(uid, id);
  if (!d) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const title = d.summary?.title ?? d.title ?? 'InterLive 통역 기록';
  const date = d.startedAtMs ? new Date(d.startedAtMs).toLocaleString('ko-KR') : '';
  const s = d.summary;

  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Pretendard Variable', Pretendard, system-ui, sans-serif; color: #14172B; font-size: 11pt; line-height: 1.6; margin: 0; }
  .cover { border-bottom: 2px solid #6D5AE8; padding-bottom: 14px; margin-bottom: 22px; }
  .brand { color: #6D5AE8; font-weight: 700; font-size: 10pt; letter-spacing: .04em; }
  h1 { font-size: 20pt; margin: 6px 0 8px; line-height: 1.25; }
  .meta { color: #5A6079; font-size: 9.5pt; }
  h2 { font-size: 12.5pt; margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #E2E5F0; }
  ul { margin: 0; padding-left: 18px; }
  li { margin-bottom: 4px; }
  .owner { background: #EDEAFD; color: #6D5AE8; font-size: 8.5pt; font-weight: 700; padding: 1px 5px; border-radius: 3px; margin-left: 5px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { text-align: left; font-size: 8.5pt; color: #5A6079; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid #E2E5F0; padding: 5px 6px; }
  td { vertical-align: top; padding: 7px 6px; border-bottom: 1px solid #F0F1F6; font-size: 10pt; }
  td.time { width: 46px; color: #8A90A8; font-variant-numeric: tabular-nums; font-size: 8.5pt; }
  td.src { color: #5A6079; width: 42%; }
  tr { break-inside: avoid; }
  .print-hint { background: #EDEAFD; color: #4B3FB5; padding: 10px 14px; border-radius: 8px; margin-bottom: 18px; font-size: 10pt; }
  @media print { .print-hint { display: none; } }
</style></head>
<body>
<div class="print-hint">이 창의 인쇄(Ctrl+P) → 대상을 "PDF로 저장"으로 선택하세요. 잠시 후 인쇄 창이 자동으로 열립니다.</div>

<div class="cover">
  <div class="brand">INTERLIVE 통역 기록</div>
  <h1>${esc(title)}</h1>
  <div class="meta">
    ${esc(date)} &nbsp;·&nbsp;
    ${esc(languageLabel(d.sourceLang as SourceLangSetting))} → ${esc(languageLabel(d.targetLang as SourceLangSetting))} &nbsp;·&nbsp;
    ${Math.ceil(d.billedSeconds / 60)}분 &nbsp;·&nbsp; 자막 ${d.segments.length}건
  </div>
</div>

${
  s
    ? `<h2>AI 요약</h2><p>${esc(s.overview)}</p>
${s.keyPoints.length ? `<h2>핵심 내용</h2><ul>${s.keyPoints.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
${s.decisions.length ? `<h2>결정 사항</h2><ul>${s.decisions.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
${
  s.actionItems.length
    ? `<h2>액션 아이템</h2><ul>${s.actionItems
        .map((a) => `<li>${esc(a.text)}${a.owner ? `<span class="owner">${esc(a.owner)}</span>` : ''}</li>`)
        .join('')}</ul>`
    : ''
}`
    : '<h2>AI 요약</h2><p style="color:#8A90A8">요약이 아직 준비되지 않았습니다.</p>'
}

<h2>전체 스크립트 (원문 · 번역 대조)</h2>
<table>
  <thead><tr><th>시각</th><th>원문</th><th>번역</th></tr></thead>
  <tbody>
    ${d.segments
      .map(
        (seg) =>
          `<tr><td class="time">${fmtMs(seg.startMs)}</td><td class="src">${esc(seg.sourceText)}</td><td>${esc(seg.targetText)}</td></tr>`,
      )
      .join('')}
  </tbody>
</table>

<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 600); });</script>
</body></html>`;

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
