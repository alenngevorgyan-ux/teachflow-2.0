import fs from 'fs';
import path from 'path';
import type { MaterialReview } from '../../shared/types.js';
import { dependencyFingerprint } from '../materials/checks.js';
import { buildChangeList, exportReviewDocx } from '../materials/exportReview.js';
import { getReview, reviewStatus } from '../materials/reviewService.js';
import { resolveStructure } from '../materials/spans.js';
import { sourceConfirmationState, sourceContentHash } from '../pipeline/sourceConfirmation.js';
import { repository } from '../store/repository.js';
import { docxDiagnostics } from './docxDiagnostics.js';
import { readManifest, stableStringify } from './manifest.js';
import { PreflightReport, sha256, writeJson } from './preflight.js';
import { findSecrets, fullProvenance } from './provenance.js';
import { assertCaseStore, readRunState } from './run.js';
import { PilotState, isFailure } from './states.js';

// Packages one pilot case into a new, never-overwritten evidence bundle:
// what went in, what TeachFlow used, which version/configuration ran, what
// happened, what came out, what was checked, and what is still human work.
// By default no raw source text or question text is copied into the JSON
// evidence (hashes instead); the exported DOCX and the change report are the
// deliverables themselves and stay in the private case directory.

export interface EvidenceResult {
  bundleDir: string;
  overallState: PilotState;
  modelExecution: 'real_external' | 'fixture_deterministic' | 'none';
  problems: string[];
}

const TEMPLATE_DIR = path.resolve(process.cwd(), 'pilot/case-template');
const HUMAN_TEMPLATES = ['human-review-template.md', 'word-qa-checklist.md', 'armenian-review-checklist.md', 'teacher-feedback-template.md'];

function observedModels(review: MaterialReview): { providerId: string; modelId: string; promptVersion: string; where: string }[] {
  const out: { providerId: string; modelId: string; promptVersion: string; where: string }[] = [];
  if (review.segmentation) out.push({ ...review.segmentation.model, where: 'segmentation' });
  for (const r of review.results) for (const c of r.checks) if (c.model) out.push({ providerId: c.model.providerId, modelId: c.model.modelId, promptVersion: c.model.promptVersion, where: `check:${r.itemId}:${c.checkId}` });
  for (const s of review.suggestions) out.push({ providerId: s.model.providerId, modelId: s.model.modelId, promptVersion: s.model.promptVersion, where: `suggestion:${s.id}` });
  return out.map(({ providerId, modelId, promptVersion, where }) => ({ providerId, modelId, promptVersion, where }));
}

export async function collectEvidence(caseDir: string, opts: { includeExcerpts?: boolean; now?: Date } = {}): Promise<EvidenceResult> {
  assertCaseStore(caseDir);
  const { manifest, errors } = readManifest(caseDir);
  if (!manifest) throw new Error(errors.join('; '));
  const stamp = (opts.now ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const bundleDir = path.join(caseDir, 'evidence', `bundle-${stamp}`);
  if (fs.existsSync(bundleDir)) throw new Error(`evidence bundle ${bundleDir} already exists; bundles are never overwritten`);
  fs.mkdirSync(bundleDir, { recursive: true });
  const problems: string[] = [];
  const runState = readRunState(caseDir);
  const preflightPath = path.join(caseDir, 'work', 'preflight.json');
  const preflight = fs.existsSync(preflightPath) ? (JSON.parse(fs.readFileSync(preflightPath, 'utf8')) as PreflightReport) : null;
  const lockPath = path.join(caseDir, 'work', 'preflight-lock.json');

  // manifest snapshot
  writeJson(path.join(bundleDir, 'manifest.final.json'), {
    manifest,
    manifestSha256: sha256(fs.readFileSync(path.join(caseDir, 'manifest.json'))),
    preflightLock: fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : null,
    bundleCreatedAt: new Date().toISOString(),
  });
  if (preflight) writeJson(path.join(bundleDir, 'preflight.json'), preflight);
  else problems.push('no preflight report');

  // sources: original file vs the text TeachFlow actually stored
  const sources = manifest.inputs
    .filter((i) => ['PROGRAM_SOURCE', 'FACT_SOURCE', 'METHOD_SOURCE'].includes(i.role))
    .map((i) => {
      const sid = runState?.sourceIds[i.id];
      const s = sid ? repository.getSource(sid) : undefined;
      const pre = preflight?.inputs.find((x) => x.id === i.id);
      return {
        inputId: i.id,
        role: i.role,
        official: i.official ?? null,
        origin: i.origin ?? null,
        originalFile: { name: path.basename(i.file), bytes: pre?.bytes ?? null, sha256: pre?.sha256 ?? null },
        preflightExtraction: pre?.extraction ?? null,
        storedInTeachFlow: s
          ? {
              sourceId: s.id,
              version: s.version,
              effectiveFrom: s.effectiveFrom,
              fileSha256: s.sha256,
              contentHash: sourceContentHash(s),
              chunks: s.chunks.length,
              storedChunksSha256: sha256(s.chunks.map((c) => c.text).join('\n\n')),
              storedTextLength: s.chunks.reduce((n, c) => n + c.text.length, 0),
              ocrUsed: !!s.ocr,
              embeddings: s.chunks.filter((c) => c.embedding).length,
              confirmation: { state: sourceConfirmationState(s).state, statedName: s.confirmation?.confirmedByName ?? null, note: 'stated name, not an authenticated identity' },
            }
          : null,
        consumedByReview: i.role !== 'METHOD_SOURCE',
      };
    });
  writeJson(path.join(bundleDir, 'source-diagnostics.json'), { schema: 'pilot-source-diagnostics/1', sources });

  // review
  let review: MaterialReview | null = null;
  try {
    review = runState?.reviewId ? getReview(runState.reviewId) : null;
  } catch (err) {
    problems.push(`review could not be loaded: ${err instanceof Error ? err.message : String(err)}`);
  }
  const models = review ? observedModels(review) : [];
  const providers = [...new Set(models.map((m) => m.providerId).filter((p) => p !== 'teacher'))];
  const modelExecution: EvidenceResult['modelExecution'] = providers.length === 0 ? 'none' : providers.every((p) => p === 'fixture') ? 'fixture_deterministic' : 'real_external';
  let mismatch: string | null = null;
  if (manifest.modelMode === 'real' && providers.includes('fixture')) mismatch = 'the case is declared real but results come from the FIXTURE provider';
  if (manifest.modelMode === 'fixture' && providers.some((p) => p !== 'fixture')) mismatch = 'the case is declared fixture but results come from a real provider';
  if (mismatch) problems.push(mismatch);

  // Every audited AI call in the case store (embeddings included): provider,
  // model, action and count only; prompts and outputs are not copied.
  const audit = repository.getAuditLogs();
  const callCounts = new Map<string, { providerId: string; modelId: string; action: string; count: number }>();
  for (const a of audit) {
    const k = `${a.providerId}|${a.modelId}|${a.action}`;
    const e = callCounts.get(k) ?? { providerId: a.providerId, modelId: a.modelId, action: a.action, count: 0 };
    e.count++;
    callCounts.set(k, e);
  }
  const auditedCalls = [...callCounts.values()].sort((x, y) => `${x.providerId}${x.action}`.localeCompare(`${y.providerId}${y.action}`));
  const externalInFixture = manifest.modelMode === 'fixture' ? auditedCalls.filter((c) => c.providerId !== 'fixture') : [];
  if (externalInFixture.length) problems.push(`the fixture case made external AI call attempt(s): ${externalInFixture.map((c) => `${c.providerId}/${c.modelId} ${c.action} ×${c.count}`).join(', ')}`);

  const status = review ? reviewStatus(review) : null;
  const programIds = new Set(review?.selectedSources.filter((s) => s.purpose === 'program').map((s) => s.sourceId) ?? []);
  const outcomes = repository.getOutcomes().filter((o) => programIds.has(o.sourceId) && o.confirmed && o.grade === manifest.grade && o.subject === manifest.subject);
  writeJson(path.join(bundleDir, 'run.json'), {
    schema: 'pilot-run/1',
    provenance: fullProvenance(),
    declaredModelMode: manifest.modelMode,
    modelExecution,
    modelExecutionNote:
      modelExecution === 'real_external'
        ? 'results come from the external provider(s) listed below'
        : modelExecution === 'fixture_deterministic'
        ? 'FIXTURE: deterministic rules, not a model. Not evidence of real model behaviour.'
        : 'no model-produced result in this review',
    observedModels: [...new Map(models.map((m) => [`${m.providerId}|${m.modelId}|${m.promptVersion}`, { providerId: m.providerId, modelId: m.modelId, promptVersion: m.promptVersion }])).values()],
    auditedCalls,
    auditedCallsNote: `${audit.length >= 200 ? 'the store keeps only the latest 200 audit entries: counts may be incomplete' : 'every entry of the case store audit log'}; FIXTURE provider calls are not audit-logged (they are not model calls)`,
    runState,
    review: review
      ? {
          id: review.id,
          revision: review.revision,
          originalSha256: review.fileSha256,
          acceptedGroups: review.acceptedGroups.length,
          selectedSources: review.selectedSources,
          currentDependencyFingerprint: dependencyFingerprint(review),
          runs: review.runs,
          status,
        }
      : null,
    dependencies: {
      activeRules: repository.getActiveRules().map((r) => ({ id: r.id, kind: r.kind, params: r.params })),
      confirmedProgramOutcomes: { count: outcomes.length, sha256: sha256(stableStringify(outcomes.map((o) => [o.sourceId, o.code, o.text]))) },
    },
  });

  // check results (hashes, not raw text, unless asked)
  if (review) {
    const structure = resolveStructure(review);
    const t = (s: string) => (opts.includeExcerpts ? s : undefined);
    writeJson(path.join(bundleDir, 'check-results.json'), {
      schema: 'pilot-check-results/1',
      includesExcerpts: !!opts.includeExcerpts,
      items: structure.items.map((it) => {
        const r = review!.results.find((x) => x.itemId === it.id);
        const key = structure.answerKey.find((k) => k.itemId === it.id);
        return {
          itemId: it.id,
          number: it.number,
          type: it.type,
          options: it.options.length,
          key: key ? { labels: key.optionLabels, origin: key.origin } : null,
          result: r
            ? {
                stale: r.stale,
                revision: r.revision,
                inputHash: r.inputHash ?? null,
                dependencyFingerprint: r.dependencyFingerprint ?? null,
                checkedAt: r.checkedAt ?? null,
                checks: r.checks.map((c) => ({
                  checkId: c.checkId,
                  kind: c.kind,
                  status: c.status,
                  executionError: !!c.executionError,
                  detail: c.detail,
                  confidence: c.confidence ?? null,
                  outcomeCodes: c.outcomeCodes ?? [],
                  model: c.model ?? null,
                  evidence: (c.evidence ?? []).map((e) => ({ sourceId: e.sourceId, sourceVersion: e.sourceVersion, chunkId: e.chunkId, page: e.page ?? null, textSha256: sha256(e.text), text: t(e.text) })),
                })),
              }
            : null,
        };
      }),
      suggestions: review.suggestions.map((s) => ({
        id: s.id,
        itemId: s.itemId,
        status: s.status,
        editedByTeacher: !!s.editedByTeacher,
        recheck: s.recheck ?? null,
        keyChange: s.keyChange ?? null,
        model: s.model,
        patches: s.group.patches.map((p) => ({ paragraphId: p.paragraphId, start: p.start, end: p.end, expectedSha256: sha256(p.expected), replacementSha256: sha256(p.replacement), expected: t(p.expected), replacement: t(p.replacement) })),
      })),
    });
  }

  // export
  let exportOk = false;
  if (review) {
    try {
      const a = await exportReviewDocx(review);
      const b = await exportReviewDocx(review);
      fs.writeFileSync(path.join(bundleDir, 'export.docx'), a);
      const exportSha = sha256(a);
      fs.writeFileSync(path.join(bundleDir, 'export.sha256'), `${exportSha}  export.docx\n`);
      const teacher = manifest.inputs.find((i) => i.role === 'TEACHER_DOCUMENT')!;
      const originalOk = repository.getMaterialFile(review.fileSha256) !== undefined && sha256(fs.readFileSync(path.resolve(caseDir, teacher.file))) === review.fileSha256;
      const diag = await docxDiagnostics(a, manifest.expectations?.exportContains ?? []);
      writeJson(path.join(bundleDir, 'docx-diagnostics.json'), {
        ...diag,
        revision: review.revision,
        acceptedGroups: review.acceptedGroups.length,
        exportDeterministic: exportSha === sha256(b),
        noAcceptedFixesEqualsOriginal: review.acceptedGroups.length === 0 ? exportSha === review.fileSha256 : null,
        originalStoredAndMatchesInput: originalOk,
      });
      fs.writeFileSync(path.join(bundleDir, 'change-report.txt'), await buildChangeList(review));
      exportOk = diag.zipOk && diag.openedByTeachFlow && !diag.suspiciousEmpty && diag.missingRelationshipTargets.length === 0 && diag.expected.every((e) => e.present) && originalOk;
      if (!exportOk) problems.push(`export diagnostics: ${diag.error ?? ''} ${diag.suspiciousEmpty ? 'suspiciously empty;' : ''} ${diag.missingRelationshipTargets.length ? 'missing relationship targets;' : ''} ${diag.expected.filter((e) => !e.present).length ? 'expected text missing;' : ''} ${originalOk ? '' : 'original not stored / does not match input;'}`.trim());
    } catch (err) {
      problems.push(`export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // human review templates (blank: nothing is pre-filled or assumed)
  for (const f of HUMAN_TEMPLATES) {
    const src = path.join(TEMPLATE_DIR, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(bundleDir, f));
    else problems.push(`human review template missing: pilot/case-template/${f}`);
  }

  // overall state
  let overall: PilotState;
  if (runState?.finalState && isFailure(runState.finalState)) overall = runState.finalState;
  else if (mismatch || externalInFixture.length) overall = 'MODEL_MODE_MISMATCH';
  else if (review && !exportOk) overall = 'EXPORT_FAILED';
  else overall = runState?.finalState ?? 'PREFLIGHT_FAILED';

  const summary = [
    `# Pilot evidence — ${manifest.caseId}`,
    '',
    manifest.synthetic ? '> **SYNTHETIC CASE** — test data, not a real teacher scenario. Nothing here is pilot evidence.\n' : null,
    `**State: ${overall}**${runState?.instruction ? ` — ${runState.instruction}` : ''}`,
    '',
    `- Model execution: **${modelExecution}** (declared ${manifest.modelMode})${modelExecution === 'fixture_deterministic' ? ' — FIXTURE rules, not a model' : ''}`,
    `- AI calls in the case store audit log: ${auditedCalls.length ? auditedCalls.map((c) => `${c.providerId}/${c.modelId} ${c.action} ×${c.count}`).join('; ') : 'none'}`,
    `- TeachFlow commit: ${fullProvenance().git.commit} (${fullProvenance().git.branch}; tracked files modified: ${fullProvenance().git.dirtyTrackedFiles ?? 'unknown'})`,
    review ? `- Review ${review.id}, revision ${review.revision}; original sha256 ${review.fileSha256}` : '- No review yet',
    status && `- Checks: pass ${status.counts.pass}, fail ${status.counts.fail}, needs_review ${status.counts.needs_review}, not_evaluated ${status.counts.not_evaluated}; stale items ${status.counts.staleItems}; pending proposals ${status.counts.pendingSuggestions}`,
    status && `- Review status: ${status.final ? 'all checks passed at this revision' : `DRAFT — ${status.reasons.join(' ')}`}`,
    problems.length ? `- Problems: ${problems.join(' | ')}` : '- Problems: none detected automatically',
    '',
    '## Stages',
    '',
    ...(runState?.stages ?? []).map((s) => `- ${s.stage}: ${s.state} — ${s.detail}`),
    '',
    '## Human verification (not automated)',
    '',
    '| Item | Status |',
    '|---|---|',
    '| Microsoft Word visual QA (word-qa-checklist.md) | UNVERIFIED — REQUIRES REAL PILOT |',
    '| Armenian language review (armenian-review-checklist.md) | UNVERIFIED — REQUIRES REAL PILOT |',
    '| Factual correctness against the sources | UNVERIFIED — REQUIRES REAL PILOT |',
    '| Teacher usefulness (teacher-feedback-template.md) | UNVERIFIED — REQUIRES REAL PILOT |',
    '',
    'Automated checks above are technical facts. A passing check is not proof that the material is correct or useful.',
    '',
    '## Method rules in effect',
    '',
    'Application defaults seeded into the case store, not confirmed by a methodologist for this pilot:',
    '',
    ...repository.getActiveRules().map((r) => `- \`${r.id}\` (${r.kind})${r.params ? ` ${JSON.stringify(r.params)}` : ''}`),
    '',
  ]
    .filter((l): l is string => typeof l === 'string')
    .join('\n');
  fs.writeFileSync(path.join(bundleDir, 'summary.md'), summary + '\n');

  // secret scan over everything written; a leaking file is removed and the bundle marked failed
  const leaks: string[] = [];
  for (const f of fs.readdirSync(bundleDir)) {
    const full = path.join(bundleDir, f);
    const names = findSecrets(fs.readFileSync(full).toString('latin1') + fs.readFileSync(full, 'utf8'));
    if (names.length) {
      leaks.push(`${f}: ${names.join(', ')}`);
      fs.rmSync(full);
    }
  }
  if (leaks.length) {
    overall = 'EVIDENCE_FAILED';
    fs.writeFileSync(path.join(bundleDir, 'summary.md'), `# Pilot evidence — ${manifest.caseId}\n\n**State: EVIDENCE_FAILED** — secret values were found and the files were removed: ${leaks.join('; ')}\n`);
  }

  // checksums of the bundle
  const sums = fs
    .readdirSync(bundleDir)
    .filter((f) => f !== 'SHA256SUMS')
    .sort()
    .map((f) => `${sha256(fs.readFileSync(path.join(bundleDir, f)))}  ${f}`);
  fs.writeFileSync(path.join(bundleDir, 'SHA256SUMS'), sums.join('\n') + '\n');
  return { bundleDir, overallState: overall, modelExecution, problems: leaks.length ? [...problems, ...leaks] : problems };
}
