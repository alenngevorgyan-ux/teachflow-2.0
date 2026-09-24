import { describe, expect, it } from 'vitest';
import type { TextPatch } from '../../shared/types.js';
import { mapSpan } from '../../server/materials/workingCopy.js';

const patch = (start: number, end: number, replacement: string, paragraphId = 'p'): TextPatch => ({
  id: `${start}-${end}`,
  paragraphId,
  start,
  end,
  expected: 'x'.repeat(end - start),
  replacement,
  baseRevision: 'r0',
  baseTextHash: 'h',
});

describe('mapSpan', () => {
  const span = { paragraphId: 'p', start: 10, end: 15 };
  const group = (...patches: TextPatch[]) => ({ id: 'g', patches });

  it('does not move for a patch after the span or in another paragraph', () => {
    expect(mapSpan(span, group(patch(20, 22, 'abc')))).toEqual({ span, touched: false });
    expect(mapSpan(span, group(patch(0, 5, 'a', 'q')))).toEqual({ span, touched: false });
  });

  it('shifts by the length change of a patch before the span', () => {
    expect(mapSpan(span, group(patch(0, 2, 'abcd')))).toEqual({ span: { paragraphId: 'p', start: 12, end: 17 }, touched: false });
  });

  it('grows to cover a patch that overlaps it', () => {
    expect(mapSpan(span, group(patch(12, 13, 'xyz')))).toEqual({ span: { paragraphId: 'p', start: 10, end: 17 }, touched: true });
    expect(mapSpan(span, group(patch(8, 12, 'z')))).toEqual({ span: { paragraphId: 'p', start: 8, end: 12 }, touched: true });
  });

  it('handles several patches of one group against the same base', () => {
    expect(mapSpan(span, group(patch(0, 1, 'aa'), patch(20, 21, 'b'), patch(11, 11, 'ins')))).toEqual({
      span: { paragraphId: 'p', start: 11, end: 19 },
      touched: true,
    });
  });
});
