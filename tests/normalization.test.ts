import { describe, expect, it } from 'vitest';
import { isQuoteVerbatimInChunk, normalizeArmenianText } from '../server/pipeline/normalization.js';

const CHUNK =
  'Տիգրան Մեծը թագավորել է մ.թ.ա. 95–55 թվականներին։ Նրա օրոք Հայաստանը ' +
  'դարձավ հզոր տերություն՝ «ծովից ծով» սահմաններով, և մայրաքաղաք ' +
  'դարձավ Տիգրանակերտը։';

describe('normalizeArmenianText', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeArmenianText('')).toBe('');
  });

  it('treats Armenian full stop ։ and Latin colon/period alike', () => {
    expect(normalizeArmenianText('Հայաստան։')).toBe(normalizeArmenianText('Հայաստան:'));
    expect(normalizeArmenianText('Հայաստան։')).toBe(normalizeArmenianText('Հայաստան.'));
  });

  it('treats Armenian comma ՝ and Latin comma alike', () => {
    expect(normalizeArmenianText('տերություն՝ սահման')).toBe(normalizeArmenianText('տերություն, սահման'));
  });

  it('unifies guillemets, typographic and straight quotes', () => {
    const variants = ['«ծովից ծով»', '"ծովից ծով"', '“ծովից ծով”', '„ծովից ծով“'];
    const norm = variants.map(normalizeArmenianText);
    expect(new Set(norm).size).toBe(1);
  });

  it('unifies apostrophes, including the Armenian apostrophe ՚', () => {
    const variants = ["Ս'ա", 'Ս’ա', 'Սʼա', 'Ս՚ա'];
    expect(new Set(variants.map(normalizeArmenianText)).size).toBe(1);
  });

  it('drops in-word intonation marks ՛ ՞ ՜ without splitting the word', () => {
    expect(normalizeArmenianText('Ինչո՞ւ')).toBe('ինչու');
    expect(normalizeArmenianText('Ա՛յս')).toBe('այս');
    expect(normalizeArmenianText('Վա՜յ')).toBe('վայ');
  });

  it('lowercases Armenian capitals', () => {
    expect(normalizeArmenianText('ՏԻԳՐԱՆ ՄԵԾ')).toBe('տիգրան մեծ');
  });

  it('collapses spaces, tabs, line breaks and non-breaking spaces', () => {
    expect(normalizeArmenianText('  Տիգրան \t Մեծ\n\nթագավոր ')).toBe('տիգրան մեծ թագավոր');
  });

  it('treats the ligature և and the spelling եւ alike', () => {
    expect(normalizeArmenianText('Երևան և Գյումրի')).toBe(normalizeArmenianText('Երեւան եւ Գյումրի'));
  });

  it('unifies hyphen and dash variants', () => {
    expect(normalizeArmenianText('95–55')).toBe(normalizeArmenianText('95-55'));
    expect(normalizeArmenianText('95֊55')).toBe(normalizeArmenianText('95—55'));
  });

  it('is NFC-stable (decomposed and precomposed input normalize the same)', () => {
    // Latin é used because Armenian has no canonical decompositions.
    expect(normalizeArmenianText('Café')).toBe(normalizeArmenianText('Café'));
  });
});

describe('isQuoteVerbatimInChunk', () => {
  it('matches an exact substring', () => {
    expect(isQuoteVerbatimInChunk('Նրա օրոք Հայաստանը դարձավ հզոր տերություն', CHUNK)).toBe(true);
  });

  it('matches across punctuation, quote style, case, whitespace and line-break differences', () => {
    const quote = 'տերություն, "ԾՈՎԻՑ ԾՈՎ"\n սահմաններով,  եւ մայրաքաղաք';
    expect(isQuoteVerbatimInChunk(quote, CHUNK)).toBe(true);
  });

  it('matches a quote ending with a Latin colon against ։ in the chunk', () => {
    expect(isQuoteVerbatimInChunk('95-55 թվականներին:', CHUNK)).toBe(true);
  });

  it('rejects a paraphrase', () => {
    expect(isQuoteVerbatimInChunk('Տիգրան Մեծը կառավարել է մ.թ.ա. 95–55 թվականներին', CHUNK)).toBe(false);
  });

  it('rejects a quote with a changed number', () => {
    expect(isQuoteVerbatimInChunk('թագավորել է մ.թ.ա. 95–56 թվականներին', CHUNK)).toBe(false);
  });

  it('rejects words that exist in the chunk but not in that order', () => {
    expect(isQuoteVerbatimInChunk('Տիգրանակերտը դարձավ մայրաքաղաք', CHUNK)).toBe(false);
  });

  it('rejects empty or punctuation-only quotes and empty chunks', () => {
    expect(isQuoteVerbatimInChunk('', CHUNK)).toBe(false);
    expect(isQuoteVerbatimInChunk('   ', CHUNK)).toBe(false);
    expect(isQuoteVerbatimInChunk('Տիգրան', '')).toBe(false);
    expect(isQuoteVerbatimInChunk('։', CHUNK)).toBe(false);
    expect(isQuoteVerbatimInChunk(' « » ', CHUNK)).toBe(false);
  });
});
