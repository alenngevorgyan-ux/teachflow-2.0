import { describe, expect, it } from 'vitest';
import type { MaterialParagraph } from '../../shared/types.js';
import { validateSegmentation } from '../../server/materials/segmentation.js';
import { itemText } from '../../server/materials/checks.js';

const para = (id: string, index: number, text: string): MaterialParagraph => ({ id, index, text, location: 'body', editable: true, lockReasons: [] });

describe('several questions in one paragraph', () => {
  const p = [para('p0000-aaaaaaaa', 0, '1. Ո՞վ էր Տիգրան Մեծը: 2. Ե՞րբ է կառուցվել Գառնին:')];

  it('are accepted when each has an exact, non-overlapping span', () => {
    const v = validateSegmentation(
      {
        items: [
          { number: '1', type: 'open', stemParagraphIds: ['p0000-aaaaaaaa'], stemQuotes: [{ paragraphId: 'p0000-aaaaaaaa', text: '1. Ո՞վ էր Տիգրան Մեծը:' }], options: [] },
          { number: '2', type: 'open', stemParagraphIds: ['p0000-aaaaaaaa'], stemQuotes: [{ paragraphId: 'p0000-aaaaaaaa', text: '2. Ե՞րբ է կառուցվել Գառնին:' }], options: [] },
        ],
        answerKey: null,
      },
      p
    );
    expect(v.problems).toEqual([]);
    expect(v.items.map((i) => itemText(i, p).stem)).toEqual(['1. Ո՞վ էր Տիգրան Մեծը:', '2. Ե՞րբ է կառուցվել Գառնին:']);
  });

  it('are not silently merged or split when spans are missing: both are dropped and reported', () => {
    const v = validateSegmentation(
      {
        items: [
          { number: '1', type: 'open', stemParagraphIds: ['p0000-aaaaaaaa'], stemQuotes: [], options: [] },
          { number: '2', type: 'open', stemParagraphIds: ['p0000-aaaaaaaa'], stemQuotes: [], options: [] },
        ],
        answerKey: null,
      },
      p
    );
    expect(v.items).toEqual([]);
    expect(v.problems.length).toBeGreaterThanOrEqual(2);
  });

  it('a quote that occurs twice is ambiguous and is not guessed', () => {
    const q = [para('p0001-bbbbbbbb', 1, 'ա) Այո\tբ) Ոչ\tգ) Այո')];
    const v = validateSegmentation(
      { items: [{ number: '1', type: 'single_choice', stemParagraphIds: ['p0001-bbbbbbbb'], stemQuotes: [], options: [{ label: 'ա', paragraphId: 'p0001-bbbbbbbb', text: 'Այո' }] }], answerKey: null },
      q
    );
    expect(v.items[0].options).toEqual([]);
    expect(v.problems.join(' ')).toContain('մեկից ավելի');
  });
});
