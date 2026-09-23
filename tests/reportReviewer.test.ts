import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumOutcome, ReportInstance, ReportRule, ThematicPlan } from '../shared/types.js';

const store = vi.hoisted(() => ({
  plans: [] as ThematicPlan[],
  outcomes: [] as CurriculumOutcome[],
  reports: new Map<string, ReportInstance>(),
}));

vi.mock('../server/store/repository.js', () => ({
  repository: {
    getReportTemplate: () => undefined,
    getOutcomes: () => store.outcomes,
    getThematicPlans: () => store.plans,
    getSources: () => [],
    getReport: (id: string) => store.reports.get(id),
  },
}));

import { evaluateTemplateRule, runReportReview } from '../server/pipeline/reportReviewer.js';

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

const rule = (id: string, kind: ReportRule['kind'] = 'deterministic'): ReportRule => ({
  id,
  description: id,
  kind,
  severity: 'error',
});

const status = (id: string, data: Record<string, unknown>, extra?: Partial<ReportInstance>) =>
  evaluateTemplateRule(rule(id), report(data, extra)).status;

beforeEach(() => {
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
    expect(status('rule-hours-sum', { totalHours: 68 })).toBe('not_evaluated'); // no plan
    store.plans = [{ programTargetHours: 102 } as ThematicPlan];
    expect(status('rule-hours-sum', { totalHours: 102 })).toBe('pass');
    expect(status('rule-hours-sum', { totalHours: 68 })).toBe('fail');
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
    store.plans = [{ rows: [{ taught: true, actualHours: 2 }], programVersion: 'v' } as unknown as ThematicPlan];
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
