import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssessmentItem, MethodRule, Source } from '../shared/types.js';

const store = vi.hoisted(() => ({
  sources: [] as Source[],
  rules: [] as MethodRule[],
}));

vi.mock('../server/store/repository.js', () => ({
  repository: {
    getSources: () => store.sources,
    getActiveRules: () => store.rules.filter((r) => r.active),
    computePolicyVersion: () => 'test-policy',
    logAIInteraction: () => undefined,
  },
}));

import { validateSingleItem } from '../server/pipeline/validator.js';
import type { IJudgeProvider } from '../server/providers/judgeProvider.js';
import type { IModelProvider } from '../server/providers/modelProvider.js';

const FACT_TEXT = 'Տիգրան Մեծը թագավորել է մ.թ.ա. 95–55 թվականներին։ Մայրաքաղաքը Տիգրանակերտն էր։';

function source(overrides: Partial<Source> = {}): Source {
  const id = overrides.id ?? 'src-fact';
  return {
    id,
    title: 'Test program',
    authority: 'test',
    docType: 'subject_program',
    subject: 'history',
    grades: [7],
    role: 'FACT',
    version: 'v1',
    effectiveFrom: '2026-09-01',
    status: 'active',
    sha256: 'x',
    isDemo: true,
    uploadedAt: '2026-09-01',
    chunks: [{ id: `${id}#p1#c1`, sourceId: id, page: 1, text: FACT_TEXT }],
    ...overrides,
  };
}

function item(overrides: Partial<AssessmentItem> = {}): AssessmentItem {
  return {
    id: 'it-1',
    variant: 'A',
    type: 'single_choice',
    stem: 'Ո՞ր թվականներին է թագավորել Տիգրան Մեծը',
    options: ['մ.թ.ա. 95–55', 'մ.թ.ա. 189–160', 'մ.թ. 301–330'],
    answerKey: 'մ.թ.ա. 95–55',
    outcomeCodes: [],
    difficulty: 'basic',
    citations: [{ chunkId: 'src-fact#p1#c1', quote: 'թագավորել է մ.թ.ա. 95–55 թվականներին' }],
    ...overrides,
  };
}

function judge(result: Awaited<ReturnType<IJudgeProvider['verifyClaim']>> | Error): IJudgeProvider {
  return {
    providerId: 'fake-judge',
    modelId: 'fake-judge-model',
    verifyClaim: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
    classify: vi.fn(),
  } as unknown as IJudgeProvider;
}

const supported = judge({ verdict: 'supported', probability: 0.95, confidence: 0.95, reason: 'ok' });

const provider: IModelProvider = {
  providerId: 'fake',
  generateStructured: vi.fn(async () => ({
    output: { hasIssues: false, issues: [] },
    providerId: 'fake',
    modelId: 'fake-model',
    latencyMs: 0,
    requestId: 'r',
  })) as unknown as IModelProvider['generateStructured'],
  generateText: vi.fn() as unknown as IModelProvider['generateText'],
};

async function run(it: AssessmentItem, j: IJudgeProvider = supported, grade = 7) {
  const { trace, status } = await validateSingleItem(it, 'history', grade, provider, { judgeProvider: j });
  const byId = (id: string) => trace.checks.filter((c) => c.checkId === id).map((c) => c.result);
  return { trace, status, byId };
}

beforeEach(() => {
  store.sources = [source()];
  store.rules = [];
});

describe('validator deterministic checks', () => {
  it('passes a correct, verbatim-cited item', async () => {
    const r = await run(item());
    expect(r.byId('citation_exists')).toEqual(['pass']);
    expect(r.byId('citation_is_fact_source')).toEqual(['pass']);
    expect(r.byId('quote_verbatim')).toEqual(['pass']);
    expect(r.byId('answer_key_valid')).toEqual(['pass']);
    expect(r.byId('claim_supported')).toEqual(['pass']);
    expect(r.status).toBe('PASS');
    expect(r.trace.factSources).toEqual([
      { sourceId: 'src-fact', version: 'v1', chunkId: 'src-fact#p1#c1', page: 1 },
    ]);
  });

  it('fails an item without citations', async () => {
    const r = await run(item({ citations: [] }));
    expect(r.byId('citation_exists')).toEqual(['fail']);
    expect(r.status).toBe('FAIL');
  });

  it('fails a citation to a chunk that does not exist', async () => {
    const r = await run(item({ citations: [{ chunkId: 'nope#p1#c1', quote: 'x' }] }));
    expect(r.byId('citation_exists')).toContain('fail');
    expect(r.status).toBe('FAIL');
  });

  it('fails a citation to a METHOD source', async () => {
    store.sources = [source({ id: 'src-method', role: 'METHOD' })];
    const r = await run(item({ citations: [{ chunkId: 'src-method#p1#c1', quote: 'թագավորել է' }] }));
    expect(r.byId('citation_is_fact_source')).toEqual(['fail']);
    expect(r.status).toBe('FAIL');
  });

  it('fails a citation to an inactive FACT source', async () => {
    store.sources = [source({ status: 'superseded' })];
    const r = await run(item());
    expect(r.byId('citation_is_fact_source')).toEqual(['fail']);
    expect(r.status).toBe('FAIL');
  });

  it('fails a citation to a FACT source of another grade', async () => {
    const r = await run(item(), supported, 8);
    expect(r.byId('citation_is_fact_source')).toEqual(['fail']);
    expect(r.status).toBe('FAIL');
  });

  it('fails a paraphrased quote', async () => {
    const r = await run(
      item({ citations: [{ chunkId: 'src-fact#p1#c1', quote: 'Տիգրան Մեծը կառավարել է 95–55 թվականներին' }] })
    );
    expect(r.byId('quote_verbatim')).toEqual(['fail']);
    expect(r.status).toBe('FAIL');
  });

  it('fails an empty answer key', async () => {
    const r = await run(item({ answerKey: '  ' }));
    expect(r.byId('answer_key_valid')).toEqual(['fail']);
  });

  it('fails an answer key that matches no option', async () => {
    const r = await run(item({ answerKey: 'մ.թ.ա. 90–50' }));
    expect(r.byId('answer_key_valid')).toEqual(['fail']);
    expect(r.status).toBe('FAIL');
  });

  it('fails duplicate options', async () => {
    const r = await run(item({ options: ['մ.թ.ա. 95–55', 'Մ.թ.ա. 95–55 ', 'մ.թ. 301–330'] }));
    expect(r.byId('answer_key_valid')).toContain('fail');
  });

  it('fails single choice with fewer than two options', async () => {
    const r = await run(item({ options: ['մ.թ.ա. 95–55'] }));
    expect(r.byId('answer_key_valid')).toEqual(['fail']);
  });
});

describe('validator method rules', () => {
  const minOptions = (severity: MethodRule['severity']): MethodRule => ({
    id: 'rule-min-options',
    title: 'Min options',
    description: '',
    kind: 'deterministic',
    params: { min_options: 4 },
    severity,
    active: true,
  });

  it('rule-min-options with error severity fails the item', async () => {
    store.rules = [minOptions('error')];
    const r = await run(item());
    expect(r.byId('rule-min-options')).toEqual(['fail']);
    expect(r.status).toBe('FAIL');
  });

  it('rule-min-options with warning severity warns', async () => {
    store.rules = [minOptions('warning')];
    const r = await run(item());
    expect(r.byId('rule-min-options')).toEqual(['warn']);
    expect(r.status).toBe('WARN');
  });

  it('inactive rules are not applied', async () => {
    store.rules = [{ ...minOptions('error'), active: false }];
    const r = await run(item());
    expect(r.byId('rule-min-options')).toEqual([]);
    expect(r.status).toBe('PASS');
  });

  it('rule-allowed-item-types rejects a disallowed type', async () => {
    store.rules = [
      {
        id: 'rule-allowed-item-types',
        title: 'Allowed types',
        description: '',
        kind: 'deterministic',
        params: { allowed_types: ['short_answer'] },
        severity: 'error',
        active: true,
      },
    ];
    const r = await run(item());
    expect(r.byId('rule-allowed-item-types')).toEqual(['fail']);
  });
});

describe('validator judge handling', () => {
  it('judge "not_supported" fails the item', async () => {
    const r = await run(item(), judge({ verdict: 'not_supported', probability: 0.9, confidence: 0.9, reason: 'no' }));
    expect(r.byId('claim_supported')).toEqual(['fail']);
    expect(r.status).toBe('FAIL');
  });

  it('low judge confidence sends the item to review (WARN)', async () => {
    const r = await run(item(), judge({ verdict: 'supported', probability: 0.5, confidence: 0.5, reason: 'meh' }));
    expect(r.byId('judge_confidence_threshold')).toEqual(['warn']);
    expect(r.status).toBe('WARN');
    expect(r.trace.confidence).toBe(0.5);
  });

  it('a judge error is a visible failed check, not a pass', async () => {
    const r = await run(item(), judge(new Error('no key')));
    const check = r.trace.checks.find((c) => c.checkId === 'claim_supported');
    expect(check?.result).toBe('fail');
    expect(check?.detail).toContain('no key');
    expect(r.trace.confidence).toBeUndefined();
  });
});
