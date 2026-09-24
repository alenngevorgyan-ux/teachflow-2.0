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

describe('real-model pilot finding: miscopied option text on a single-option paragraph', () => {
  // Seen with google/gemini-3.5-flash at thinking minimal and low (6 of 6 runs):
  // «ա) Կարդան Մամիկոնյան», «ա) Կարմիր Վարդան Մամիկոնյան», «ա)  Վարդան Մամիկոնյան».
  const p = [
    para('p0005-aaaaaaaa', 5, 'Ո՞վ էր հայոց զորավարը Ավարայրի ճակատամարտում:'),
    para('p0006-bbbbbbbb', 6, 'ա) Վարդան Մամիկոնյան'),
    para('p0007-cccccccc', 7, 'բ) Տիգրան Մեծ'),
    para('p0008-dddddddd', 8, '  գ) Արտաշես Առաջին '),
    para('p0009-eeeeeeee', 9, 'ա) Պատասխանը գրեք 3–5 նախադասությամբ  բ) Օգտագործեք դասագրքի տերմինները'),
  ];
  const run = (options: { label: string; paragraphId: string; text: string }[]) =>
    validateSegmentation({ items: [{ number: '2', type: 'single_choice', stemParagraphIds: ['p0005-aaaaaaaa'], stemQuotes: [], options }], answerKey: null }, p);

  it.each([['ա) Կարդան Մամիկոնյան'], ['ա) Կարմիր Վարդան Մամիկոնյան'], ['ա)  Վարդան Մամիկոնյան']])(
    'the option comes from the document, not from the miscopy «%s»',
    (copy) => {
      const v = run([
        { label: 'ա', paragraphId: 'p0006-bbbbbbbb', text: copy },
        { label: 'բ', paragraphId: 'p0007-cccccccc', text: 'բ) Տիգրան Մեծ' },
        { label: 'գ', paragraphId: 'p0008-dddddddd', text: 'գ) Արտաշես Առաջին' },
      ]);
      expect(v.problems).toEqual([]);
      const t = itemText(v.items[0], p);
      expect(t.options.map((o) => o.text)).toEqual(['ա) Վարդան Մամիկոնյան', 'բ) Տիգրան Մեծ', 'գ) Արտաշես Առաջին']);
      expect(v.items[0].options[0]).toMatchObject({ paragraphId: 'p0006-bbbbbbbb', start: 0, end: 'ա) Վարդան Մամիկոնյան'.length });
    }
  );

  it('not when the paragraph starts with another label', () => {
    const v = run([{ label: 'բ', paragraphId: 'p0006-bbbbbbbb', text: 'բ) Կարդան Մամիկոնյան' }]);
    expect(v.items[0].options).toEqual([]);
    expect(v.problems.join(' ')).toContain('չկա պարբերությունում');
  });

  it('not when the paragraph holds several inline options (an exact copy is still required)', () => {
    const v = run([{ label: 'ա', paragraphId: 'p0009-eeeeeeee', text: 'ա) Պատասխանը գրեք 3-5 նախադասությամբ' }]);
    expect(v.items[0].options).toEqual([]);
    expect(v.problems.join(' ')).toContain('չկա պարբերությունում');
  });
});
