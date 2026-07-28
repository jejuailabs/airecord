'use client';

/**
 * 브라우저에서 PDF 텍스트를 추출한다.
 *
 * 서버로 파일을 올리지 않고 클라이언트에서 뽑는 이유:
 * 원본 파일이 서버에 남지 않고(보관 최소화 — docs/08 §3), 업로드 용량·시간도 아낀다.
 * 텍스트 레이어가 없는 스캔본은 빈 문자열이 나오므로 호출부가 이미지 경로로 안내한다.
 */
export interface PdfPage {
  page: number;
  text: string;
}

export async function extractPdfPages(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<PdfPage[]> {
  const pdfjs = await import('pdfjs-dist');
  // 워커는 public/에 복사해 둔 파일을 쓴다 (CDN 의존 없음, 번들러 설정 불필요).
  // 복사: pnpm run pdf:worker — pdfjs-dist 버전을 올리면 다시 실행할 것.
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const pages: PdfPage[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // 줄바꿈 정보를 살려 문단 구분을 유지한다
    let text = '';
    let lastY: number | null = null;
    for (const item of content.items) {
      const it = item as { str?: string; transform?: number[]; hasEOL?: boolean };
      if (typeof it.str !== 'string') continue;
      const y = it.transform?.[5] ?? null;
      if (lastY !== null && y !== null && Math.abs(lastY - y) > 2) {
        text += Math.abs(lastY - y) > 14 ? '\n\n' : '\n';
      }
      text += it.str;
      if (it.hasEOL) text += '\n';
      lastY = y;
    }
    pages.push({ page: i, text: text.replace(/[ \t]+/g, ' ').trim() });
    onProgress?.(i, doc.numPages);
  }
  await doc.destroy();
  return pages;
}

/** 이미지 파일을 data URL로 (비전 모델 입력용) */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('file read failed'));
    reader.readAsDataURL(file);
  });
}

/**
 * 글자 정보가 없는 PDF(스캔본)를 페이지 이미지로 그린다.
 *
 * 왜 필요한가: 스캔 PDF는 글자가 없어 추출이 0자다. 그렇다고 내장 이미지를 꺼내 쓸 수도 없다 —
 * 실측(2026-07-28)한 문서는 페이지마다 배경 이미지 1장 + 글자 조각 이미지 20여 개로 흩어져 있어
 * 낱개로는 아무 의미가 없었다(CCITTFax·Flate 혼재). 조각을 제자리에 합성해야 사람이 읽는 문서가 된다.
 * 그 합성을 pdfjs가 해주므로, 페이지를 통째로 캔버스에 그려 한 장으로 만든다.
 *
 * ⚠ 브라우저에서 그린다 — 원본 파일은 여전히 서버로 올라가지 않는다.
 */
export interface PdfPageImage {
  page: number;
  dataUrl: string;
}

/** 150DPI 상당. 더 키우면 OCR이 크게 좋아지지 않으면서 전송량만 커진다 */
const RENDER_SCALE = 2;
/** 한 장이 이보다 크면 품질을 낮춰 다시 굽는다 (요청 본문 상한이 있다) */
const MAX_PAGE_BYTES = 1_400_000;

export async function renderPdfPagesToImages(
  file: File,
  onProgress?: (done: number, total: number) => void,
  maxPages = 20,
): Promise<PdfPageImage[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const total = Math.min(doc.numPages, maxPages);
  const out: PdfPageImage[] = [];

  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) break;
    // 스캔본은 배경이 투명일 수 있다 — 흰 바탕을 깔지 않으면 글자가 검은 배경에 묻힌다
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    let dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    if (dataUrl.length > MAX_PAGE_BYTES) dataUrl = canvas.toDataURL('image/jpeg', 0.6);
    out.push({ page: i, dataUrl });
    onProgress?.(i, total);
  }

  await doc.destroy();
  return out;
}
