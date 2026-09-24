import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumOutcome, Source, ThematicPlan, ThematicPlanRow } from '../shared/types.js';

const store = vi.hoisted(() => ({
  outcomes: [] as CurriculumOutcome[],
  sources: [] as Source[],
  saved: [] as ThematicPlan[],
}));

vi.mock('../server/store/repository.js', () => ({
  repository: {
    getOutcomes: () => store.outcomes,
    getConfirmedOutcomes: (subject: string, grade: number) =>
      store.outcomes.filter((o) => o.confirmed && o.subject === subject && o.grade === grade),
    getSources: () => store.sources,
    saveThematicPlan: (p: ThematicPlan) => {
      store.saved.push(p);
      return p;
    },
  },
}));

import {
  generateThematicPlan,
  thematicPlanNotEvaluated,
  validateThematicPlanDeterministically,
} from '../server/pipeline/thematicPlanGenerator.js';
import type { IModelProvider } from '../server/providers/modelProvider.js';

// Fictional test codes — not real curriculum codes.
const outcome = (code: string, grade: number, confirmed = true): CurriculumOutcome => ({
  code,
  text: code,
  subject: 'history',
  grade,
  standardVersion: 'test',
  sourceId: 'src',
  confirmed,
});

const row = (id: string, overrides: Partial<ThematicPlanRow> = {}): ThematicPlanRow => ({
  id,
  topic: `topic-${id}`,
  outcomeCodes: [],
  plannedHours: 2,
  weekNumber: 1,
  plannedDates: '07.09 - 11.09',
  hasAssessment: false,
  ...overrides,
});

function plan(rows: ThematicPlanRow[], programTargetHours: number): ThematicPlan {
  return {
    id: 'tp',
    title: 't',
    subject: 'history',
    grade: 7,
    programVersion: 'v',
    academicYear: '2026-2027',
    schoolId: 's',
    schoolName: 's',
    teacherName: 't',
    weeklyHours: 2,
    totalAnnualHours: programTargetHours,
    programTargetHours,
    status: 'draft',
    rows,
    calendar: { term1Weeks: 16, term2Weeks: 18, holidays: [], source: 'user_confirmed' },
    validationErrors: [],
    createdAt: '',
    updatedAt: '',
  };
}

beforeEach(() => {
  store.outcomes = [outcome('T7-1', 7), outcome('T7-2', 7), outcome('T7-X', 7, false), outcome('T8-1', 8)];
  store.sources = [];
  store.saved = [];
});

const validRows = () => [
  row('1', { outcomeCodes: ['T7-1'], plannedHours: 2, weekNumber: 1 }),
  row('2', { outcomeCodes: ['T7-2'], plannedHours: 2, weekNumber: 2 }),
];

describe('validateThematicPlanDeterministically', () => {
  it('accepts a plan with the right total and all confirmed outcomes', () => {
    expect(validateThematicPlanDeterministically(plan(validRows(), 4), store.outcomes)).toEqual([]);
  });

  it('fails when planned hours do not add up to the program total', () => {
    const errors = validateThematicPlanDeterministically(plan(validRows(), 5), store.outcomes);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('4');
    expect(errors[0]).toContain('5');
  });

  it('fails when the plan has more hours than the program', () => {
    expect(validateThematicPlanDeterministically(plan(validRows(), 3), store.outcomes)).toHaveLength(1);
  });

  it('fails when a confirmed outcome of the grade is not covered', () => {
    const rows = [row('1', { outcomeCodes: ['T7-1'], plannedHours: 4 })];
    const errors = validateThematicPlanDeterministically(plan(rows, 4), store.outcomes);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('T7-2');
  });

  it('does not require unconfirmed outcomes', () => {
    const errors = validateThematicPlanDeterministically(plan(validRows(), 4), store.outcomes);
    expect(errors.join(' ')).not.toContain('T7-X');
  });

  it('fails when a row uses an outcome code of another grade', () => {
    const rows = [...validRows(), row('3', { outcomeCodes: ['T8-1'], plannedHours: 0, weekNumber: 3 })];
    const errors = validateThematicPlanDeterministically(plan(rows, 4), store.outcomes);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('T8-1');
  });

  it('fails a row with an out-of-range week or no dates', () => {
    const rows = [
      row('1', { outcomeCodes: ['T7-1'], plannedHours: 2, weekNumber: 0 }),
      row('2', { outcomeCodes: ['T7-2'], plannedHours: 2, weekNumber: 37 }),
      row('3', { plannedHours: 0, weekNumber: 3, plannedDates: '' }),
    ];
    expect(validateThematicPlanDeterministically(plan(rows, 4), store.outcomes)).toHaveLength(3);
  });

  it('fails an outcome code that does not exist anywhere in the registry (fabricated code)', () => {
    const rows = [
      ...validRows(),
      row('3', { outcomeCodes: ['T7-INVENTED'], plannedHours: 0, weekNumber: 3 }),
    ];
    const errors = validateThematicPlanDeterministically(plan(rows, 4), store.outcomes);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('T7-INVENTED');
  });

  it('week-bounds check is driven by the plan\'s own calendar, not a hardcoded constant', () => {
    const shortYearPlan: ThematicPlan = {
      ...plan(validRows(), 4),
      calendar: { term1Weeks: 5, term2Weeks: 5, holidays: [], source: 'user_confirmed' }, // 10 teaching weeks total
    };
    const rows = [
      row('1', { outcomeCodes: ['T7-1'], plannedHours: 2, weekNumber: 8 }), // within 10: ok
      row('2', { outcomeCodes: ['T7-2'], plannedHours: 2, weekNumber: 15 }), // beyond 10: fails
    ];
    const errors = validateThematicPlanDeterministically(
      { ...shortYearPlan, rows },
      store.outcomes
    );
    expect(errors.filter((e) => e.includes('շաբաթ'))).toHaveLength(1);
    expect(errors.join(' ')).toContain('15');
  });

  it('without a supplied calendar the week check is not evaluated; the hours check still runs', () => {
    const noCal: ThematicPlan = { ...plan([row('1', { outcomeCodes: ['T7-1'], plannedHours: 2, weekNumber: 99 })], 4), calendar: null };
    const errors = validateThematicPlanDeterministically(noCal, store.outcomes);
    expect(errors.some((e) => e.includes('շաբաթ'))).toBe(false); // week 99 is not judged against an assumed calendar
    expect(errors.some((e) => e.includes('Ժամաքանակի'))).toBe(true); // 2 of 4 hours still fails
    expect(thematicPlanNotEvaluated(noCal)[0]).toContain('Օրացույցային ստուգումը չի կատարվել');
  });

  it('an old stored calendar without provenance (the former hardcoded 16+18) is not trusted', () => {
    const legacy: ThematicPlan = { ...plan(validRows(), 4), calendar: { term1Weeks: 16, term2Weeks: 18, holidays: [] } };
    expect(thematicPlanNotEvaluated(legacy)).toHaveLength(1);
  });
});

function providerReturningTopics(
  topics: { topic: string; outcomeCodes: string[]; plannedHours: number; hasAssessment: boolean }[]
): IModelProvider {
  return {
    providerId: 'fake',
    generateStructured: vi.fn(async () => ({
      output: { topics },
      providerId: 'fake',
      modelId: 'fake-model',
      latencyMs: 0,
      requestId: 'r',
    })) as unknown as IModelProvider['generateStructured'],
    generateText: vi.fn() as unknown as IModelProvider['generateText'],
  };
}

describe('generateThematicPlan', () => {
  it('refuses (throws) when there are no confirmed outcomes for the subject/grade', async () => {
    store.outcomes = []; // nothing confirmed
    const provider = providerReturningTopics([]);

    await expect(
      generateThematicPlan({
        subject: 'history',
        grade: 7,
        programVersion: 'v',
        academicYear: '2026-2027',
        schoolId: 's',
        schoolName: 's',
        teacherName: 't',
        weeklyHours: 2,
        totalAnnualHours: 4,
        provider,
      })
    ).rejects.toThrow(/հաստատված վերջնարդյունքներ/i);

    expect(store.saved).toHaveLength(0);
  });

  it('does not patch hours to force-match the target — a real mismatch surfaces as a validation error', async () => {
    // Model proposes 5 hours total while the target is 4 — this must NOT be
    // silently adjusted on the last topic.
    const provider = providerReturningTopics([
      { topic: 'A', outcomeCodes: ['T7-1'], plannedHours: 2, hasAssessment: false },
      { topic: 'B', outcomeCodes: ['T7-2'], plannedHours: 3, hasAssessment: false },
    ]);

    const plan = await generateThematicPlan({
      subject: 'history',
      grade: 7,
      programVersion: 'v',
      academicYear: '2026-2027',
      schoolId: 's',
      schoolName: 's',
      teacherName: 't',
      weeklyHours: 2,
      totalAnnualHours: 4,
      provider,
    });

    expect(plan.rows.map((r) => r.plannedHours)).toEqual([2, 3]); // untouched, sums to 5, not 4
    expect(plan.validationErrors.some((e) => e.includes('Ժամաքանակի անհամապատասխանություն'))).toBe(true);
  });

  it('a freshly generated plan has no fabricated "already taught" rows', async () => {
    const provider = providerReturningTopics([
      { topic: 'A', outcomeCodes: ['T7-1'], plannedHours: 2, hasAssessment: false },
      { topic: 'B', outcomeCodes: ['T7-2'], plannedHours: 2, hasAssessment: false },
    ]);

    const plan = await generateThematicPlan({
      subject: 'history',
      grade: 7,
      programVersion: 'v',
      academicYear: '2026-2027',
      schoolId: 's',
      schoolName: 's',
      teacherName: 't',
      weeklyHours: 2,
      totalAnnualHours: 4,
      provider,
    });

    for (const row of plan.rows) {
      expect(row.taught).toBe(false);
      // No hours claimed for a row nobody has taught yet — undefined, not 0.
      expect(row.actualHours).toBeUndefined();
      expect(row.taughtDate).toBeUndefined();
    }
  });
});

describe('generateThematicPlan input requirements', () => {
  const baseParams = {
    subject: 'history',
    grade: 7,
    programVersion: 'v',
    academicYear: '2026-2027',
    schoolId: 's',
    schoolName: 's',
    teacherName: 't',
  };

  function provider() {
    return providerReturningTopics([
      { topic: 'A', outcomeCodes: ['T7-1'], plannedHours: 2, hasAssessment: false },
    ]);
  }

  // Was: `params.totalAnnualHours || weeklyHours * 34` — a missing program
  // hour count silently became "weekly hours x 34 study weeks", an invented
  // number that then drove the deterministic hours check.
  it('refuses when the program hour count is missing', async () => {
    await expect(
      generateThematicPlan({
        ...baseParams,
        weeklyHours: 2,
        totalAnnualHours: undefined as unknown as number,
        provider: provider(),
      })
    ).rejects.toThrow(/totalAnnualHours/);
  });

  it.each([0, -4, 2.5, NaN])('refuses a program hour count of %s', async (hours) => {
    await expect(
      generateThematicPlan({
        ...baseParams,
        weeklyHours: 2,
        totalAnnualHours: hours,
        provider: provider(),
      })
    ).rejects.toThrow(/totalAnnualHours/);
  });

  it.each([0, -1, '2' as unknown as number])('refuses a weekly hour count of %s', async (hours) => {
    await expect(
      generateThematicPlan({
        ...baseParams,
        weeklyHours: hours,
        totalAnnualHours: 68,
        provider: provider(),
      })
    ).rejects.toThrow(/weeklyHours/);
  });

  it('uses the program hour count it was given as the target, unchanged', async () => {
    const plan = await generateThematicPlan({
      ...baseParams,
      weeklyHours: 2,
      totalAnnualHours: 51,
      provider: provider(),
    });
    expect(plan.programTargetHours).toBe(51);
    expect(plan.totalAnnualHours).toBe(51);
  });
});
