import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Source } from '../shared/types.js';

const store = vi.hoisted(() => ({
  saved: [] as Source[],
  embeddingWarning: undefined as string | undefined,
  ocrResults: new Map<number, string | Error>(),
  extractedPages: [] as { page?: number; text: string; scanned: boolean }[],
}));

vi.mock('../server/store/repository.js', () => ({
  repository: {
    saveSource: (s: Source) => {
      store.saved.push(s);
      return s;
    },
    logAIInteraction: () => undefined,
  },
}));

vi.mock('../server/providers/embeddingProvider.js', () => ({
  embedChunksInPlace: async (chunks: { embedding?: number[] }[]) => ({
    embedded: chunks.length,
    warning: store.embeddingWarning,
  }),
}));

vi.mock('../server/providers/ocrProvider.js', () => ({
  ocrPdfPage: async (_buf: Buffer, page: number) => {
    const r = store.ocrResults.get(page);
    if (r instanceof Error) throw r;
    if (r === undefined) throw new Error(`no OCR mock configured for page ${page}`);
    return r;
  },
}));

vi.mock('../server/pipeline/documentExtractor.js', async () => {
  const actual = await vi.importActual<typeof import('../server/pipeline/documentExtractor.js')>(
    '../server/pipeline/documentExtractor.js'
  );
  return {
    ...actual,
    extractPdfPages: async () => store.extractedPages,
    extractDocxPages: async () => store.extractedPages,
    extractTxtPages: () => store.extractedPages,
  };
});

import { ingestSourceFile } from '../server/pipeline/sourceIngestion.js';

beforeEach(() => {
  store.saved = [];
  store.embeddingWarning = undefined;
  store.ocrResults = new Map();
  store.extractedPages = [];
});

const baseParams = {
  fileBuffer: Buffer.from('irrelevant bytes for these tests'),
  title: 'Test Source',
  subject: 'history',
  grades: [7],
  authority: 'Test authority',
  docType: 'textbook' as const,
  role: 'FACT' as const,
  version: 'test-v1',
  effectiveFrom: '2026-09-01',
};

describe('ingestSourceFile', () => {
  it('rejects an unsupported file extension', async () => {
    await expect(
      ingestSourceFile({ ...baseParams, fileName: 'notes.rtf', fileBuffer: Buffer.from('x') })
    ).rejects.toThrow(/rtf/);
    expect(store.saved).toHaveLength(0);
  });

  it('computes sha256 over the raw file bytes', async () => {
    store.extractedPages = [{ text: 'Some plain content here', scanned: false }];
    const fileBuffer = Buffer.from('exact bytes to hash');
    const { source } = await ingestSourceFile({ ...baseParams, fileName: 'doc.txt', fileBuffer });

    const crypto = await import('crypto');
    const expected = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    expect(source.sha256).toBe(expected);
  });

  it('assigns real page numbers for a multi-page PDF and chunks each page', async () => {
    store.extractedPages = [
      { page: 1, text: 'Page one content, plenty of text here.', scanned: false },
      { page: 2, text: 'Page two content, also plenty of text.', scanned: false },
    ];
    const { source } = await ingestSourceFile({ ...baseParams, fileName: 'book.pdf' });

    expect(source.chunks.map((c) => c.page)).toEqual([1, 2]);
    expect(source.chunks.every((c) => !c.ocr)).toBe(true);
  });

  it('routes a scanned PDF page through OCR and marks the resulting chunk ocr:true', async () => {
    store.extractedPages = [{ page: 3, text: '', scanned: true }];
    store.ocrResults.set(3, 'OCR-recovered text from the scanned page');

    const { source, warnings } = await ingestSourceFile({ ...baseParams, fileName: 'scanned.pdf' });

    expect(source.chunks).toHaveLength(1);
    expect(source.chunks[0].text).toContain('OCR-recovered text');
    expect(source.chunks[0].ocr).toBe(true);
    expect(source.ocr).toBe(true); // source-level flag aggregates per-chunk ocr
    expect(warnings).toHaveLength(0);
  });

  it('a failed OCR call produces a visible warning and drops that page, not fabricated text', async () => {
    store.extractedPages = [
      { page: 1, text: '', scanned: true },
      { page: 2, text: 'A normal text-layer page with enough content.', scanned: false },
    ];
    store.ocrResults.set(1, new Error('Gemini quota exceeded'));

    const { source, warnings } = await ingestSourceFile({ ...baseParams, fileName: 'mixed.pdf' });

    expect(source.chunks).toHaveLength(1);
    expect(source.chunks[0].page).toBe(2);
    expect(warnings.some((w) => w.includes('Gemini quota exceeded'))).toBe(true);
  });

  it('throws (and saves nothing) when every page ends up with no text at all', async () => {
    store.extractedPages = [{ page: 1, text: '', scanned: true }];
    store.ocrResults.set(1, new Error('no key'));

    await expect(ingestSourceFile({ ...baseParams, fileName: 'blank.pdf' })).rejects.toThrow(
      /չհաջողվեց/
    );
    expect(store.saved).toHaveLength(0);
  });

  it('propagates the embedding warning into the result', async () => {
    store.extractedPages = [{ text: 'Plain content with enough length here.', scanned: false }];
    store.embeddingWarning = 'embeddings failed for test';

    const { warnings } = await ingestSourceFile({ ...baseParams, fileName: 'doc.txt' });
    expect(warnings).toContain('embeddings failed for test');
  });
});
