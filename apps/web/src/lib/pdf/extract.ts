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
