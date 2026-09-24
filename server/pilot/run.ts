import fs from 'fs';
import path from 'path';
import type { MaterialReview, Source } from '../../shared/types.js';
import { reviewStatus, runChecks, segment, selectSources, suggest, createReview, confirmSegmentation, decide, getReview } from '../materials/reviewService.js';
import { ingestSourceFile } from '../pipeline/sourceIngestion.js';
import { confirmSource, sourceConfirmationState, sourceContentHash } from '../pipeline/sourceConfirmation.js';
import { PrivacyViolationError } from '../pipeline/privacyGuard.js';
import { getJudgeProvider } from '../providers/judgeProvider.js';
import { getDefaultProviderId, getProvider, isProviderConfigured } from '../providers/modelProvider.js';
import { repository } from '../store/repository.js';
import { PilotManifest, readManifest } from './manifest.js';
import { PreflightLock, PreflightReport, sha256, writeJson } from './preflight.js';
import { HUMAN_STEP_INSTRUCTIONS, PilotState } from './states.js';

// Runs one pilot case through the REAL application code (source ingestion,
// source confirmation, material review: split, checks, fix proposals) in the
// case's own store. Stops with an explicit state wherever a person has to act;
// run it again after that step. Must be imported only after the environment
// points TEACHFLOW_DATA_DIR at <case>/work/store (see scripts/pilot.ts).

export interface RunStage {
  stage: string;
  state: 'ok' | 'skipped' | PilotState;
  at: string;
  detail: string;
}

export interface RunState {
  schema: 'pilot-run-state/1';
  caseId: string;
  modelMode: 'real' | 'fixture';
  sourceIds: Record<string, string>;
  reviewId: string | null;
  finalState: PilotState | null;
  instruction: string | null;
  stages: RunStage[];
}

export function caseStoreDir(caseDir: string): string {
  return path.resolve(caseDir, 'work', 'store');
}

function statePath(caseDir: string) {
  return path.join(caseDir, 'work', 'run-state.json');
}

export function readRunState(caseDir: string): RunState | null {
  const p = statePath(caseDir);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) as RunState) : null;
}

/** Refuses to run against any store other than this case's own. */
export function assertCaseStore(caseDir: string): void {
  const env = process.env.TEACHFLOW_DATA_DIR ? path.resolve(process.env.TEACHFLOW_DATA_DIR) : null;
  if (env !== caseStoreDir(caseDir)) {
    throw new Error(`Pilot run refused: TEACHFLOW_DATA_DIR must be ${caseStoreDir(caseDir)} (is ${env ?? 'unset'}). Use scripts/pilot.ts, which sets it; never run a pilot against the normal data/ store.`);
  }
  if (process.env.TEACHFLOW_STORE_SEED !== 'rules-only') throw new Error('Pilot run refused: TEACHFLOW_STORE_SEED=rules-only is required (a pilot store holds no demo content). Use scripts/pilot.ts.');
  const demo = repository.getSources().filter((s) => s.isDemo).length + repository.getOutcomes().filter((o) => o.sourceId.startsWith('demo-')).length;
  if (demo) throw new Error(`Pilot run refused: the case store contains ${demo} demo source(s)/outcome(s). Delete ${caseStoreDir(caseDir)} and run again.`);
}

/** Real or fixture model availability, without calling any model. */
export function modelAvailability(mode: 'real' | 'fixture'): { ok: boolean; detail: string } {
  const provider = getDefaultProviderId();
  if (mode === 'fixture') {
    return provider === 'fixture' && process.env.TEACHFLOW_FIXTURE_MODE === '1'
      ? { ok: true, detail: 'FIXTURE deterministic provider and judge (not a model)' }
      : { ok: false, detail: 'fixture mode requires MODEL_PROVIDER=fixture and TEACHFLOW_FIXTURE_MODE=1' };
  }
  if (provider === 'fixture') return { ok: false, detail: 'MODEL_PROVIDER=fixture in a real-model run' };
  if (!isProviderConfigured(provider)) return { ok: false, detail: `provider "${provider}" is not configured (credentials or model id missing)` };
  return { ok: true, detail: `external provider "${provider}"` };
}

/** Error text for the run record; personal data found by the privacy guard is reported by kind only. */
function errText(err: unknown): string {
  if (err instanceof PrivacyViolationError) return `personal data found [${err.where}]: ${[...new Set(err.findings.map((f) => f.kind))].join(', ')} (values not recorded)`;
  return err instanceof Error ? err.message : String(err);
}

function stop(rs: RunState, stage: string, state: PilotState, detail: string): RunState {
  rs.stages.push({ stage, state, at: new Date().toISOString(), detail });
  rs.finalState = state;
  rs.instruction = HUMAN_STEP_INSTRUCTIONS[state] ?? null;
  return rs;
}

function ok(rs: RunState, stage: string, detail: string) {
  rs.stages.push({ stage, state: 'ok', at: new Date().toISOString(), detail });
}

function verifyPreflight(caseDir: string, manifest: PilotManifest): string | null {
  const lockPath = path.join(caseDir, 'work', 'preflight-lock.json');
  if (!fs.existsSync(lockPath)) return 'no preflight lock: run pilot:preflight first';
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as PreflightLock;
  if (sha256(fs.readFileSync(path.join(caseDir, 'manifest.json'))) !== lock.manifestSha256) return 'manifest.json changed after preflight';
  for (const input of manifest.inputs) {
    const l = lock.inputs.find((x) => x.id === input.id);
    const full = path.resolve(caseDir, input.file);
    if (!l || l.file !== input.file) return `input "${input.id}" is not in the preflight lock`;
    if (!fs.existsSync(full)) return `input "${input.id}" disappeared after preflight`;
    if (sha256(fs.readFileSync(full)) !== l.sha256) return `input "${input.id}" changed after preflight (sha256 differs)`;
  }
  return null;
}

export async function runPilotCase(caseDir: string): Promise<RunState> {
  assertCaseStore(caseDir);
  const { manifest, errors } = readManifest(caseDir);
  if (!manifest) throw new Error(errors.join('; '));
  const prev = readRunState(caseDir);
  const rs: RunState = {
    schema: 'pilot-run-state/1',
    caseId: manifest.caseId,
    modelMode: manifest.modelMode,
    sourceIds: prev?.sourceIds ?? {},
    reviewId: prev?.reviewId ?? null,
    finalState: null,
    instruction: null,
    stages: [],
  };
  const done = (s: RunState) => {
    writeJson(statePath(caseDir), s);
    return s;
  };

  // 1. Inputs are exactly what preflight saw.
  const stale = verifyPreflight(caseDir, manifest);
  if (stale) return done(stop(rs, 'preflight-lock', stale.startsWith('no preflight') ? 'PREFLIGHT_FAILED' : 'PREFLIGHT_STALE', stale));
  const preflightReport = JSON.parse(fs.readFileSync(path.join(caseDir, 'work', 'preflight.json'), 'utf8')) as PreflightReport;
  ok(rs, 'preflight-lock', 'all inputs match the preflight hashes');

  // 2. Model availability (no call is made).
  const avail = modelAvailability(manifest.modelMode);
  if (!avail.ok) return done(stop(rs, 'model', manifest.modelMode === 'real' ? 'REAL_MODEL_NOT_AVAILABLE' : 'MODEL_MODE_MISMATCH', avail.detail));
  ok(rs, 'model', avail.detail);
  const deps = { provider: getProvider(), judge: getJudgeProvider('gemini') };

  // 3. Sources through the real upload path.
  const sourceInputs = manifest.inputs.filter((i) => ['PROGRAM_SOURCE', 'FACT_SOURCE', 'METHOD_SOURCE'].includes(i.role));
  for (const input of sourceInputs) {
    const bytes = fs.readFileSync(path.resolve(caseDir, input.file));
    const existing = rs.sourceIds[input.id] ? repository.getSource(rs.sourceIds[input.id]) : undefined;
    if (existing && existing.sha256 === sha256(bytes)) continue;
    try {
      const { source, warnings } = await ingestSourceFile({
        fileBuffer: bytes,
        fileName: path.basename(input.file),
        title: input.source!.title,
        authority: input.source!.authority,
        docType: input.source!.docType,
        subject: manifest.subject,
        grades: input.source!.grades,
        role: input.role === 'METHOD_SOURCE' ? 'METHOD' : 'FACT',
        version: input.source!.version,
        effectiveFrom: input.source!.effectiveFrom,
      });
      rs.sourceIds[input.id] = source.id;
      const pre = preflightReport.inputs.find((x) => x.id === input.id)?.extraction;
      const storedChunks = sha256(source.chunks.map((c) => c.text).join('\n\n'));
      ok(rs, `ingest:${input.id}`, `source ${source.id}, ${source.chunks.length} chunks; chunk hash ${storedChunks === pre?.chunksSha256 ? 'matches preflight' : 'DIFFERS from preflight (OCR text or extraction change)'}${warnings.length ? `; warnings: ${warnings.join(' | ')}` : ''}`);
    } catch (err) {
      const msg = errText(err);
      return done(stop(rs, `ingest:${input.id}`, /չհաջողվեց քաղել|extract/i.test(msg) ? 'EXTRACTION_FAILED' : 'INGESTION_FAILED', msg));
    }
  }
  if (sourceInputs.length) ok(rs, 'ingest', `${sourceInputs.length} source(s) in the case store`);

  // 4. Source confirmation: the operator's stated confirmation from the manifest, or a person in the UI.
  const unconfirmed: string[] = [];
  for (const input of sourceInputs.filter((i) => i.role !== 'METHOD_SOURCE')) {
    const src = repository.getSource(rs.sourceIds[input.id])!;
    if (sourceConfirmationState(src).state === 'confirmed') continue;
    if (input.confirmation) {
      repository.saveSource(confirmSource(src, { confirmedByName: input.confirmation.confirmedByName, expectedVersion: src.version, expectedContentHash: sourceContentHash(src) }));
      ok(rs, `confirm:${input.id}`, `confirmed by stated name "${input.confirmation.confirmedByName}" (manifest; not an authenticated identity)`);
    } else unconfirmed.push(input.id);
  }
  if (unconfirmed.length) return done(stop(rs, 'confirm', 'SOURCE_CONFIRMATION_PENDING', `not confirmed: ${unconfirmed.join(', ')}`));

  // 5. Confirmed outcomes of the program sources.
  const programInputs = sourceInputs.filter((i) => i.role === 'PROGRAM_SOURCE');
  for (const input of programInputs) {
    const sid = rs.sourceIds[input.id];
    const confirmed = repository.getOutcomes().filter((o) => o.sourceId === sid && o.confirmed && o.grade === manifest.grade && o.subject === manifest.subject);
    if (confirmed.length) continue;
    const synth = manifest.synthetic ? manifest.syntheticAutomation?.outcomes?.filter((o) => o.programInputId === input.id) : undefined;
    if (synth?.length) {
      repository.saveOutcomes(synth.map((o) => ({ code: o.code, text: o.text, subject: manifest.subject, grade: manifest.grade, standardVersion: input.source!.version, sourceId: sid, confirmed: true })));
      ok(rs, `outcomes:${input.id}`, `${synth.length} SYNTHETIC outcome(s) from the manifest (synthetic case only)`);
    } else {
      return done(stop(rs, `outcomes:${input.id}`, 'OUTCOMES_PENDING', `program source ${sid} has no confirmed outcomes for ${manifest.subject}, grade ${manifest.grade}`));
    }
  }

  // 6. The teacher document through the real upload path.
  const teacher = manifest.inputs.find((i) => i.role === 'TEACHER_DOCUMENT')!;
  const teacherBytes = fs.readFileSync(path.resolve(caseDir, teacher.file));
  let review: MaterialReview;
  if (rs.reviewId && repository.getMaterialReview(rs.reviewId)) {
    review = getReview(rs.reviewId);
  } else {
    try {
      review = await createReview({ fileName: path.basename(teacher.file), subject: manifest.subject, grade: manifest.grade, bytes: new Uint8Array(teacherBytes), declaredNoStudentData: teacher.noStudentDataDeclared === true });
    } catch (err) {
      return done(stop(rs, 'upload', 'INGESTION_FAILED', errText(err)));
    }
    rs.reviewId = review.id;
  }
  if (review.fileSha256 !== sha256(teacherBytes)) return done(stop(rs, 'upload', 'PREFLIGHT_STALE', 'the stored teacher document is not the current input file'));
  ok(rs, 'upload', `review ${review.id}, original sha256 ${review.fileSha256}`);

  // Select the case's confirmed sources (only when the selection differs: re-selecting marks results stale).
  const want = [
    ...programInputs.map((i) => `program:${rs.sourceIds[i.id]}`),
    ...sourceInputs.filter((i) => i.role === 'FACT_SOURCE').map((i) => `fact:${rs.sourceIds[i.id]}`),
  ].sort();
  const have = review.selectedSources.map((s) => `${s.purpose}:${s.sourceId}`).sort();
  if (JSON.stringify(want) !== JSON.stringify(have)) {
    review = await selectSources(review.id, programInputs.map((i) => rs.sourceIds[i.id]), sourceInputs.filter((i) => i.role === 'FACT_SOURCE').map((i) => rs.sourceIds[i.id]));
  }
  ok(rs, 'sources', want.join(', ') || 'none (content checks will be not evaluated)');

  // 7. Structure.
  if (!review.segmentation) {
    try {
      review = await segment(review.id, deps);
    } catch (err) {
      return done(stop(rs, 'segment', 'MODEL_FAILED', err instanceof Error ? err.message : String(err)));
    }
  }
  const segRun = [...review.runs].reverse().find((x) => x.kind === 'segment');
  if (segRun?.status === 'obsolete') return done(stop(rs, 'segment', 'RUN_OBSOLETE', segRun.error ?? 'split obsolete'));
  if (!review.segmentation) return done(stop(rs, 'segment', 'MODEL_FAILED', segRun?.error ?? 'no structure'));
  if (review.segmentation.status !== 'confirmed') {
    if (manifest.synthetic && manifest.syntheticAutomation?.autoConfirmStructure) {
      review = await confirmSegmentation(review.id, review.revision);
      ok(rs, 'structure', 'SYNTHETIC auto-confirmation (synthetic case only)');
    } else {
      return done(stop(rs, 'structure', 'STRUCTURE_REVIEW_PENDING', `${review.segmentation.items.length} question(s) proposed by ${review.segmentation.model.providerId}/${review.segmentation.model.modelId}; ${review.segmentation.problems.length} part(s) not accepted`));
    }
  } else ok(rs, 'structure', `${review.segmentation.items.length} question(s), confirmed`);

  // 8. Checks (only items without a fresh result; failed calls are retried).
  try {
    review = await runChecks(review.id, deps, { retryFailed: true });
  } catch (err) {
    return done(stop(rs, 'checks', 'MODEL_FAILED', err instanceof Error ? err.message : String(err)));
  }
  const checkRun = [...review.runs].reverse().find((x) => x.kind === 'check' || x.kind === 'recheck');
  if (checkRun?.status === 'obsolete') return done(stop(rs, 'checks', 'RUN_OBSOLETE', checkRun.error ?? 'dependencies changed during the check'));
  let st = reviewStatus(review);
  if (st.counts.executionErrors) return done(stop(rs, 'checks', 'MODEL_FAILED', `${st.counts.executionErrors} check call(s) failed (not evaluated); run pilot:run again to retry`));
  ok(rs, 'checks', `pass ${st.counts.pass}, fail ${st.counts.fail}, needs_review ${st.counts.needs_review}, not_evaluated ${st.counts.not_evaluated}`);

  // 9. Fix proposals: made once; decisions are human (synthetic cases may auto-accept).
  if (st.counts.fail + st.counts.needs_review > 0 && review.suggestions.length === 0) {
    try {
      review = (await suggest(review.id, deps)).review;
    } catch (err) {
      return done(stop(rs, 'suggest', 'MODEL_FAILED', err instanceof Error ? err.message : String(err)));
    }
    const sugRun = [...review.runs].reverse().find((x) => x.kind === 'suggest');
    if (sugRun?.status === 'obsolete') return done(stop(rs, 'suggest', 'RUN_OBSOLETE', sugRun.error ?? 'dependencies changed while proposals were made'));
    ok(rs, 'suggest', `${review.suggestions.length} fix proposal(s) made${review.suggestions.length === 0 ? ' (findings stay open for the teacher)' : ''}`);
  }
  if (manifest.synthetic && manifest.syntheticAutomation?.autoAcceptProposals) {
    for (let guard = 0; guard < 20; guard++) {
      const p = review.suggestions.find((s) => s.status === 'proposed');
      if (!p) break;
      review = await decide(review.id, p.id, { decision: 'accept', expectedRevision: review.revision }, deps);
      ok(rs, 'decide', `SYNTHETIC auto-accept of ${p.id} (synthetic case only)`);
    }
  }
  st = reviewStatus(review);
  if (st.counts.pendingSuggestions) return done(stop(rs, 'decisions', 'DECISIONS_PENDING', `${st.counts.pendingSuggestions} proposal(s) wait for a decision`));
  if (st.counts.pendingRechecks || st.counts.staleItems) return done(stop(rs, 'recheck', 'MODEL_FAILED', 'accepted fixes are not re-checked yet; run pilot:run again'));

  rs.finalState = 'TECHNICAL_RUN_COMPLETE';
  rs.instruction = 'Collect evidence (pilot:evidence), then do the human reviews: Word QA, Armenian review, teacher feedback.';
  rs.stages.push({ stage: 'complete', state: 'TECHNICAL_RUN_COMPLETE', at: new Date().toISOString(), detail: st.final ? 'all checks passed' : `finished with open findings: ${st.reasons.join(' ')}` });
  return done(rs);
}

export type { Source };
