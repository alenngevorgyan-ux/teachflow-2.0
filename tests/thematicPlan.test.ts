import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumOutcome, ThematicPlan, ThematicPlanRow } from '../shared/types.js';

const store = vi.hoisted(() => ({ outcomes: [] as CurriculumOutcome[] }));

vi.mock('../server/store/repository.js', () => ({
  repository: { getOutcomes: () => store.outcomes },
}));

import { validateThematicPlanDeterministically } from '../server/pipeline/thematicPlanGenerator.js';

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
    calendar: { term1Weeks: 16, term2Weeks: 18, holidays: [] },
    validationErrors: [],
    createdAt: '',
    updatedAt: '',
  };
}

beforeEach(() => {
  store.outcomes = [outcome('T7-1', 7), outcome('T7-2', 7), outcome('T7-X', 7, false), outcome('T8-1', 8)];
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
});
