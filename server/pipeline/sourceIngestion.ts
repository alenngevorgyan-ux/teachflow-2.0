import crypto from 'crypto';
import { assertNoPii } from './privacyGuard.js';
import { UserInputError } from './errors.js';
import { Source, SourceChunk } from '../../shared/types.js';
import { repository } from '../store/repository.js';
import { embedChunksInPlace } from '../providers/embeddingProvider.js';
import { ocrPdfPage } from '../providers/ocrProvider.js';
import { chunkPageText, extractDocxPages, extractPdfPages, extractTxtPages } from './documentExtractor.js';

export interface IngestFileParams {
  fileBuffer: Buffer;
  fileName: string;
  title: string;
  authority: string;
  docType: Source['docType'];
  subject: string;
  grades: number[];
  role: Source['role'];
  version: string;
  effectiveFrom: string;
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
        id: p.page !== undefined ? `${sourceId}#p${p.page}#c${chunkIndex}` : `${sourceId}#c${chunkIndex}`,
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
    authority: params.authority,
    docType: params.docType,
    subject: params.subject,
    grades: params.grades,
    role: params.role,
    version: params.version,
    effectiveFrom: params.effectiveFrom,
    status: 'active',
    sha256: crypto.createHash('sha256').update(params.fileBuffer).digest('hex'),
    isDemo: false,
    uploadedAt: new Date().toISOString(),
    ocr: chunks.some((c) => c.ocr),
    chunks,
  };

  // Extracted text is checked like any other write (contacts of the issuing
  // institution are allowed in official sources).
  assertNoPii(chunks.map((c) => c.text).join('\n\n'), 'source.file', { allowContacts: true });
  const saved = repository.saveSource(source);
  return { source: saved, warnings };
}

const DOC_TYPES: Source['docType'][] = ['standard', 'subject_program', 'textbook', 'methodological_guide', 'assessment_template', 'other'];
const ROLES: Source['role'][] = ['FACT', 'METHOD', 'TEMPLATE'];

export interface SourceMetadata {
  title: string;
  authority: string;
  docType: Source['docType'];
  subject: string;
  grades: number[];
  role: Source['role'];
  version: string;
  effectiveFrom: string;
}

/**
 * Source metadata must be entered by the methodologist: nothing is defaulted
 * (no version "1.0", no grade 5, no "today" as effective date).
 */
export function parseSourceMetadata(body: Record<string, unknown>): { metadata?: SourceMetadata; errors: string[] } {
  const errors: string[] = [];
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '');
  const title = str('title');
  const authority = str('authority');
  const subject = str('subject');
  const version = str('version');
  const effectiveFrom = str('effectiveFrom');
  const docType = str('docType') as Source['docType'];
  const role = str('role') as Source['role'];
  const rawGrades = body.grades;
  const gradeList = (Array.isArray(rawGrades) ? rawGrades : typeof rawGrades === 'string' ? rawGrades.split(',') : [])
    .map((g) => String(g).trim())
    .filter((g) => g !== '');
  const grades = gradeList.map(Number);

  if (!title) errors.push('title');
  if (!authority) errors.push('authority');
  if (!subject) errors.push('subject');
  if (!version) errors.push('version');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || Number.isNaN(Date.parse(effectiveFrom))) errors.push('effectiveFrom (YYYY-MM-DD)');
  if (!DOC_TYPES.includes(docType)) errors.push(`docType (${DOC_TYPES.join(' | ')})`);
  if (!ROLES.includes(role)) errors.push(`role (${ROLES.join(' | ')})`);
  if (grades.length === 0 || grades.some((g) => !Number.isInteger(g) || g < 1 || g > 12)) errors.push('grades (1–12)');

  if (errors.length > 0) return { errors };
  return { metadata: { title, authority, docType, subject, grades, role, version, effectiveFrom }, errors };
}

/**
 * A new version of an existing source. Three things are kept apart:
 * - the internal revision id (a new generated source id) and the upload time
 *   (now) — system facts;
 * - the official particulars (version, effective date) — stated by the person,
 *   with the same rules as a new upload; never derived ("<old>-next") and
 *   never defaulted to today. Missing -> the request is refused;
 * - the content: new text is chunked and used (and privacy-checked); without
 *   new text the old chunks, pages and file hash are carried over unchanged.
 * The demo flag is inherited (a demo source cannot become a "real" one by
 * being superseded) and no confirmation is carried over.
 */
export async function buildSupersedingSource(
  old: Source,
  body: { newVersion?: unknown; effectiveFrom?: unknown; text?: unknown }
): Promise<{ source: Source; warnings: string[] }> {
  const errors: string[] = [];
  const version = typeof body.newVersion === 'string' ? body.newVersion.trim() : '';
  const effectiveFrom = typeof body.effectiveFrom === 'string' ? body.effectiveFrom.trim() : '';
  if (!version) errors.push('newVersion');
  else if (version === old.version) errors.push('newVersion (must differ from the current version)');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || Number.isNaN(Date.parse(effectiveFrom))) errors.push('effectiveFrom (YYYY-MM-DD)');
  const text = typeof body.text === 'string' && body.text.trim() !== '' ? body.text : undefined;
  if (body.text !== undefined && body.text !== null && typeof body.text !== 'string') errors.push('text');
  if (errors.length) throw new UserInputError(`Նոր տարբերակի պարտադիր կամ սխալ դաշտեր՝ ${errors.join(', ')}:`);

  const id = `src-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  let chunks: SourceChunk[];
  let sha256: string;
  let ocr: boolean | undefined;
  const warnings: string[] = [];
  if (text) {
    assertNoPii(text, 'source.text', { allowContacts: true });
    // Pasted text has no pages: chunks carry no page number (never invented).
    chunks = chunkPageText(text).map((t, i) => ({ id: `${id}#c${i + 1}`, sourceId: id, text: t }));
    sha256 = crypto.createHash('sha256').update(text).digest('hex');
    ocr = undefined;
    const emb = await embedChunksInPlace(chunks);
    if (emb.warning) warnings.push(emb.warning);
  } else {
    chunks = old.chunks.map((c, i) => ({
      ...c,
      id: c.page !== undefined ? `${id}#p${c.page}#c${i + 1}` : `${id}#c${i + 1}`,
      sourceId: id,
    }));
    sha256 = old.sha256;
    ocr = old.ocr;
  }

  const { confirmation: _dropped, ...rest } = old;
  const source: Source = {
    ...rest,
    id,
    version,
    effectiveFrom,
    effectiveTo: undefined,
    status: 'active',
    sha256,
    isDemo: old.isDemo,
    ocr,
    uploadedAt: new Date().toISOString(),
    chunks,
  };
  return { source, warnings };
}
