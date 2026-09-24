import { describe, expect, it } from 'vitest';
import { comparePagination } from '../../server/docx/layoutCompare.js';

const p1 = 'Թեստ. Հայոց պատմություն. 1. Ե՞րբ է տեղի ունեցել Ավարայրի ճակատամարտը: ա) 451 թ. բ) 301 թ.';
const p2 = '2. Ո՞վ էր հայոց զորավարը Ավարայրի ճակատամարտում: ա) Վարդան Մամիկոնյան բ) Տիգրան Մեծ';

describe('comparePagination', () => {
  it('same pages after an edit in the middle of a page', () => {
    const r = comparePagination([p1, p2], [p1, p2.replace('Տիգրան Մեծ', 'Տիգրան Երկրորդ')], [{ expected: 'Տիգրան Մեծ', replacement: 'Տիգրան Երկրորդ' }]);
    expect(r.verdict).toBe('same_pagination');
  });

  it('detects a page break that moved', () => {
    const moved1 = p1 + ' 2. Ո՞վ էր';
    const moved2 = p2.replace('2. Ո՞վ էր', '').trim();
    const r = comparePagination([p1, p2], [moved1, moved2]);
    expect(r.verdict).toBe('pagination_changed');
    expect(r.shiftedPages).toEqual([1, 2]);
  });

  it('detects a changed page count', () => {
    const r = comparePagination([p1, p2], [p1, p2, 'overflow']);
    expect(r.verdict).toBe('pagination_changed');
    expect(r.notes[0]).toContain('2 -> 3');
  });

  it('an edit at the very start of a page is not a moved break', () => {
    const r = comparePagination([p1, p2], [p1, p2.replace('2. Ո՞վ', '2. Ո՞ր')], [{ expected: '2. Ո՞վ', replacement: '2. Ո՞ր' }]);
    expect(r.verdict).toBe('same_pagination');
  });
});
