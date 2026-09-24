import { describe, expect, it } from 'vitest';
import { UserInputError, parseGradeInput } from '../server/pipeline/errors.js';

describe('parseGradeInput', () => {
  it('accepts a positive integer or a string of digits', () => {
    expect(parseGradeInput(7)).toBe(7);
    expect(parseGradeInput('7')).toBe(7);
    expect(parseGradeInput(' 12 ')).toBe(12);
  });

  it.each([
    ['true', true],
    ['[7]', [7]],
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['zero', 0],
    ['negative', -3],
    ['fraction', 7.5],
    ['"7.0"', '7.0'],
    ['"7abc"', '7abc'],
    ['"1e1"', '1e1'],
    ['object', { grade: 7 }],
  ])('rejects %s', (_label, value) => {
    expect(() => parseGradeInput(value)).toThrow(UserInputError);
  });
});
