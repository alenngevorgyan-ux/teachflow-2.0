import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumOutcome } from '../shared/types.js';
import type { IModelProvider } from '../server/providers/modelProvider.js';

const store = vi.hoisted(() => ({
  outcomes: [] as CurriculumOutcome[],
  saved: [] as CurriculumOutcome[],
}));

vi.mock('../server/store/repository.js', () => ({
  repository: {
    getOutcomes: () => store.outcomes,
    saveOutcomes: (o: CurriculumOutcome[]) => store.saved.push(...o),
  },
}));

import { codeAppearsInText, descriptionFollowsCode, extractOutcomes } from '../server/pipeline/outcomeExtractor.js';

const SOURCE = [
  'Բնագիտություն, 5-րդ դասարան',
  'ԲՆ-5-1. Բացատրել լուսասինթեզի գործընթացը և դրա պայմանները:',
  'ԲՆ-5-12. Նկարագրել բույսի արմատների դերը:',
  'Տարբերակել կենդանի և անկենդան բնությունը:',
].join('\n');

function providerReturning(outcomes: { code: string | null; text: string; grade: number }[]) {
  const calls: string[] = [];
  const provider = {
    providerId: 'test',
    generateStructured: async (prompt: string) => {
      calls.push(prompt);
      return { output: { outcomes }, providerId: 'test', modelId: 'test-model-1', latencyMs: 1, requestId: 'r' };
    },
    generateText: async () => {
      throw new Error('unused');
    },
  } as unknown as IModelProvider;
  return { provider, calls };
}

const run = (outcomes: { code: string | null; text: string; grade: number }[]) =>
  extractOutcomes({ provider: providerReturning(outcomes).provider, text: SOURCE, subject: 'Բնագիտություն', grade: 5, sourceId: 'src-1' });

beforeEach(() => {
  store.outcomes = [];
  store.saved = [];
});

describe('codeAppearsInText', () => {
  it('matches whole codes only', () => {
    expect(codeAppearsInText('ԲՆ-5-1', SOURCE)).toBe(true);
    expect(codeAppearsInText('ԲՆ-5-12', SOURCE)).toBe(true);
    expect(codeAppearsInText('ԲՆ-5-2', SOURCE)).toBe(false);
    expect(codeAppearsInText('Ն-5-1', SOURCE)).toBe(false);
    expect(codeAppearsInText('ԲՆ-5', SOURCE)).toBe(false);
  });
});

describe('extractOutcomes never invents codes', () => {
  it('saves only outcomes whose code and text are verbatim in the source, unconfirmed', async () => {
    const r = await run([
      { code: 'ԲՆ-5-1', text: 'Բացատրել լուսասինթեզի գործընթացը և դրա պայմանները:', grade: 5 },
    ]);
    expect(r.saved).toHaveLength(1);
    expect(r.saved[0]).toMatchObject({ code: 'ԲՆ-5-1', confirmed: false, standardVersion: 'pending-confirmation', sourceId: 'src-1' });
    expect(r.modelId).toBe('test-model-1');
    expect(store.saved).toHaveLength(1);
  });

  it('skips outcomes with no code in the document instead of numbering them', async () => {
    const r = await run([{ code: null, text: 'Տարբերակել կենդանի և անկենդան բնությունը:', grade: 5 }]);
    expect(r.saved).toHaveLength(0);
    expect(r.skipped[0].reason).toBe('no_code_in_source');
    expect(store.saved).toHaveLength(0);
  });

  it('rejects a code the model made up', async () => {
    const r = await run([{ code: 'ԲՆ-5-3', text: 'Տարբերակել կենդանի և անկենդան բնությունը:', grade: 5 }]);
    expect(r.skipped[0].reason).toBe('code_not_in_source');
  });

  it('rejects a paraphrased description', async () => {
    const r = await run([{ code: 'ԲՆ-5-1', text: 'Բացատրել ինչպես է տեղի ունենում լուսասինթեզը:', grade: 5 }]);
    expect(r.skipped[0].reason).toBe('text_not_verbatim');
  });

  it('never overwrites a confirmed outcome', async () => {
    store.outcomes = [
      { code: 'ԲՆ-5-1', text: 'old', subject: 'Բնագիտություն', grade: 5, standardVersion: 'v1', sourceId: 's', confirmed: true },
    ];
    const r = await run([{ code: 'ԲՆ-5-1', text: 'Բացատրել լուսասինթեզի գործընթացը և դրա պայմանները:', grade: 5 }]);
    expect(r.skipped[0].reason).toBe('confirmed_exists');
    expect(store.saved).toHaveLength(0);
  });

  it('skips duplicates within one extraction', async () => {
    const o = { code: 'ԲՆ-5-12', text: 'Նկարագրել բույսի արմատների դերը:', grade: 5 };
    const r = await run([o, o]);
    expect(r.saved).toHaveLength(1);
    expect(r.skipped[0].reason).toBe('duplicate_code');
  });

  it('uses the v2 prompt that forbids inventing codes', async () => {
    const { provider, calls } = providerReturning([]);
    const r = await extractOutcomes({ provider, text: SOURCE, subject: 'Բնագիտություն', grade: 5, sourceId: 's' });
    expect(r.promptFile).toBe('extract_outcomes.v2.txt');
    expect(calls[0]).toContain('NEVER invent');
    expect(calls[0]).toContain(SOURCE);
  });
});

describe('external review cases', () => {
  it('whole codes only, on the original text', () => {
    expect(codeAppearsInText('ԲՆ-5-1', 'X-ԲՆ-5-1. text')).toBe(false);
    expect(codeAppearsInText('ԲՆ-5-1', 'ԲՆ-5-1-A. text')).toBe(false);
    expect(codeAppearsInText('ԲՆ-5-1', '«ԲՆ-5-1» text')).toBe(true);
    expect(codeAppearsInText('ԲՆ-5-1', 'ԲՆ-5-1 – Բացատրել')).toBe(true);
    expect(codeAppearsInText('ԲՆ-5-1', 'բն֊5֊1 text')).toBe(true);
    expect(codeAppearsInText('ԲՆ-5-1', 'ԲՆ - 5 - 1 text')).toBe(true);
    expect(codeAppearsInText('1.1', 'Արդյունք 1.1 text, 1.10 other')).toBe(true);
    expect(codeAppearsInText('1.1', 'only 1.10 here')).toBe(false);
  });

  it('a description must belong to its own code', () => {
    const text = 'ԲՆ-5-1. Առաջին նկարագրություն:\nԲՆ-5-2. Երկրորդ նկարագրություն:';
    const codes = ['ԲՆ-5-1', 'ԲՆ-5-2'];
    expect(descriptionFollowsCode('ԲՆ-5-1', 'Առաջին նկարագրություն:', text, codes)).toBe(true);
    expect(descriptionFollowsCode('ԲՆ-5-1', 'Երկրորդ նկարագրություն:', text, codes)).toBe(false);
  });

  it('same code in another subject is a different outcome', async () => {
    store.outcomes = [
      { code: 'ԲՆ-5-1', text: 'x', subject: 'Other subject', grade: 5, standardVersion: 'v1', sourceId: 's', confirmed: true },
    ];
    const r = await run([{ code: 'ԲՆ-5-1', text: 'Բացատրել լուսասինթեզի գործընթացը և դրա պայմանները:', grade: 5 }]);
    expect(r.saved).toHaveLength(1);
  });
});
