import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MethodRule, ScorecardMetric, Source } from '../shared/types.js';

const store = vi.hoisted(() => ({ sources: [] as Source[], rules: [] as MethodRule[] }));

vi.mock('../server/store/repository.js', () => ({
  repository: {
    getSources: () => store.sources,
    getActiveRules: () => store.rules.filter((r) => r.active),
    computePolicyVersion: () => 'test-policy',
    logAIInteraction: () => undefined,
  },
}));

import {
  aggregateRuns,
  refusalStability,
  resolveQuoteToChunk,
  runBaselineOnce,
  tokenOverlap,
  type BaselineRunContext,
} from '../server/pipeline/compare.js';
import type { RetrievedChunk } from '../server/pipeline/retrieval.js';
import type { IJudgeProvider } from '../server/providers/judgeProvider.js';
import type { IModelProvider } from '../server/providers/modelProvider.js';

const FACT_TEXT = 'Տիգրան Մեծը թագավորել է մ.թ.ա. 95–55 թվականներին։ Մայրաքաղաքը Տիգրանակերտն էր։';
const METHOD_TEXT = 'Թեստը պետք է ունենա առնվազն երեք պատասխանի տարբերակ յուրաքանչյուր հարցի համար։';

function src(id: string, role: Source['role'], text: string): Source {
  return {
    id,
    title: id,
    authority: 'test',
    docType: 'subject_program',
    subject: 'history',
    grades: [7],
    role,
    version: 'v1',
    effectiveFrom: '2026-09-01',
    status: 'active',
    sha256: 'x',
    isDemo: true,
    uploadedAt: '2026-09-01',
    chunks: [{ id: `${id}#p1#c1`, sourceId: id, page: 1, text }],
  };
}

const retrieved = (s: Source): RetrievedChunk => ({
  chunk: s.chunks[0],
  sourceId: s.id,
  sourceTitle: s.title,
  sourceRole: s.role,
  version: s.version,
  score: 1,
});

const fact = src('fact', 'FACT', FACT_TEXT);
const method = src('method', 'METHOD', METHOD_TEXT);

beforeEach(() => {
  store.sources = [fact, method];
  store.rules = [];
});

describe('tokenOverlap', () => {
  it('is 1 for a verbatim quote and 0 for unrelated text', () => {
    expect(tokenOverlap('Մայրաքաղաքը Տիգրանակերտն էր', FACT_TEXT)).toBe(1);
    expect(tokenOverlap('Արտաշատը հիմնադրվել', FACT_TEXT)).toBe(0);
  });

  it('counts shared tokens with multiplicity', () => {
    expect(tokenOverlap('էր էր', 'էր')).toBe(0.5);
  });
});

describe('resolveQuoteToChunk', () => {
  const F = [retrieved(fact)];
  const M = [retrieved(method)];

  it('finds a verbatim quote without a chunk id', () => {
    const r = resolveQuoteToChunk('Մայրաքաղաքը Տիգրանակերտն էր', F, M);
    expect(r.match).toBe('verbatim');
    expect(r.chunk?.chunk.id).toBe('fact#p1#c1');
  });

  it('resolves a METHOD quote to the METHOD chunk (so method-as-fact is caught)', () => {
    const r = resolveQuoteToChunk('առնվազն երեք պատասխանի տարբերակ', F, M);
    expect(r.chunk?.sourceRole).toBe('METHOD');
  });

  it('uses token overlap >= 0.8 for a near quote', () => {
    // 5 of 6 tokens present (one word changed)
    const r = resolveQuoteToChunk('Տիգրան Մեծը թագավորել է մ.թ.ա. 95–55 տարիներին', F, M);
    expect(r.match).toBe('overlap');
    expect(r.chunk?.chunk.id).toBe('fact#p1#c1');
  });

  it('falls back to the best FACT chunk for an unlocatable quote', () => {
    const r = resolveQuoteToChunk('Արտաշատը հիմնադրվել է Արտաշես Առաջինի կողմից', F, M);
    expect(r.match).toBe('best_fact');
    expect(r.chunk?.sourceRole).toBe('FACT');
  });

  it('is unresolved when there are no FACT chunks at all', () => {
    expect(resolveQuoteToChunk('Արտաշատը', [], M).match).toBe('unresolved');
  });
});

// ---- runBaselineOnce with a scripted provider ----

const BASELINE_OUTPUT = `Տարբերակ A
1. Ո՞րն էր Տիգրան Մեծի մայրաքաղաքը։
ա) Տիգրանակերտ բ) Արտաշատ գ) Դվին
Պատասխան՝ Տիգրանակերտ
Մեջբերում՝ «Մայրաքաղաքը Տիգրանակերտն էր»

Տարբերակ B
1. Ո՞ր թվականներին է թագավորել Տիգրան Մեծը։
ա) մ.թ.ա. 95–55 բ) մ.թ.ա. 189–160 գ) մ.թ. 301–330
Պատասխան՝ մ.թ.ա. 95–55
Մեջբերում՝ «թագավորել է մ.թ.ա. 95–55 թվականներին»`;

const parsedItems = (quoteA = 'Մայրաքաղաքը Տիգրանակերտն էր') => ({
  items: [
    {
      id: 'A-1',
      variant: 'A',
      type: 'single_choice',
      stem: 'Ո՞րն էր Տիգրան Մեծի մայրաքաղաքը',
      options: ['Տիգրանակերտ', 'Արտաշատ', 'Դվին'],
      answerKey: 'Տիգրանակերտ',
      outcomeCodes: [],
      difficulty: 'medium',
      citations: [{ quote: quoteA }],
    },
    {
      id: 'B-1',
      variant: 'B',
      type: 'single_choice',
      stem: 'Ո՞ր թվականներին է թագավորել Տիգրան Մեծը',
      options: ['մ.թ.ա. 95–55', 'մ.թ.ա. 189–160', 'մ.թ. 301–330'],
      answerKey: 'մ.թ.ա. 95–55',
      outcomeCodes: [],
      difficulty: 'medium',
      citations: [{ quote: 'թագավորել է մ.թ.ա. 95–55 թվականներին' }],
    },
  ],
});

type Script = {
  text?: string | Error;
  refusal?: { refused: boolean; reason: string } | Error;
  parsed?: unknown | Error;
};

function scriptedProvider(script: Script): IModelProvider {
  const res = <T>(output: T) => ({ output, providerId: 'fake', modelId: 'fake-model', latencyMs: 0, requestId: 'r' });
  return {
    providerId: 'fake',
    generateText: vi.fn(async () => {
      if (script.text instanceof Error) throw script.text;
      return res(script.text ?? BASELINE_OUTPUT);
    }),
    generateStructured: vi.fn(async (_prompt: string, _schema: unknown, opts?: { actionName?: string }) => {
      const action = opts?.actionName ?? '';
      let out: unknown;
      if (action.startsWith('baselineRefusalCheck')) out = script.refusal ?? { refused: false, reason: 'questions produced' };
      else if (action.startsWith('parseBaselineRun')) out = script.parsed ?? parsedItems();
      else if (action === 'languageJudge') out = { hasIssues: false, severity: 'none', issues: [] };
      else throw new Error(`unexpected structured call ${action}`);
      if (out instanceof Error) throw out;
      return res(out);
    }),
  } as unknown as IModelProvider;
}

const judge: IJudgeProvider = {
  providerId: 'fake-judge',
  modelId: 'fake-judge-model',
  verifyClaim: vi.fn(async () => ({ verdict: 'supported', probability: 0.95, confidence: 0.95, reason: 'ok' })),
  classify: vi.fn(),
} as unknown as IJudgeProvider;

const ctx = (overrides: Partial<BaselineRunContext> = {}): BaselineRunContext => ({
  subject: 'history',
  grade: 7,
  prompt: 'p',
  factChunks: [retrieved(fact)],
  methodChunks: [retrieved(method)],
  isUncoveredTopicPreset: false,
  judge,
  judgeConfidenceThreshold: 0.8,
  ...overrides,
});

describe('runBaselineOnce', () => {
  it('a baseline with correct quotes and no chunk ids can PASS', async () => {
    const { metric, traces, items } = await runBaselineOnce(scriptedProvider({}), 1, ctx());
    expect(metric.error).toBeUndefined();
    expect(items.map((i) => i.citations[0].chunkId)).toEqual(['fact#p1#c1', 'fact#p1#c1']);
    expect(traces.map((t) => t.status)).toEqual(['PASS', 'PASS']);
    expect(metric.validatorViolationsCaught).toBe(0);
    expect(metric.machineReadableTrace).toBe(true);
    expect(metric.correctRefusal).toBe(true);
    expect(metric.citationResolution).toEqual({ verbatim: 2, overlap: 0, bestFact: 0, unresolved: 0 });
  });

  it('an unlocatable quote fails quote_verbatim but the claim is still judged', async () => {
    const out = BASELINE_OUTPUT.replace('Մայրաքաղաքը Տիգրանակերտն էր', 'Արքան կառուցեց նոր քաղաք');
    const { metric, traces } = await runBaselineOnce(
      scriptedProvider({ text: out, parsed: parsedItems('Արքան կառուցեց նոր քաղաք') }),
      1,
      ctx()
    );
    const a = traces[0];
    expect(a.checks.find((c) => c.checkId === 'quote_verbatim')?.result).toBe('fail');
    expect(a.checks.find((c) => c.checkId === 'claim_supported')?.result).toBe('pass');
    expect(metric.itemsWithoutVerifiableQuote).toBe(1);
    expect(metric.machineReadableTrace).toBe(false);
    expect(metric.citationResolution?.bestFact).toBe(1);
  });

  it('a quote the parser invented (not in the baseline output) is dropped, not credited', async () => {
    const { metric, traces } = await runBaselineOnce(
      scriptedProvider({ parsed: parsedItems('Տիգրան Մեծը թագավորել է') }),
      1,
      ctx()
    );
    expect(metric.parserDroppedQuotes).toBe(1);
    expect(traces[0].checks.find((c) => c.checkId === 'citation_exists')?.result).toBe('fail');
  });

  it('a baseline model error is ERROR, not a refusal', async () => {
    const { metric } = await runBaselineOnce(scriptedProvider({ text: new Error('quota exceeded') }), 1, ctx({ isUncoveredTopicPreset: true }));
    expect(metric.error).toContain('quota exceeded');
    expect(metric.refused).toBeUndefined();
    expect(metric.correctRefusal).toBe(false);
  });

  it('a failed refusal classification is ERROR', async () => {
    const { metric } = await runBaselineOnce(scriptedProvider({ refusal: new Error('boom') }), 1, ctx());
    expect(metric.error).toContain('refusal classification');
  });

  it('a failed parse is ERROR', async () => {
    const { metric } = await runBaselineOnce(scriptedProvider({ parsed: new Error('bad json') }), 1, ctx());
    expect(metric.error).toContain('baseline parsing');
  });

  it('refusal comes from the structured classifier, not keywords', async () => {
    // Output mentions "անբավարար" but produced questions: not a refusal
    const text = `${BASELINE_OUTPUT}\n\nԾանոթություն. որոշ ենթաթեմաների համար աղբյուրը անբավարար է։`;
    const { metric } = await runBaselineOnce(scriptedProvider({ text }), 1, ctx());
    expect(metric.refused).toBe(false);

    const refusedRun = await runBaselineOnce(
      scriptedProvider({ text: 'INSUFFICIENT SOURCE for topic', refusal: { refused: true, reason: 'insufficient' } }),
      1,
      ctx({ isUncoveredTopicPreset: true })
    );
    expect(refusedRun.metric.refused).toBe(true);
    expect(refusedRun.metric.correctRefusal).toBe(true);
    expect(refusedRun.metric.machineReadableTrace).toBeNull();
  });
});

describe('aggregation', () => {
  const run = (o: Partial<ScorecardMetric>): ScorecardMetric => ({
    runIndex: 1,
    unsupportedClaimsCount: 0,
    correctRefusal: true,
    methodUsedAsFactCount: 0,
    itemsWithoutVerifiableQuote: 0,
    variantEquivalencePassed: true,
    machineReadableTrace: true,
    internalViolationsCaught: 0,
    validatorViolationsCaught: 0,
    latencyMs: 1000,
    refused: false,
    ...o,
  });

  it('excludes ERROR runs from averages and counts them', () => {
    const agg = aggregateRuns([run({ unsupportedClaimsCount: 2 }), run({ error: 'x', unsupportedClaimsCount: 99 })]);
    expect(agg.validRuns).toBe(1);
    expect(agg.errorRuns).toBe(1);
    expect(agg.avgUnsupportedClaims).toBe(2);
  });

  it('returns null metrics when every run errored', () => {
    const agg = aggregateRuns([run({ error: 'x' })]);
    expect(agg.avgUnsupportedClaims).toBeNull();
    expect(agg.refusalCorrectnessRate).toBeNull();
    expect(agg.machineReadableTraceRate).toBeNull();
  });

  it('stability is the share agreeing with the majority, same formula for both engines', () => {
    expect(refusalStability([run({}), run({}), run({ refused: true })])).toBeCloseTo(2 / 3);
    expect(refusalStability([run({}), run({})])).toBe(1);
    expect(refusalStability([run({})])).toBeNull();
  });

  it('trace rate ignores runs with no items', () => {
    const agg = aggregateRuns([run({ machineReadableTrace: true }), run({ machineReadableTrace: false }), run({ machineReadableTrace: null })]);
    expect(agg.machineReadableTraceRate).toBe(0.5);
  });
});
