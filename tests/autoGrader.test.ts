import { describe, expect, it, vi } from 'vitest';
import type { Assessment, AssessmentItem } from '../shared/types.js';

vi.mock('../server/store/repository.js', () => ({ repository: {} }));

import { gradeSubmissionDeterministically } from '../server/pipeline/autoGrader.js';

function item(id: string, overrides: Partial<AssessmentItem>): AssessmentItem {
  return {
    id,
    variant: 'A',
    type: 'single_choice',
    stem: id,
    options: ['A', 'B', 'C'],
    answerKey: 'A',
    outcomeCodes: [],
    difficulty: 'basic',
    citations: [],
    ...overrides,
  };
}

const assessment = {
  id: 'as-1',
  items: [
    item('sc', { type: 'single_choice', answerKey: 'B' }),
    item('mc', { type: 'multiple_choice', options: ['A', 'B', 'C', 'D'], answerKey: ['A', 'C'] }),
    item('sa', { type: 'short_answer', options: undefined, answerKey: 'Տիգրանակերտ' }),
    item('b1', { variant: 'B', answerKey: 'C' }),
  ],
} as unknown as Assessment;

function grade(answers: { itemId: string; studentAnswer: string }[], variant: 'A' | 'B' = 'A') {
  return gradeSubmissionDeterministically(assessment, {
    assessmentId: 'as-1',
    variant,
    studentCode: '7B-14',
    answers: answers.map((a, i) => ({ itemIndex: i + 1, ...a })),
  });
}

const pointsOf = (res: ReturnType<typeof grade>, id: string) =>
  res.answers.find((a) => a.itemId === id)?.pointsAwarded;

describe('gradeSubmissionDeterministically', () => {
  it('scores single choice case- and whitespace-insensitively', () => {
    const res = grade([{ itemId: 'sc', studentAnswer: ' b ' }]);
    expect(pointsOf(res, 'sc')).toBe(1);
    expect(grade([{ itemId: 'sc', studentAnswer: 'A' }]).totalScore).toBe(0);
  });

  it('scores multiple choice regardless of order and spacing', () => {
    expect(pointsOf(grade([{ itemId: 'mc', studentAnswer: 'A,C' }]), 'mc')).toBe(1);
    expect(pointsOf(grade([{ itemId: 'mc', studentAnswer: 'c, a' }]), 'mc')).toBe(1);
  });

  it('multiple choice needs exactly the key set', () => {
    expect(pointsOf(grade([{ itemId: 'mc', studentAnswer: 'A' }]), 'mc')).toBe(0);
    expect(pointsOf(grade([{ itemId: 'mc', studentAnswer: 'A,B,C' }]), 'mc')).toBe(0);
  });

  it('scores a correct short answer', () => {
    expect(pointsOf(grade([{ itemId: 'sa', studentAnswer: 'տիգրանակերտ' }]), 'sa')).toBe(1);
  });

  it('an empty answer is never correct', () => {
    const res = grade([
      { itemId: 'sc', studentAnswer: '' },
      { itemId: 'mc', studentAnswer: '' },
      { itemId: 'sa', studentAnswer: '   ' },
    ]);
    expect(res.totalScore).toBe(0);
    expect(res.answers.every((a) => a.isCorrect === false)).toBe(true);
  });

  it('computes total, max and percent', () => {
    const res = grade([
      { itemId: 'sc', studentAnswer: 'B' },
      { itemId: 'mc', studentAnswer: 'A' },
      { itemId: 'sa', studentAnswer: 'Տիգրանակերտ' },
    ]);
    expect(res.totalScore).toBe(2);
    expect(res.maxScore).toBe(3);
    expect(res.percent).toBe(67);
  });

  it('grades against the submitted variant only', () => {
    const res = grade([{ itemId: 'b1', studentAnswer: 'C' }], 'B');
    expect(res.totalScore).toBe(1);
    // A variant-B answer submitted on variant A is not graded against the B key
    expect(grade([{ itemId: 'b1', studentAnswer: 'C' }], 'A').totalScore).toBe(0);
  });

  it('keeps the anonymous student code and does not invent a confidence', () => {
    const res = grade([{ itemId: 'sc', studentAnswer: 'B' }]);
    expect(res.studentCode).toBe('7B-14');
    expect(res.confidenceOverall).toBeUndefined();
    expect(res.answers[0].confidence).toBeUndefined();
  });
});
