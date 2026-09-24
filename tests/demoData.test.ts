import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Source, ThematicPlan } from '../shared/types.js';

const store = vi.hoisted(() => ({
  plans: [] as ThematicPlan[],
  sources: [] as Source[],
}));

vi.mock('../server/store/repository.js', () => ({
  repository: {
    getReportTemplate: () => undefined,
    getOutcomes: () => [],
    getThematicPlans: () => store.plans,
    getSources: () => store.sources,
    getReport: () => undefined,
  },
}));

import {
  DEMO_SCHOOLS,
  getDemoGlossary,
  getDemoOutcomes,
  getDemoReports,
  getDemoSources,
  getDemoThematicPlans,
} from '../server/store/demoData.js';
import { runReportReview } from '../server/pipeline/reportReviewer.js';

describe('demo seeds (T16)', () => {
  it('use the 2026–2027 academic year', () => {
    for (const p of getDemoThematicPlans()) expect(p.academicYear).toBe('2026-2027');
    for (const r of getDemoReports()) expect(r.academicYear).toBe('2026-2027');
  });

  it('label every outcome code as fictional', () => {
    for (const o of getDemoOutcomes()) expect(o.code).toMatch(/^DEMO-/);
    for (const p of getDemoThematicPlans())
      for (const row of p.rows) for (const c of row.outcomeCodes) expect(c).toMatch(/^DEMO-/);
  });

  it('do not attribute synthetic content to a state body or a real school', () => {
    const text = JSON.stringify([getDemoSources().map((s) => [s.title, s.authority]), DEMO_SCHOOLS]);
    expect(text).not.toMatch(/ԿԳՄՍՆ|ԿԶՆԱԿ|հ\.\s?\d+/);
    for (const s of getDemoSources()) expect(s.isDemo).toBe(true);
  });

  it('do not cite invented glossary sources', () => {
    for (const g of getDemoGlossary()) expect(g.sourceReference).toMatch(/^DEMO DATA/);
  });
});

describe('report review: program version check can fail', () => {
  const report = getDemoReports()[0];
  const source = (version: string): Source =>
    ({ ...getDemoSources()[2], subject: report.subject, grades: [report.grade], version, status: 'active' }) as Source;
  const plan = (programVersion: string): ThematicPlan => ({ ...getDemoThematicPlans()[0], programVersion });
  const versionCheck = () => runReportReview(report).checks.find((c) => c.id === 'reg-program-version')!;

  beforeEach(() => {
    store.plans = [];
    store.sources = [];
  });

  it('passes when the plan version is an active registry version', () => {
    store.plans = [plan('demo-v1')];
    store.sources = [source('demo-v1')];
    expect(versionCheck().passed).toBe(true);
  });

  it('fails when the plan uses a version not in the registry', () => {
    store.plans = [plan('2019-v0')];
    store.sources = [source('demo-v1')];
    const c = versionCheck();
    expect(c.passed).toBe(false);
    expect(c.severity).toBe('error');
  });

  it('does not pass when there is nothing to compare', () => {
    expect(versionCheck().passed).toBe(false);
  });
});

describe('demo seeds pass the privacy guard (no false positives)', () => {
  it('every seeded record', async () => {
    const { assertNoPii } = await import('../server/pipeline/privacyGuard.js');
    const D = await import('../server/store/demoData.js');
    const lists: unknown[][] = [
      D.getDemoReports(),
      D.getDemoReportTemplates(),
      D.getDemoThematicPlans(),
      D.getDemoGlossary(),
      D.getDemoAnswerSheets(),
      D.getDemoArmenianEvalTasks(),
      D.getDemoOutcomes(),
    ];
    for (const list of lists) for (const r of list) expect(() => assertNoPii(r, 'seed')).not.toThrow();
    for (const s of D.getDemoSources()) expect(() => assertNoPii(s, 'seed', { allowContacts: true })).not.toThrow();
  });
});
