import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { openDocx } from '../docx/docxModel.js';
import { chunkPageText, extractDocxPages, extractPdfPages, extractTxtPages } from '../pipeline/documentExtractor.js';
import { PrivacyFinding, PrivacyViolationError, checkPrivacy } from '../pipeline/privacyGuard.js';

function findingKinds(findings: PrivacyFinding[]): string {
  return [...new Set(findings.map((f) => f.kind))].join(', ') || 'unspecified';
}
import { INPUT_ROLES, PilotManifest, readManifest, stableStringify } from './manifest.js';

// Preflight: inspect every input BEFORE TeachFlow runs. Uses the same DOCX
// opener (limits, safe XML, privacy scan) and the same text extractor as the
// application. Does not touch any TeachFlow store and makes no model calls
// (scanned PDF pages are reported as needing OCR, not OCR'd here).

export const MAX_INPUT_BYTES = 25 * 1024 * 1024; // the upload limit of the application
const SOURCE_ROLES = new Set(['PROGRAM_SOURCE', 'FACT_SOURCE', 'METHOD_SOURCE']);
const CONSUMED_ROLES = new Set(['PROGRAM_SOURCE', 'FACT_SOURCE', 'METHOD_SOURCE', 'TEACHER_DOCUMENT']);

export interface ExtractionEvidence {
  mechanism: string; // which extractor, with its version
  chunker: string;
  status: 'ok' | 'needs_ocr' | 'empty' | 'failed';
  pages: number | null;
  scannedPages: number[]; // PDF pages without a text layer (TeachFlow would OCR these)
  textLength: number;
  /** sha256 of the extracted text as returned by the extractor (pages joined with \n\n). */
  textSha256: string | null;
  chunkCount: number;
  /** sha256 of the chunk texts TeachFlow would store (chunking trims whitespace between paragraphs). */
  chunksSha256: string | null;
  truncated: false; // the extractor and chunker never cut text; recorded explicitly
  warnings: string[];
}

export interface InputReport {
  id: string;
  role: string;
  file: string;
  exists: boolean;
  bytes: number | null;
  sha256: string | null;
  extension: string;
  detectedType: 'pdf' | 'docx' | 'txt' | 'unknown';
  consumedByReview: boolean;
  errors: string[];
  warnings: string[];
  extraction?: ExtractionEvidence;
  docx?: { paragraphs: number; editableParagraphs: number; preservation: { kind: string; count: number; textChecked: boolean }[]; uncheckableParts: string[] };
}

export interface PreflightReport {
  schema: 'pilot-preflight/1';
  caseId: string | null;
  preflightAt: string;
  status: 'PREFLIGHT_PASSED' | 'PREFLIGHT_FAILED';
  errors: string[];
  warnings: string[];
  manifestSha256: string | null;
  inputs: InputReport[];
}

export interface PreflightLock {
  schema: 'pilot-preflight-lock/1';
  manifestSha256: string;
  inputs: { id: string; file: string; bytes: number; sha256: string }[];
}

export function sha256(data: Uint8Array | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function moduleVersion(name: string): string {
  try {
    const p = path.resolve(process.cwd(), 'node_modules', name, 'package.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function extractorVersions() {
  return {
    pdf: `pdfjs-dist@${moduleVersion('pdfjs-dist')} (per page; pages with < 20 chars of text are "scanned")`,
    docx: `mammoth@${moduleVersion('mammoth')} extractRawText`,
    txt: 'utf-8 decode',
    chunker: 'chunkPageText(maxLen=800, paragraph boundaries)',
  };
}

function detect(buf: Buffer): InputReport['detectedType'] {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'docx'; // a zip; openDocx proves it is a DOCX
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    if (!text.includes('\u0000')) return 'txt';
  } catch {
    /* not UTF-8 */
  }
  return 'unknown';
}

async function extractionEvidence(buf: Buffer, type: 'pdf' | 'docx' | 'txt'): Promise<ExtractionEvidence> {
  const v = extractorVersions();
  const ev: ExtractionEvidence = {
    mechanism: v[type],
    chunker: v.chunker,
    status: 'ok',
    pages: null,
    scannedPages: [],
    textLength: 0,
    textSha256: null,
    chunkCount: 0,
    chunksSha256: null,
    truncated: false,
    warnings: [],
  };
  try {
    const pages = type === 'pdf' ? await extractPdfPages(buf) : type === 'docx' ? await extractDocxPages(buf) : extractTxtPages(buf);
    ev.pages = type === 'pdf' ? pages.length : null;
    ev.scannedPages = pages.filter((p) => p.scanned).map((p) => p.page ?? 0);
    const usable = pages.filter((p) => !p.scanned);
    const text = usable.map((p) => p.text).join('\n\n');
    ev.textLength = text.length;
    ev.textSha256 = sha256(text);
    const chunks = usable.flatMap((p) => chunkPageText(p.text));
    ev.chunkCount = chunks.length;
    ev.chunksSha256 = chunks.length ? sha256(chunks.join('\n\n')) : null;
    if (ev.scannedPages.length) {
      ev.status = 'needs_ocr';
      ev.warnings.push(
        `${ev.scannedPages.length} page(s) have no text layer (${ev.scannedPages.slice(0, 20).join(', ')}${ev.scannedPages.length > 20 ? ', …' : ''}); TeachFlow would OCR them with Gemini (GEMINI_API_KEY ${process.env.GEMINI_API_KEY?.trim() ? 'is set' : 'is NOT set: those pages would be dropped with a warning'}). The hashes above cover the text layer only.`
      );
    }
    if (chunks.length === 0 && !ev.scannedPages.length) {
      ev.status = 'empty';
      ev.warnings.push('No text could be extracted: TeachFlow would refuse this source.');
    }
    // Contacts of an issuing institution are allowed in official sources, as in the app.
    const priv = checkPrivacy(text, { allowContacts: true });
    // Kinds only: the matched values are personal data and do not belong in a report.
    if (priv.blocked) ev.warnings.push(`Privacy guard would block this text: ${findingKinds(priv.findings)} (values not recorded)`);
  } catch (err) {
    ev.status = 'failed';
    ev.warnings.push(`Extraction failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return ev;
}

export async function preflight(caseDir: string): Promise<{ report: PreflightReport; lock?: PreflightLock }> {
  const report: PreflightReport = {
    schema: 'pilot-preflight/1',
    caseId: null,
    preflightAt: new Date().toISOString(),
    status: 'PREFLIGHT_FAILED',
    errors: [],
    warnings: [],
    manifestSha256: null,
    inputs: [],
  };
  const { manifest, errors } = readManifest(caseDir);
  if (!manifest) {
    report.errors.push(...errors);
    return { report };
  }
  report.caseId = manifest.caseId;
  report.manifestSha256 = sha256(fs.readFileSync(path.join(caseDir, 'manifest.json')));

  const byHash = new Map<string, string>();
  const byBasename = new Map<string, { id: string; sha: string | null }>();
  for (const input of manifest.inputs) {
    const r = await inspectInput(caseDir, manifest, input);
    report.inputs.push(r);
    if (r.sha256) {
      const dup = byHash.get(r.sha256);
      if (dup) r.errors.push(`same bytes as input "${dup}" (duplicate file)`);
      else byHash.set(r.sha256, r.id);
    }
    const base = path.basename(r.file).normalize('NFC').toLowerCase();
    const prev = byBasename.get(base);
    if (prev && prev.sha !== r.sha256) r.errors.push(`file name "${path.basename(r.file)}" is also used by input "${prev.id}" with different bytes`);
    else byBasename.set(base, { id: r.id, sha: r.sha256 });
  }

  const teacherDocs = manifest.inputs.filter((i) => i.role === 'TEACHER_DOCUMENT');
  if (teacherDocs.length !== 1) report.errors.push(`exactly one TEACHER_DOCUMENT is required (found ${teacherDocs.length})`);
  if (!manifest.inputs.some((i) => i.role === 'FACT_SOURCE')) report.warnings.push('no FACT_SOURCE: factual checks will be "not evaluated"');
  if (!manifest.inputs.some((i) => i.role === 'PROGRAM_SOURCE')) report.warnings.push('no PROGRAM_SOURCE: program-scope checks will be "not evaluated"');

  for (const r of report.inputs) report.errors.push(...r.errors.map((e) => `${r.id}: ${e}`));
  for (const r of report.inputs) report.warnings.push(...r.warnings.map((w) => `${r.id}: ${w}`));
  report.status = report.errors.length ? 'PREFLIGHT_FAILED' : 'PREFLIGHT_PASSED';
  if (report.status === 'PREFLIGHT_FAILED') return { report };
  return {
    report,
    lock: {
      schema: 'pilot-preflight-lock/1',
      manifestSha256: report.manifestSha256!,
      inputs: report.inputs.map((r) => ({ id: r.id, file: r.file, bytes: r.bytes!, sha256: r.sha256! })),
    },
  };
}

async function inspectInput(caseDir: string, manifest: PilotManifest, input: PilotManifest['inputs'][number]): Promise<InputReport> {
  const r: InputReport = {
    id: input.id,
    role: input.role,
    file: input.file,
    exists: false,
    bytes: null,
    sha256: null,
    extension: path.extname(input.file).slice(1).toLowerCase(),
    detectedType: 'unknown',
    consumedByReview: CONSUMED_ROLES.has(input.role),
    errors: [],
    warnings: [],
  };
  if (!(INPUT_ROLES as readonly string[]).includes(input.role)) r.errors.push(`unknown role "${input.role}" (allowed: ${INPUT_ROLES.join(', ')})`);
  const full = path.resolve(caseDir, input.file);
  if (!full.startsWith(path.resolve(caseDir) + path.sep)) {
    r.errors.push('file must be inside the case directory');
    return r;
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    r.errors.push('file not found');
    return r;
  }
  r.exists = true;
  let buf: Buffer;
  try {
    buf = fs.readFileSync(full);
  } catch (err) {
    r.errors.push(`file cannot be read: ${err instanceof Error ? err.message : String(err)}`);
    return r;
  }
  r.bytes = buf.length;
  r.sha256 = sha256(buf);
  if (buf.length === 0) {
    r.errors.push('file is empty (0 bytes)');
    return r;
  }
  if (buf.length > MAX_INPUT_BYTES) r.errors.push(`file is larger than the application's upload limit (${buf.length} > ${MAX_INPUT_BYTES} bytes)`);
  r.detectedType = detect(buf);
  const extType = ({ pdf: 'pdf', docx: 'docx', txt: 'txt' } as Record<string, InputReport['detectedType']>)[r.extension];
  if (r.consumedByReview && !extType) r.errors.push(`unsupported file type ".${r.extension}" (supported: .pdf, .docx, .txt; teacher document: .docx)`);
  if (extType && r.detectedType !== extType) r.errors.push(`extension ".${r.extension}" but the content looks like ${r.detectedType}`);

  if (SOURCE_ROLES.has(input.role)) {
    if (!input.source) r.errors.push('source metadata ("source": title, authority, docType, version, effectiveFrom, grades) is required for this role');
    else {
      if (!input.source.grades.includes(manifest.grade)) r.warnings.push(`source grades ${input.source.grades.join(',')} do not include the case grade ${manifest.grade}: it will not be selectable`);
      if (input.role === 'PROGRAM_SOURCE' && input.source.docType !== 'standard' && input.source.docType !== 'subject_program') r.errors.push('a PROGRAM_SOURCE must have docType standard or subject_program');
      if (input.role === 'FACT_SOURCE' && (input.source.docType === 'standard' || input.source.docType === 'subject_program')) r.errors.push('a standard/program is scope, not factual evidence: use role PROGRAM_SOURCE');
    }
    if (input.official === undefined || input.official === null) r.warnings.push('"official" is unknown (recorded as unknown)');
    if (extType && r.detectedType === extType && r.detectedType !== 'unknown') {
      r.extraction = await extractionEvidence(buf, r.detectedType as 'pdf' | 'docx' | 'txt');
      if (r.extraction.status === 'failed' || r.extraction.status === 'empty') r.errors.push(`text extraction ${r.extraction.status}`);
      r.warnings.push(...r.extraction.warnings);
    }
  }

  if (input.role === 'TEACHER_DOCUMENT') {
    if (r.extension !== 'docx') r.errors.push('the teacher document must be a .docx written in Word (PDF/scans are not supported yet)');
    else {
      try {
        const doc = await openDocx(buf);
        r.docx = {
          paragraphs: doc.paragraphs.filter((p) => p.text.trim() !== '').length,
          editableParagraphs: doc.paragraphs.filter((p) => p.text.trim() !== '' && p.editable).length,
          preservation: doc.preservation.map((p) => ({ kind: p.kind, count: p.count, textChecked: p.textChecked })),
          uncheckableParts: doc.privacy.uncheckable.map((u) => u.part),
        };
        if (r.docx.paragraphs === 0) r.errors.push('the document has no text');
        if (r.docx.uncheckableParts.length && input.noStudentDataDeclared !== true) {
          r.errors.push(`contains parts that cannot be privacy-checked (${r.docx.uncheckableParts.join(', ')}); set "noStudentDataDeclared": true only after checking them yourself`);
        }
      } catch (err) {
        // DocxRejectedError, PrivacyViolationError, …: the application would refuse the upload.
        const e = err as Error & { code?: string; where?: string };
        if (err instanceof PrivacyViolationError) {
          r.errors.push(`TeachFlow would reject this DOCX [${e.where}]: personal data found: ${findingKinds(err.findings)} (values not recorded; open the file to see them)`);
        } else {
          r.errors.push(`TeachFlow would reject this DOCX${e.code ? ` (${e.code})` : ''}${e.where ? ` [${e.where}]` : ''}: ${e.message}`);
        }
      }
    }
  }
  return r;
}

export function writeJson(file: string, value: unknown): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = stableStringify(value) + '\n';
  fs.writeFileSync(file, text);
  return sha256(text);
}

/** Runs preflight and writes work/preflight.json; the lock only on success (a failed preflight removes an older lock). */
export async function writePreflight(caseDir: string): Promise<{ report: PreflightReport; lock?: PreflightLock }> {
  const r = await preflight(caseDir);
  writeJson(path.join(caseDir, 'work', 'preflight.json'), r.report);
  const lockPath = path.join(caseDir, 'work', 'preflight-lock.json');
  if (r.lock) writeJson(lockPath, r.lock);
  else if (fs.existsSync(lockPath)) fs.rmSync(lockPath);
  return r;
}
