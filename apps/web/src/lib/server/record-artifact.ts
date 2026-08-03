/**
 * 마이페이지 기록으로 저장할 **결과물 파일**을 만든다.
 * 화면에 보여주던 번역 결과를 나중에 다시 받을 수 있게 자족 HTML·텍스트로 굽는다.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const HTML_HEAD = (title: string) =>
  `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>
@page { size: A4; margin: 14mm; }
body { font-family:'Pretendard Variable',Pretendard,system-ui,sans-serif; color:#14172B; font-size:11pt; line-height:1.6; margin:0; padding:18px; }
h2 { font-size:12pt; color:#6D5AE8; margin:20px 0 8px; }
table { border-collapse:collapse; width:100%; }
td,th { border:1px solid #cfd3e0; padding:6px 8px; vertical-align:top; }
td.src { color:#5A6079; width:50%; }
.page table { border-collapse:collapse; width:100%; }
.page td,.page th { border:1px solid #cfd3e0; padding:5px 7px; vertical-align:top; }
</style></head><body>`;

/** 원본형 재구성 결과 → 자족 HTML (페이지별 조각을 이어 붙인다) */
export function layoutArtifact(
  fileName: string,
  pages: Array<{ page: number; html: string }>,
): { body: string; contentType: string; ext: string; downloadName: string } {
  const inner = pages
    .map((p) =>
      p.html.trim()
        ? `<section class="page">${p.html}</section>`
        : `<section class="page"><p style="color:#b4472e">${esc(`${p.page}쪽 재구성 실패`)}</p></section>`,
    )
    .join('\n<hr style="border:none;border-top:1px dashed #cfd3e0;margin:20px 0">\n');
  const base = fileName.replace(/\.[^.]+$/, '');
  return {
    body: `${HTML_HEAD(fileName)}${inner}</body></html>`,
    contentType: 'text/html; charset=utf-8',
    ext: 'html',
    downloadName: `${base} (원본형).html`,
  };
}

/** 파일(PDF·이미지) 번역 결과 → 원문·번역 대조 HTML */
export function fileArtifact(
  fileName: string,
  pages: Array<{ page: number; source: string; translated: string }>,
): { body: string; contentType: string; ext: string; downloadName: string } {
  const rows = pages
    .map(
      (p) =>
        `<h2>${esc(`${p.page}쪽`)}</h2>
<table><thead><tr><th>원문</th><th>번역</th></tr></thead><tbody>
<tr><td class="src">${esc(p.source).replace(/\n/g, '<br>')}</td><td>${esc(p.translated).replace(/\n/g, '<br>')}</td></tr>
</tbody></table>`,
    )
    .join('\n');
  const base = fileName.replace(/\.[^.]+$/, '');
  return {
    body: `${HTML_HEAD(fileName)}${rows}</body></html>`,
    contentType: 'text/html; charset=utf-8',
    ext: 'html',
    downloadName: `${base} (번역).html`,
  };
}

/** 텍스트 번역 결과 → 원문/번역 텍스트 파일 */
export function textArtifact(
  source: string,
  translated: string,
): { body: string; contentType: string; ext: string; downloadName: string } {
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    // BOM을 붙여 윈도우 메모장에서 한글이 깨지지 않게 한다
    body: `﻿[번역]\n${translated}\n\n[원문]\n${source}\n`,
    contentType: 'text/plain; charset=utf-8',
    ext: 'txt',
    downloadName: `번역-${stamp}.txt`,
  };
}
