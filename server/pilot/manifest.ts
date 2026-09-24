import fs from 'fs';
import path from 'path';
import { z } from 'zod';

// Pilot case manifest (pilot-case/1). One real teacher scenario: who ran it,
// which files went in (with the metadata TeachFlow needs for each), and how
// the model is to be run. Everything a later reviewer needs to reproduce the
// run is either here or in the evidence bundle; nothing personal is required.

export const PILOT_MANIFEST_SCHEMA = 'pilot-case/1';

/**
 * Input roles, mapped onto TeachFlow's real concepts:
 * - PROGRAM_SOURCE: standard / subject program -> Source (docType standard|subject_program), selected for scope/outcomes;
 * - FACT_SOURCE: textbook or other factual source -> Source (role FACT), selected as evidence;
 * - METHOD_SOURCE: methodological guidance -> Source (role METHOD); the DOCX review does not use it (recorded as not consumed);
 * - TEACHER_DOCUMENT: the teacher's .docx that is reviewed and corrected (exactly one);
 * - TEMPLATE, TEACHER_REFERENCE, OTHER: preflighted and hashed for the record, not consumed by the review.
 */
export const INPUT_ROLES = ['PROGRAM_SOURCE', 'FACT_SOURCE', 'METHOD_SOURCE', 'TEACHER_DOCUMENT', 'TEMPLATE', 'TEACHER_REFERENCE', 'OTHER'] as const;
export type InputRole = (typeof INPUT_ROLES)[number];

const SourceMeta = z.object({
  title: z.string().trim().min(1),
  authority: z.string().trim().min(1),
  docType: z.enum(['standard', 'subject_program', 'textbook', 'methodological_guide', 'assessment_template', 'other']),
  version: z.string().trim().min(1),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  grades: z.array(z.number().int().min(1).max(12)).min(1),
});

const Input = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  role: z.string(), // validated against INPUT_ROLES by preflight so an unknown role is a clear error, not a parse crash
  /** Path relative to the case directory, normally inputs/<file>. */
  file: z.string().min(1),
  /** Where the file came from (library, publisher, teacher). Free text, optional. */
  origin: z.string().nullable().optional(),
  /** true / false when known, null when not known. Never guessed. */
  official: z.boolean().nullable().optional(),
  /** Required for *_SOURCE roles: the metadata a source upload requires. */
  source: SourceMeta.optional(),
  /**
   * The operator's statement that this exact source version may be used for
   * the pilot. A stated name, not an authenticated identity. Absent -> the
   * run stops at SOURCE_CONFIRMATION_PENDING until someone confirms it in the UI.
   */
  confirmation: z.object({ confirmedByName: z.string().trim().min(1) }).nullable().optional(),
  /** TEACHER_DOCUMENT only: images/embedded objects cannot be privacy-checked; the uploader states there is no student data in them. */
  noStudentDataDeclared: z.boolean().optional(),
});

export const PilotManifestSchema = z.object({
  schemaVersion: z.literal(PILOT_MANIFEST_SCHEMA),
  caseId: z.string().regex(/^[A-Za-z0-9_-]+$/),
  createdAt: z.string().min(1),
  /** Stated name of the person running the pilot. */
  operator: z.string().trim().min(1),
  /** Role only (e.g. "history teacher, grade 7"); no personal data required. */
  teacherRole: z.string().trim().min(1),
  organization: z.string().nullable().optional(),
  subject: z.string().trim().min(1),
  grade: z.number().int().min(1).max(12),
  language: z.string().trim().min(2),
  scenario: z.string().trim().min(1),
  /** true only for synthetic test cases. Real pilots must be false. */
  synthetic: z.boolean(),
  /** 'real': the configured external model; 'fixture': deterministic rules (synthetic cases only). */
  modelMode: z.enum(['real', 'fixture']),
  inputs: z.array(Input).min(1),
  /** Optional strings the exported DOCX is expected to contain (diagnostic only). */
  expectations: z.object({ exportContains: z.array(z.string()).optional() }).optional(),
  /**
   * Synthetic cases only: shortcuts for human steps so a whole run can be
   * exercised automatically. Rejected for real pilots.
   */
  syntheticAutomation: z
    .object({
      outcomes: z.array(z.object({ code: z.string(), text: z.string(), programInputId: z.string() })).optional(),
      autoConfirmStructure: z.boolean().optional(),
      autoAcceptProposals: z.boolean().optional(),
    })
    .optional(),
});

export type PilotManifest = z.infer<typeof PilotManifestSchema>;
export type PilotInput = PilotManifest['inputs'][number];

export function manifestPath(caseDir: string): string {
  return path.join(caseDir, 'manifest.json');
}

export function readManifest(caseDir: string): { manifest?: PilotManifest; errors: string[] } {
  const p = manifestPath(caseDir);
  if (!fs.existsSync(p)) return { errors: [`manifest.json not found in ${caseDir}`] };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    return { errors: [`manifest.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const parsed = PilotManifestSchema.safeParse(raw);
  if (!parsed.success) return { errors: parsed.error.issues.map((i) => `manifest.${i.path.join('.')}: ${i.message}`) };
  const m = parsed.data;
  const errors: string[] = [];
  if (!m.synthetic && m.modelMode === 'fixture') errors.push('modelMode "fixture" is only allowed for synthetic cases; a real pilot must use modelMode "real".');
  if (!m.synthetic && m.syntheticAutomation) errors.push('syntheticAutomation is only allowed for synthetic cases; human steps of a real pilot are done by people.');
  const placeholders = JSON.stringify(raw).match(/<FILL[^>"]*>/g);
  if (placeholders) errors.push(`manifest.json still has ${placeholders.length} unfilled placeholder(s) (<FILL…>)`);
  const ids = new Set<string>();
  for (const i of m.inputs) {
    if (ids.has(i.id)) errors.push(`input id "${i.id}" is used twice`);
    ids.add(i.id);
  }
  return errors.length ? { errors } : { manifest: m, errors: [] };
}

/** Deterministic JSON (sorted keys) so the same content always hashes the same. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])])
    );
  }
  return v;
}
