import { describe, expect, it } from 'vitest';
import { chunkPageText, extractDocxPages, extractPdfPages, extractTxtPages } from '../server/pipeline/documentExtractor.js';

// Hand-built minimal single-page PDF (no external fixture files/deps needed).
// pdfjs-dist can parse this even without a proper xref table.
function buildMinimalPdf(text: string): Buffer {
  const streamContent = `BT /F1 24 Tf 20 100 Td (${text}) Tj ET`;
  const objs: string[] = [];
  objs[1] = `1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n`;
  objs[2] = `2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n`;
  objs[3] = `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 1000 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n`;
  objs[4] = `4 0 obj<</Length ${streamContent.length}>>\nstream\n${streamContent}\nendstream\nendobj\n`;
  objs[5] = `5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = Buffer.byteLength(pdf);
    pdf += objs[i];
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer<</Size 6/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'binary');
}

// A minimal valid .docx (a zip with the required parts) built with jszip,
// which is already a transitive dependency of mammoth.
async function buildMinimalDocx(text: string): Promise<Buffer> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${text}</w:t></w:r></w:p>
  </w:body>
</w:document>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('extractTxtPages', () => {
  it('returns the whole file as a single unpaginated page', () => {
    const pages = extractTxtPages(Buffer.from('Line one\n\nLine two', 'utf-8'));
    expect(pages).toHaveLength(1);
    expect(pages[0].page).toBeUndefined();
    expect(pages[0].scanned).toBe(false);
    expect(pages[0].text).toContain('Line one');
  });
});

describe('extractDocxPages', () => {
  it('extracts raw text from a real .docx file', async () => {
    const buf = await buildMinimalDocx('Hello from docx');
    const pages = await extractDocxPages(buf);
    expect(pages).toHaveLength(1);
    expect(pages[0].text).toContain('Hello from docx');
    expect(pages[0].scanned).toBe(false);
  });
});

describe('extractPdfPages', () => {
  it('extracts text with real page numbers from a real PDF', async () => {
    const buf = buildMinimalPdf('Hello PDF World Content Extraction Test');
    const pages = await extractPdfPages(buf);
    expect(pages).toHaveLength(1);
    expect(pages[0].page).toBe(1);
    expect(pages[0].text).toContain('Hello PDF World');
  });

  it('flags a page with little/no extractable text as scanned', async () => {
    const buf = buildMinimalPdf('Hi'); // 2 chars, well under the threshold
    const pages = await extractPdfPages(buf);
    expect(pages[0].scanned).toBe(true);
  });

  it('does not flag a page with substantial extractable text as scanned', async () => {
    const buf = buildMinimalPdf('This is a long enough sentence to clear the threshold');
    const pages = await extractPdfPages(buf);
    expect(pages[0].scanned).toBe(false);
  });
});

describe('chunkPageText', () => {
  it('splits long text into multiple chunks on paragraph boundaries', () => {
    const chunks = chunkPageText(`${'a'.repeat(500)}\n\n${'b'.repeat(500)}`, 800);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain('aaa');
    expect(chunks[1]).toContain('bbb');
  });

  it('keeps short text as a single chunk', () => {
    expect(chunkPageText('short paragraph')).toEqual(['short paragraph']);
  });

  it('drops empty paragraphs', () => {
    expect(chunkPageText('a\n\n\n\n\nb')).toEqual(['a\n\nb']);
  });
});
