// The pilot harness end to end on the SYNTHETIC example case, against a real
// JSON store in the case directory (no repository mock). Every scenario gets
// fresh modules because the store reads TEACHFLOW_DATA_DIR at import.
import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writePreflight } from '../../server/pilot/preflight.js';
import { makeCase } from './helpers.js';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

async function modulesFor(caseDir: string, mode: 'fixture' | 'real' | 'none' = 'fixture') {
  vi.resetModules();
  process.env.TEACHFLOW_DATA_DIR = path.join(caseDir, 'work', 'store');
  process.env.TEACHFLOW_STORE_SEED = 'rules-only';
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL_ID;
  if (mode === 'fixture') {
    process.env.TEACHFLOW_FIXTURE_MODE = '1';
    process.env.MODEL_PROVIDER = 'fixture';
  } else {
    delete process.env.TEACHFLOW_FIXTURE_MODE;
    process.env.MODEL_PROVIDER = mode === 'real' ? 'openrouter' : 'gemini';
  }
  const run = await import('../../server/pilot/run.js');
  const evidence = await import('../../server/pilot/evidence.js');
  return { ...run, ...evidence };
}

const SOURCE_ONLY_TEXT = 'սինթետիկ փաստական հատված';

function bundleFiles(dir: string): Record<string, string> {
  return Object.fromEntries(fs.readdirSync(dir).filter((f) => !f.endsWith('.docx')).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
}

describe('pilot run: synthetic fixture case end to end', () => {
  it('runs the real pipeline, collects a complete, hash-verified, text-free evidence bundle, and reruns idempotently', async () => {
    const dir = makeCase();
    expect((await writePreflight(dir)).report.status).toBe('PREFLIGHT_PASSED');
    const m = await modulesFor(dir);
    const rs = await m.runPilotCase(dir);
    expect(rs.finalState, JSON.stringify(rs.stages, null, 1)).toBe('TECHNICAL_RUN_COMPLETE');
    expect(rs.stages.map((s) => s.stage)).toEqual(expect.arrayContaining(['preflight-lock', 'model', 'ingest', 'confirm:program', 'upload', 'structure', 'checks', 'complete']));

    const ev = await m.collectEvidence(dir, { now: new Date('2026-09-24T10:00:00Z') });
    expect(ev.overallState).toBe('TECHNICAL_RUN_COMPLETE');
    expect(ev.modelExecution).toBe('fixture_deterministic');
    expect(ev.problems).toEqual([]);
    for (const f of ['manifest.final.json', 'preflight.json', 'source-diagnostics.json', 'run.json', 'check-results.json', 'export.docx', 'export.sha256', 'docx-diagnostics.json', 'change-report.txt', 'summary.md', 'SHA256SUMS', 'word-qa-checklist.md', 'armenian-review-checklist.md', 'human-review-template.md', 'teacher-feedback-template.md']) {
      expect(fs.existsSync(path.join(ev.bundleDir, f)), f).toBe(true);
    }
    // SHA256SUMS matches the files
    const { sha256 } = await import('../../server/pilot/preflight.js');
    for (const line of fs.readFileSync(path.join(ev.bundleDir, 'SHA256SUMS'), 'utf8').trim().split('\n')) {
      const [hash, name] = line.split(/\s+/);
      expect(sha256(fs.readFileSync(path.join(ev.bundleDir, name))), name).toBe(hash);
    }
    const files = bundleFiles(ev.bundleDir);
    // no raw source text, labelled synthetic, human steps not faked
    for (const [name, text] of Object.entries(files)) expect(text, name).not.toContain(SOURCE_ONLY_TEXT);
    expect(files['summary.md']).toMatch(/SYNTHETIC CASE/);
    expect(files['summary.md']).toMatch(/FIXTURE rules, not a model/);
    expect(files['summary.md'].match(/UNVERIFIED — REQUIRES REAL PILOT/g)!.length).toBe(4);
    expect(JSON.parse(files['check-results.json']).includesExcerpts).toBe(false);
    const runJson = JSON.parse(files['run.json']);
    expect(runJson.auditedCalls.filter((c: { providerId: string }) => c.providerId !== 'fixture')).toEqual([]);
    expect(runJson.provenance.prompts).toBeTruthy();
    // retrieval is stated, never hidden: fixture mode has no embeddings
    expect(runJson.semanticRetrieval.configured).toEqual({ state: 'KEYWORD_FALLBACK', embedding: null });
    expect(runJson.semanticRetrieval.observed.state).toBe('KEYWORD_FALLBACK');
    expect(runJson.semanticRetrieval.observed.checks.keyword).toBeGreaterThan(0);
    expect(files['summary.md']).toMatch(/SEMANTIC_RETRIEVAL = KEYWORD_FALLBACK/);
    expect(rs.stages.filter((x) => x.stage === 'retrieval').map((x) => x.detail)).toEqual([expect.stringMatching(/^SEMANTIC_RETRIEVAL = KEYWORD_FALLBACK/), expect.stringMatching(/^SEMANTIC_RETRIEVAL = KEYWORD_FALLBACK/)]);
    expect(runJson.provenance.reasoning.perOperation['material:segment']).toBe('minimal');
    expect(files['summary.md']).toMatch(/## Model calls/);
    // the synthetic proposal was accepted, re-checked, and reached the exported file
    const checks = JSON.parse(files['check-results.json']);
    expect(checks.suggestions.map((x: { status: string; recheck: string | null }) => [x.status, x.recheck])).toEqual([['accepted', 'done']]);
    const diag = JSON.parse(files['docx-diagnostics.json']);
    expect(diag.expected).toEqual([{ text: '2-ա', present: true }]);
    expect(diag.exportDeterministic).toBe(true);
    expect(diag.sha256).not.toBe(runJson.review.originalSha256);
    const src = JSON.parse(files['source-diagnostics.json']);
    expect(src.sources.every((s: { storedMatchesPreflight?: boolean; chunksMatchPreflight?: boolean }) => s.chunksMatchPreflight !== false)).toBe(true);

    // a second collection never overwrites the first
    const first = fs.readFileSync(path.join(ev.bundleDir, 'summary.md'), 'utf8');
    const ev2 = await m.collectEvidence(dir, { now: new Date('2026-09-24T11:00:00Z') });
    expect(ev2.bundleDir).not.toBe(ev.bundleDir);
    expect(fs.readFileSync(path.join(ev.bundleDir, 'summary.md'), 'utf8')).toBe(first);
    await expect(m.collectEvidence(dir, { now: new Date('2026-09-24T10:00:00Z') })).rejects.toThrow(/exists/);

    // rerun: same sources and review, nothing re-ingested
    const rs2 = await m.runPilotCase(dir);
    expect(rs2.finalState).toBe('TECHNICAL_RUN_COMPLETE');
    expect(rs2.sourceIds).toEqual(rs.sourceIds);
    expect(rs2.reviewId).toBe(rs.reviewId);
    expect(rs2.stages.some((s) => s.stage.startsWith('ingest:'))).toBe(false);
  }, 60_000);

  it('with --include-excerpts the check text is included (explicit opt-in)', async () => {
    const dir = makeCase();
    await writePreflight(dir);
    const m = await modulesFor(dir);
    await m.runPilotCase(dir);
    const ev = await m.collectEvidence(dir, { includeExcerpts: true });
    expect(JSON.parse(fs.readFileSync(path.join(ev.bundleDir, 'check-results.json'), 'utf8')).includesExcerpts).toBe(true);
  }, 60_000);
});

describe('pilot run: explicit failure states', () => {
  it('no preflight -> PREFLIGHT_FAILED; input changed after preflight -> PREFLIGHT_STALE; manifest changed -> PREFLIGHT_STALE', async () => {
    const dir = makeCase();
    const m = await modulesFor(dir);
    expect((await m.runPilotCase(dir)).finalState).toBe('PREFLIGHT_FAILED');

    await writePreflight(dir);
    fs.appendFileSync(path.join(dir, 'inputs/fact-FIXTURE.txt'), '\nFIXTURE — changed after preflight.');
    const stale = await m.runPilotCase(dir);
    expect(stale.finalState).toBe('PREFLIGHT_STALE');
    expect(stale.stages.at(-1)!.detail).toMatch(/"fact" changed after preflight/);

    await writePreflight(dir);
    const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    man.scenario += ' (edited)';
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man));
    expect((await m.runPilotCase(dir)).stages.at(-1)!.detail).toMatch(/manifest.json changed after preflight/);
    // nothing was ingested by the refused runs
    const { repository } = await import('../../server/store/repository.js');
    expect(repository.getSources()).toEqual([]);
  });

  it('a failed preflight removes the old lock, so an old pass cannot be reused', async () => {
    const dir = makeCase();
    await writePreflight(dir);
    fs.writeFileSync(path.join(dir, 'inputs/fact-FIXTURE.txt'), '');
    expect((await writePreflight(dir)).report.status).toBe('PREFLIGHT_FAILED');
    expect(fs.existsSync(path.join(dir, 'work/preflight-lock.json'))).toBe(false);
  });

  it('real mode without credentials -> REAL_MODEL_NOT_AVAILABLE, no model call, never falls back to fixture', async () => {
    const dir = makeCase((mm) => {
      mm.modelMode = 'real';
      delete mm.syntheticAutomation;
    });
    await writePreflight(dir);
    const m = await modulesFor(dir, 'real');
    const rs = await m.runPilotCase(dir);
    expect(rs.finalState).toBe('REAL_MODEL_NOT_AVAILABLE');
    expect(rs.stages.at(-1)!.detail).toMatch(/not configured/);
    const { repository } = await import('../../server/store/repository.js');
    expect(repository.getSources()).toEqual([]);
    expect(repository.getAuditLogs()).toEqual([]);
  });

  it('real mode in a fixture environment -> REAL_MODEL_NOT_AVAILABLE (a fixture result is never labelled real)', async () => {
    const dir = makeCase((mm) => (mm.modelMode = 'real'));
    await writePreflight(dir);
    const m = await modulesFor(dir, 'fixture');
    const rs = await m.runPilotCase(dir);
    expect(rs.finalState).toBe('REAL_MODEL_NOT_AVAILABLE');
    expect(rs.stages.at(-1)!.detail).toMatch(/MODEL_PROVIDER=fixture in a real-model run/);
  });

  it('fixture case outside the fixture environment -> MODEL_MODE_MISMATCH', async () => {
    const dir = makeCase();
    await writePreflight(dir);
    const m = await modulesFor(dir, 'none');
    expect((await m.runPilotCase(dir)).finalState).toBe('MODEL_MODE_MISMATCH');
  });

  it('a pilot store holds no demo content (only the method rules) and a store with demo content is refused', async () => {
    const dir = makeCase();
    await writePreflight(dir);
    const m = await modulesFor(dir);
    const { repository } = await import('../../server/store/repository.js');
    expect(repository.getSources()).toEqual([]);
    expect(repository.getOutcomes()).toEqual([]);
    expect(repository.getThematicPlans()).toEqual([]);
    expect(repository.getActiveRules().map((r) => r.id)).toContain('rule-single-correct-answer');

    const dir2 = makeCase();
    await writePreflight(dir2);
    vi.resetModules();
    process.env.TEACHFLOW_DATA_DIR = path.join(dir2, 'work', 'store');
    delete process.env.TEACHFLOW_STORE_SEED; // store created the normal way: seeded with demo data
    await import('../../server/store/repository.js');
    const m2 = await modulesFor(dir2);
    await expect(m2.runPilotCase(dir2)).rejects.toThrow(/contains \d+ demo source/);
    void m;
  });

  it('refuses to run against any store but the case store', async () => {
    const dir = makeCase();
    await writePreflight(dir);
    const m = await modulesFor(dir);
    process.env.TEACHFLOW_DATA_DIR = path.resolve('data');
    await expect(m.runPilotCase(dir)).rejects.toThrow(/TEACHFLOW_DATA_DIR must be/);
  });

  it('stops at each human step when nothing automates it', async () => {
    const dir = makeCase((mm) => {
      delete mm.syntheticAutomation;
      for (const i of mm.inputs) delete i.confirmation;
    });
    await writePreflight(dir);
    const m = await modulesFor(dir);
    const a = await m.runPilotCase(dir);
    expect(a.finalState).toBe('SOURCE_CONFIRMATION_PENDING');
    expect(a.instruction).toBeTruthy();

    // confirmation stated in the manifest -> next stop: outcomes
    const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    for (const i of man.inputs) if (i.source) i.confirmation = { confirmedByName: 'SYNTHETIC tester' };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man));
    await writePreflight(dir);
    const b = await m.runPilotCase(dir);
    expect(b.finalState).toBe('OUTCOMES_PENDING');
    expect(b.sourceIds).toEqual(a.sourceIds); // not re-ingested

    man.syntheticAutomation = { outcomes: [{ code: 'FIXTURE-HP7-1', text: 'Ավարայրի ճակատամարտի պատմական նշանակությունը', programInputId: 'program' }] };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man));
    await writePreflight(dir);
    const c = await m.runPilotCase(dir);
    expect(c.finalState).toBe('STRUCTURE_REVIEW_PENDING');

    // evidence at a human step: honest state, no fake completion
    const ev = await m.collectEvidence(dir);
    expect(ev.overallState).toBe('STRUCTURE_REVIEW_PENDING');
    expect(fs.readFileSync(path.join(ev.bundleDir, 'summary.md'), 'utf8')).toMatch(/STRUCTURE_REVIEW_PENDING/);
  }, 60_000);
});

describe('pilot evidence: honesty of the bundle', () => {
  it('a fixture result under a case now declared real is MODEL_MODE_MISMATCH, never real evidence', async () => {
    const dir = makeCase();
    await writePreflight(dir);
    const m = await modulesFor(dir);
    expect((await m.runPilotCase(dir)).finalState).toBe('TECHNICAL_RUN_COMPLETE');
    const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    man.modelMode = 'real';
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man));
    await writePreflight(dir); // even with a fresh lock
    const ev = await m.collectEvidence(dir);
    expect(ev.overallState).toBe('MODEL_MODE_MISMATCH');
    expect(ev.problems.join()).toMatch(/declared real but results come from the FIXTURE provider/);
    expect(ev.modelExecution).toBe('fixture_deterministic');
  }, 60_000);

  it('an input edited after the run makes the evidence PREFLIGHT_STALE', async () => {
    const dir = makeCase();
    await writePreflight(dir);
    const m = await modulesFor(dir);
    await m.runPilotCase(dir);
    fs.appendFileSync(path.join(dir, 'inputs/program-FIXTURE.txt'), '\nFIXTURE — edited after the run.');
    const ev = await m.collectEvidence(dir);
    expect(ev.overallState).toBe('PREFLIGHT_STALE');
    expect(ev.problems.join()).toMatch(/"program" changed after preflight/);
  }, 60_000);

  it('on a completed run, expected text missing from the export is EXPORT_FAILED (before completion it is not evaluated)', async () => {
    const dir = makeCase((mm) => (mm.expectations = { exportContains: ['FIXTURE — text that no fix produces'] }));
    await writePreflight(dir);
    const m = await modulesFor(dir);
    expect((await m.runPilotCase(dir)).finalState).toBe('TECHNICAL_RUN_COMPLETE');
    const ev = await m.collectEvidence(dir);
    expect(ev.overallState).toBe('EXPORT_FAILED');
    expect(ev.problems.join()).toMatch(/expected text missing \(1\)/);
  }, 60_000);

  it('Armenian file names with spaces work end to end', async () => {
    const name = 'inputs/Թեստ Ավարայր 7-րդ դասարան.docx';
    const dir = makeCase((mm, d) => {
      fs.renameSync(path.join(d, 'inputs/teacher-test-FIXTURE.docx'), path.join(d, name));
      mm.inputs[2].file = name;
    });
    expect((await writePreflight(dir)).report.status).toBe('PREFLIGHT_PASSED');
    const m = await modulesFor(dir);
    expect((await m.runPilotCase(dir)).finalState).toBe('TECHNICAL_RUN_COMPLETE');
    expect((await m.collectEvidence(dir)).overallState).toBe('TECHNICAL_RUN_COMPLETE');
  }, 60_000);
});

describe('pilot run: synthetic automation never hides a structure problem', () => {
  it('a proposed structure with rejected parts stops at STRUCTURE_REVIEW_PENDING even with autoConfirmStructure', async () => {
    const dir = makeCase((mm) => (mm.syntheticAutomation.autoConfirmStructure = false));
    await writePreflight(dir);
    const m = await modulesFor(dir);
    const a = await m.runPilotCase(dir);
    expect(a.finalState).toBe('STRUCTURE_REVIEW_PENDING');
    // the proposed structure carries a rejected part (as a real model produced)
    const { repository } = await import('../../server/store/repository.js');
    const review = repository.getMaterialReview(a.reviewId!)!;
    review.segmentation!.problems = ['SYNTHETIC: «2.» հարց. «ա» տարբերակ չի ընդունվել'];
    repository.saveMaterialReview(review);
    const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    man.syntheticAutomation.autoConfirmStructure = true;
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man));
    await writePreflight(dir);
    const b = await m.runPilotCase(dir);
    expect(b.finalState).toBe('STRUCTURE_REVIEW_PENDING');
    expect(b.stages.at(-1)!.detail).toMatch(/1 part\(s\) not accepted/);
  }, 60_000);
});

describe('pilot evidence: secrets', () => {
  it('a secret value that reaches the evidence is detected, the file removed and the bundle marked EVIDENCE_FAILED', async () => {
    const SECRET = 'sk-or-v1-SYNTHETIC-not-a-real-key-0123456789';
    const dir = makeCase((mm) => (mm.scenario += ` ${SECRET}`));
    await writePreflight(dir);
    const m = await modulesFor(dir);
    process.env.OPENROUTER_API_KEY = SECRET;
    await m.runPilotCase(dir);
    const ev = await m.collectEvidence(dir);
    expect(ev.overallState).toBe('EVIDENCE_FAILED');
    for (const [name, text] of Object.entries(bundleFiles(ev.bundleDir))) expect(text, name).not.toContain(SECRET);
    expect(fs.readFileSync(path.join(ev.bundleDir, 'summary.md'), 'utf8')).toMatch(/OPENROUTER_API_KEY/);
  }, 60_000);

  it('a normal bundle contains no secret value and only presence booleans for credentials', async () => {
    const SECRET = 'SYNTHETIC-gemini-key-abcdefghijkl';
    const dir = makeCase();
    await writePreflight(dir);
    const m = await modulesFor(dir);
    process.env.GEMINI_API_KEY = SECRET;
    await m.runPilotCase(dir);
    const ev = await m.collectEvidence(dir);
    expect(ev.overallState).toBe('TECHNICAL_RUN_COMPLETE');
    for (const [name, text] of Object.entries(bundleFiles(ev.bundleDir))) expect(text, name).not.toContain(SECRET);
    expect(JSON.parse(fs.readFileSync(path.join(ev.bundleDir, 'run.json'), 'utf8')).provenance.model.credentialsPresent.GEMINI_API_KEY).toBe(true);
    expect(fs.readFileSync(path.join(ev.bundleDir, 'export.docx')).includes(Buffer.from(SECRET))).toBe(false);
  }, 60_000);
});
