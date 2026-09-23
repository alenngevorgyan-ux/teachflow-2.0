import path from 'path';

export interface ExtractedPage {
  page?: number; // 1-indexed real page number; undefined when the format has no fixed pagination (DOCX/TXT)
  text: string;
  scanned: boolean; // true if this page had no (or near-no) extractable text layer
}

// A page whose extractable text layer is shorter than this is treated as
// scanned/image-only and routed to OCR instead of being silently chunked as
// empty content.
const SCANNED_PAGE_TEXT_THRESHOLD = 20;

export function extractTxtPages(buffer: Buffer): ExtractedPage[] {
  const text = buffer.toString('utf-8');
  return [{ text, scanned: false }];
}

export async function extractDocxPages(buffer: Buffer): Promise<ExtractedPage[]> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return [{ text: result.value, scanned: false }];
}

export async function extractPdfPages(buffer: Buffer): Promise<ExtractedPage[]> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const standardFontDataUrl = `${path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts')}${path.sep}`;

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    standardFontDataUrl,
  });
  const doc = await loadingTask.promise;

  const pages: ExtractedPage[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ').trim();
    pages.push({
      page: pageNum,
      text,
      scanned: text.length < SCANNED_PAGE_TEXT_THRESHOLD,
    });
  }

  await loadingTask.destroy();
  return pages;
}

// Splits a page's text into ~maxLen character chunks on paragraph boundaries —
// the same policy the manual paste-text upload has always used.
export function chunkPageText(text: string, maxLen = 800): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = '';

  for (const p of paragraphs) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    if (current.length + trimmed.length > maxLen) {
      if (current) {
        chunks.push(current.trim());
        current = '';
      }
    }
    current += (current ? '\n\n' : '') + trimmed;
  }
  if (current) chunks.push(current.trim());

  return chunks;
}
