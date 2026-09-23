import crypto from 'crypto';
import { Source, SourceChunk } from '../../shared/types.js';
import { repository } from '../store/repository.js';
import { embedChunksInPlace } from '../providers/embeddingProvider.js';
import { ocrPdfPage } from '../providers/ocrProvider.js';
import { chunkPageText, extractDocxPages, extractPdfPages, extractTxtPages } from './documentExtractor.js';

export interface IngestFileParams {
  fileBuffer: Buffer;
  fileName: string;
  title: string;
  authority?: string;
  docType?: Source['docType'];
  subject: string;
  grades: number[];
  role?: Source['role'];
  version?: string;
  effectiveFrom?: string;
}

export interface IngestResult {
  source: Source;
  warnings: string[];
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

export async function ingestSourceFile(params: IngestFileParams): Promise<IngestResult> {
  const ext = extensionOf(params.fileName);
  const sourceId = `src-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const warnings: string[] = [];

  let pages: { page?: number; text: string; scanned: boolean }[];
  if (ext === 'pdf') {
    pages = await extractPdfPages(params.fileBuffer);
  } else if (ext === 'docx') {
    pages = await extractDocxPages(params.fileBuffer);
  } else if (ext === 'txt') {
    pages = extractTxtPages(params.fileBuffer);
  } else {
    throw new Error(
      `Չաջակցվող ֆայլի ձևաչափ («.${ext || '?'}»): աջակցվում են միայն .pdf, .docx և .txt ֆայլերը:`
    );
  }

  // Scanned PDF pages get routed to Gemini OCR. Never fabricated: an OCR
  // failure just drops that page's text (with a visible warning naming the
  // page) instead of inventing content or silently creating an empty chunk.
  for (const p of pages) {
    if (!p.scanned) continue;
    try {
      p.text = await ocrPdfPage(params.fileBuffer, p.page ?? 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Էջ ${p.page ?? '?'}. OCR-ը ձախողվեց և տեքստ չի ավելացվել. ${msg}`);
      p.text = '';
    }
  }

  const chunks: SourceChunk[] = [];
  let chunkIndex = 1;
  for (const p of pages) {
    if (!p.text.trim()) continue; // nothing to chunk — already warned above if this was a scanned page
    for (const chunkText of chunkPageText(p.text)) {
      chunks.push({
        id: `${sourceId}#p${p.page ?? 1}#c${chunkIndex}`,
        sourceId,
        page: p.page,
        text: chunkText,
        ocr: p.scanned || undefined,
      });
      chunkIndex++;
    }
  }

  if (chunks.length === 0) {
    throw new Error(
      'Ֆայլից որևէ տեքստ չհաջողվեց քաղել (դատարկ փաստաթուղթ կամ ամբողջությամբ ձախողված OCR): Աղբյուրը չի ստեղծվել:'
    );
  }

  const embeddingResult = await embedChunksInPlace(chunks);
  if (embeddingResult.warning) warnings.push(embeddingResult.warning);

  const source: Source = {
    id: sourceId,
    title: params.title,
    authority: params.authority || 'Գրանցված մեթոդիստի կողմից',
    docType: params.docType || 'textbook',
    subject: params.subject,
    grades: params.grades,
    role: params.role || 'FACT',
    version: params.version || '1.0',
    effectiveFrom: params.effectiveFrom || new Date().toISOString().substring(0, 10),
    status: 'active',
    sha256: crypto.createHash('sha256').update(params.fileBuffer).digest('hex'),
    isDemo: false,
    uploadedAt: new Date().toISOString(),
    ocr: chunks.some((c) => c.ocr),
    chunks,
  };

  const saved = repository.saveSource(source);
  return { source: saved, warnings };
}
