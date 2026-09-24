import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumOutcome, ReportInstance, ReportRule, ThematicPlan } from '../shared/types.js';

const store = vi.hoisted(() => ({
  sources: [] as unknown[],
  plans: [] as ThematicPlan[],
  outcomes: [] as CurriculumOutcome[],
  reports: new Map<string, ReportInstance>(),
}));

vi.mock('../server/store/repository.js', () => ({
  repository: {
    getReportTemplate: () => undefined,
    getOutcomes: () => store.outcomes,
    getThematicPlans: () => store.plans,
    getSources: () => store.sources,
    getReport: (id: string) => store.reports.get(id),
  },
}));

import { RULE_EVALUATORS, evaluateTemplateRule, runReportReview } from '../server/pipeline/reportReviewer.js';

function report(data: Record<string, unknown>, extra: Partial<ReportInstance> = {}): ReportInstance {
  return {
    id: 'r1',
    templateId: 'tpl',
    templateVersion: 'v1',
    title: 'x',
    schoolId: 'sch-1',
    schoolName: 'x',
    authorRole: 'teacher',
    authorName: 'x',
    subject: 'Պատմություն',
    grade: 7,
    period: 'term',
    academicYear: '2026-2027',
    status: 'draft',
    data,
    ...extra,
  } as ReportInstance;
}

// Uses the evaluator's own expression, like the bundled templates do.
const rule = (id: string, kind: ReportRule['kind'] = 'deterministic', expression?: string): ReportRule => ({
  id,
  description: id,
  kind,
  expression: expression ?? RULE_EVALUATORS[id]?.expression,
  severity: 'error',
});
const plan = (p: Partial<ThematicPlan>): ThematicPlan =>
  ({ academicYear: '2026-2027', teacherName: 'x', rows: [], programVersion: 'v', ...p }) as ThematicPlan;

const status = (id: string, data: Record<string, unknown>, extra?: Partial<ReportInstance>) =>
  evaluateTemplateRule(rule(id), report(data, extra)).status;

beforeEach(() => {
  store.sources = [];
  store.plans = [];
  store.outcomes = [];
  store.reports.clear();
});

describe('template rules never pass without being evaluated', () => {
  it('llm_judged and unknown rules are not_evaluated', () => {
    expect(evaluateTemplateRule(rule('rule-x', 'llm_judged'), report({})).status).toBe('not_evaluated');
    expect(status('rule-something-new', { anything: 1 })).toBe('not_evaluated');
  });

  it('missing values are not_evaluated, never treated as 0', () => {
    store.plans = [plan({ programTargetHours: 68 })];
    for (const id of [
      'rule-hours-sum',
      'rule-mandatory-outcomes',
      'rule-hours-deviation',
      'rule-lag-warning',
      'rule-mu-teachers',
      'rule-students-count',
      'rule-avg-bounds',
    ]) {
      expect(status(id, {}), id).toBe('not_evaluated');
    }
  });

  it('a not-evaluated rule makes the review a warning, not ready', () => {
    const review = runReportReview(report({}), {
      id: 'tpl',
      name: { hy: 'x', ru: 'x', en: 'x' },
      status: 'draft_unconfirmed',
      period: 'term',
      authorRole: 'teacher',
      recipientRole: 'director',
      fields: [],
      validationRules: [rule('rule-x', 'llm_judged')],
      layout: { sections: [] },
      version: 'v1',
    });
    const c = review.checks.find((x) => x.id === 'rule-rule-x')!;
    expect(c.passed).toBe(false);
    expect(c.severity).toBe('warning');
    expect(review.status).not.toBe('ready');
  });
});

describe('deterministic rule evaluators can pass and fail', () => {
  it('rule-hours-sum compares with the plan, not a hardcoded 68/34/32', () => {
    const rows = (h: number[]) => ({ topicsTable: h.map((hours) => ({ hours })) });
    expect(status('rule-hours-sum', rows([34, 34]))).toBe('not_evaluated'); // no plan
    store.plans = [plan({ programTargetHours: 102 })];
    expect(status('rule-hours-sum', rows([50, 52]))).toBe('pass');
    expect(status('rule-hours-sum', rows([34, 34]))).toBe('fail');
  });

  it('rule-mandatory-outcomes', () => {
    expect(status('rule-mandatory-outcomes', { coveredOutcomesCount: 5, mandatoryOutcomesCount: 5 })).toBe('pass');
    expect(status('rule-mandatory-outcomes', { coveredOutcomesCount: 4, mandatoryOutcomesCount: 5 })).toBe('fail');
  });

  it('rule-grade-consistency finds other-grade codes anywhere in the data', () => {
    store.outcomes = [
      { code: 'DEMO-ՀՊ-7-1', grade: 7, subject: 'Պատմություն' } as CurriculumOutcome,
      { code: 'DEMO-ՀՊ-8-3', grade: 8, subject: 'Պատմություն' } as CurriculumOutcome,
    ];
    expect(status('rule-grade-consistency', { topicsTable: [{ codes: ['DEMO-ՀՊ-7-1'] }] })).toBe('pass');
    expect(status('rule-grade-consistency', { topicsTable: [{ codes: ['DEMO-ՀՊ-8-3'] }] })).toBe('fail');
  });

  it('rule-hours-deviation fails when either 4 h or 15% is exceeded', () => {
    expect(status('rule-hours-deviation', { plannedHours: 34, actualHours: 32 })).toBe('pass'); // 2 h, 5.9%
    expect(status('rule-hours-deviation', { plannedHours: 34, actualHours: 29 })).toBe('fail'); // 5 h
    expect(status('rule-hours-deviation', { plannedHours: 10, actualHours: 8 })).toBe('fail'); // 2 h, 20%
  });

  it('rule-lag-warning requires an explanation above 2 weeks', () => {
    expect(status('rule-lag-warning', { lagWeeks: 2 })).toBe('pass');
    expect(status('rule-lag-warning', { lagWeeks: 3 })).toBe('fail');
    expect(status('rule-lag-warning', { lagWeeks: 3, teacherReflection: 'Հիվանդության պատճառով' })).toBe('pass');
  });

  it('rule-mu-cross-check sums child reports', () => {
    expect(status('rule-mu-cross-check', { totalActualHours: 10 })).toBe('not_evaluated');
    store.reports.set('c1', report({ actualHours: 6 }, { id: 'c1' }));
    store.reports.set('c2', report({ actualHours: 4 }, { id: 'c2' }));
    expect(status('rule-mu-cross-check', { totalActualHours: 10 }, { childReportIds: ['c1', 'c2'] })).toBe('pass');
    expect(status('rule-mu-cross-check', { totalActualHours: 12 }, { childReportIds: ['c1', 'c2'] })).toBe('fail');
    store.reports.set('c3', report({}, { id: 'c3' }));
    expect(status('rule-mu-cross-check', { totalActualHours: 10 }, { childReportIds: ['c1', 'c3'] })).toBe(
      'not_evaluated'
    );
  });

  it('simple bounds rules', () => {
    expect(status('rule-mu-teachers', { teachersCount: 1 })).toBe('pass');
    expect(status('rule-mu-teachers', { teachersCount: 0 })).toBe('fail');
    expect(status('rule-students-count', { studentsParticipatedCount: 25 })).toBe('pass');
    expect(status('rule-students-count', { studentsParticipatedCount: 0 })).toBe('fail');
    expect(status('rule-avg-bounds', { averageScorePercent: 100 })).toBe('pass');
    expect(status('rule-avg-bounds', { averageScorePercent: 101 })).toBe('fail');
  });
});

describe('source-data checks do not default missing hours to 0', () => {
  it('plan-hours check is not a pass when actualHours is missing', () => {
    store.plans = [plan({ rows: [{ taught: true, actualHours: 2 }] as ThematicPlan['rows'] })];
    const c = runReportReview(report({})).checks.find((x) => x.id === 'src-plan-hours-match')!;
    expect(c.passed).toBe(false);
    expect(c.severity).toBe('warning');
  });

  it('child-report sum is not evaluated when a child has no hours', () => {
    store.reports.set('c1', report({}, { id: 'c1' }));
    const c = runReportReview(report({ totalActualHours: 0 }, { childReportIds: ['c1'] })).checks.find(
      (x) => x.id === 'cross-child-reports-sum'
    )!;
    expect(c.passed).toBe(false);
    expect(c.severity).toBe('warning');
  });
});

describe('external review cases (findings 8–14)', () => {
  it('arrays, booleans and blank strings are not numbers', () => {
    expect(status('rule-avg-bounds', { averageScorePercent: [] })).toBe('fail');
    expect(status('rule-avg-bounds', { averageScorePercent: ' ' })).toBe('fail');
    expect(status('rule-mu-teachers', { teachersCount: true })).toBe('fail');
    expect(status('rule-hours-deviation', { plannedHours: [], actualHours: [] })).toBe('fail');
    expect(status('rule-avg-bounds', { averageScorePercent: '75' })).toBe('pass');
    store.reports.set('c1', report({ actualHours: [] }, { id: 'c1' }));
    expect(status('rule-mu-cross-check', { totalActualHours: 0 }, { childReportIds: ['c1'] })).toBe('fail');
  });

  it('impossible values fail', () => {
    expect(status('rule-mandatory-outcomes', { coveredOutcomesCount: 0, mandatoryOutcomesCount: -1 })).toBe('fail');
    expect(status('rule-hours-deviation', { plannedHours: -5, actualHours: -5 })).toBe('fail');
    expect(status('rule-lag-warning', { lagWeeks: -3 })).toBe('fail');
    expect(status('rule-students-count', { studentsParticipatedCount: 0.5 })).toBe('fail');
    expect(status('rule-mu-teachers', { teachersCount: 1.5 })).toBe('fail');
  });

  it('grade consistency: nothing to compare is not a pass; whole codes only', () => {
    expect(status('rule-grade-consistency', {})).toBe('not_evaluated');
    store.outcomes = [
      { code: 'Ա-1', grade: 8, subject: 'Պատմություն' } as CurriculumOutcome,
      { code: 'Ա-10', grade: 7, subject: 'Պատմություն' } as CurriculumOutcome,
    ];
    expect(status('rule-grade-consistency', { codes: ['Ա-10'] })).toBe('pass');
    expect(status('rule-grade-consistency', { codes: ['Ա-1'] })).toBe('fail');
  });

  it('hours-sum evaluates the table, not only the declared total', () => {
    store.plans = [plan({ programTargetHours: 68 })];
    expect(status('rule-hours-sum', { totalHours: 68, topicsTable: [{ hours: 1 }] })).toBe('fail');
    expect(status('rule-hours-sum', { totalHours: 68, topicsTable: [] })).toBe('not_evaluated');
    expect(status('rule-hours-sum', { topicsTable: [{ hours: 34 }, {}] })).toBe('not_evaluated');
  });

  it('missing plan hours are not zeros', () => {
    store.plans = [plan({ rows: [{ taught: true }] as ThematicPlan['rows'] })];
    const c = runReportReview(report({ actualHours: 0 })).checks.find((x) => x.id === 'src-plan-hours-match')!;
    expect(c.passed).toBe(false);
    expect(c.confidence).toBeUndefined();
  });

  it('program version: only programs/standards count, and the plan of the report year', () => {
    const src = (docType: string, version: string) => ({
      id: 's', subject: 'Պատմություն', grades: [7], status: 'active', docType, version,
    });
    const versionCheck = () => runReportReview(report({})).checks.find((x) => x.id === 'reg-program-version')!;
    store.sources = [src('textbook', 'v1')];
    store.plans = [plan({ programVersion: 'v1' })];
    expect(versionCheck().passed).toBe(false); // a textbook is not a program
    store.sources = [src('subject_program', 'v1')];
    expect(versionCheck().passed).toBe(true);
    store.plans = [plan({ programVersion: 'v1', academicYear: '2027-2028' })];
    expect(versionCheck().passed).toBe(false); // plan of another year
    store.plans = [plan({ programVersion: 'v1', teacherName: 'y' }), plan({ programVersion: 'v2', teacherName: 'z' })];
    expect(versionCheck().passed).toBe(false); // ambiguous: author matches neither plan
    store.plans = [plan({ programVersion: 'v1', teacherName: 'x' }), plan({ programVersion: 'v2', teacherName: 'z' })];
    expect(versionCheck().passed).toBe(true); // the author's own plan
  });

  it('an edited rule expression is not checked with the old logic', () => {
    const edited = rule('rule-avg-bounds', 'deterministic', 'averageScorePercent <= 50');
    expect(evaluateTemplateRule(edited, report({ averageScorePercent: 75 })).status).toBe('not_evaluated');
  });
});
