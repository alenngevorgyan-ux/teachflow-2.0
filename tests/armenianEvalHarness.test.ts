import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArmenianEvalResult, ArmenianEvalTask } from '../shared/types.js';

const store = vi.hoisted(() => ({ saved: [] as ArmenianEvalResult[] }));

vi.mock('../server/store/repository.js', () => ({
  repository: {
    getArmenianEvalTasks: () => [],
    saveArmenianEvalResult: (r: ArmenianEvalResult) => {
      store.saved.push(r);
      return r;
    },
  },
}));

import {
  computeCategoryModelRecommendations,
  runArmenianEvaluation,
} from '../server/pipeline/armenianEvalHarness.js';
import type { IModelProvider } from '../server/providers/modelProvider.js';

function task(overrides: Partial<ArmenianEvalTask> = {}): ArmenianEvalTask {
  return {
    id: 't1',
    category: 'orthography',
    title: 'Test task',
    prompt: 'p',
    expectedBehavior: 'e',
    groundTruthKeywords: ['ֆոտոսինթեզ', 'քլորոպլաստ'],
    forbiddenOutputs: ['սխալ բառ'],
    ...overrides,
  };
}

function providerReturning(output: string): IModelProvider {
  return {
    providerId: 'fake',
    generateText: vi.fn(async () => ({
      output,
      providerId: 'fake',
      modelId: 'fake-model',
      latencyMs: 0,
      requestId: 'r',
    })) as unknown as IModelProvider['generateText'],
    generateStructured: vi.fn() as unknown as IModelProvider['generateStructured'],
  };
}

beforeEach(() => {
  store.saved = [];
});

describe('runArmenianEvaluation: scoring (T13)', () => {
  it('scores a wrong answer (no keywords matched, nothing forbidden) as exactly 0', async () => {
    const provider = providerReturning('ամբողջովին անկապ պատասխան');
    const result = await runArmenianEvaluation(provider, 'fake-model', [task()]);
    expect(result.taskResults[0].score).toBe(0);
    expect(result.taskResults[0].passed).toBe(false);
  });

  it('scores a forbidden form as exactly 0, even if it also happens to contain a keyword', async () => {
    const provider = providerReturning('ֆոտոսինթեզ, բայց սխալ բառ օգտագործված է');
    const result = await runArmenianEvaluation(provider, 'fake-model', [task()]);
    expect(result.taskResults[0].score).toBe(0);
    expect(result.taskResults[0].passed).toBe(false);
  });

  it('scores a fully correct answer as 100', async () => {
    const provider = providerReturning('Ֆոտոսինթեզը կատարվում է քլորոպլաստներում');
    const result = await runArmenianEvaluation(provider, 'fake-model', [task()]);
    expect(result.taskResults[0].score).toBe(100);
    expect(result.taskResults[0].passed).toBe(true);
  });

  it('gives real partial credit proportional to matched keywords', async () => {
    const provider = providerReturning('Միայն ֆոտոսինթեզի մասին, առանց մյուս հասկացության');
    const result = await runArmenianEvaluation(provider, 'fake-model', [task()]);
    expect(result.taskResults[0].score).toBe(50); // 1 of 2 keywords
    expect(result.taskResults[0].passed).toBe(true);
  });

  it('scores a provider error as 0, not silently omitted', async () => {
    const provider: IModelProvider = {
      providerId: 'fake',
      generateText: vi.fn(async () => {
        throw new Error('model unavailable');
      }) as unknown as IModelProvider['generateText'],
      generateStructured: vi.fn() as unknown as IModelProvider['generateStructured'],
    };
    const result = await runArmenianEvaluation(provider, 'fake-model', [task()]);
    expect(result.taskResults[0].score).toBe(0);
    expect(result.taskResults[0].modelOutput).toContain('model unavailable');
  });

  it('always records the raw model output verbatim, for every outcome', async () => {
    const provider = providerReturning('Սա հենց այն տեքստն է, որը մոդելը փաստացի պատասխանեց:');
    const result = await runArmenianEvaluation(provider, 'fake-model', [task()]);
    expect(result.taskResults[0].modelOutput).toBe('Սա հենց այն տեքստն է, որը մոդելը փաստացի պատասխանեց:');
  });
});

function evalResult(
  providerId: string,
  modelId: string,
  taskScores: { category: string; score: number }[]
): ArmenianEvalResult {
  return {
    runId: `r-${Math.random()}`,
    timestamp: '',
    providerId,
    modelId,
    categoryScores: {},
    overallScore: 0,
    taskResults: taskScores.map((t, i) => ({
      taskId: `t${i}`,
      category: t.category,
      passed: t.score > 0,
      score: t.score,
      modelOutput: 'x',
      notes: '',
    })),
  };
}

describe('computeCategoryModelRecommendations', () => {
  it('recommends the model with the highest average score per category', () => {
    const results = [
      evalResult('openrouter', 'model-a', [{ category: 'orthography', score: 60 }]),
      evalResult('openrouter', 'model-b', [{ category: 'orthography', score: 90 }]),
    ];
    const recs = computeCategoryModelRecommendations(results);
    const ortho = recs.find((r) => r.category === 'orthography');
    expect(ortho?.modelId).toBe('model-b');
    expect(ortho?.avgScore).toBe(90);
  });

  it('averages across multiple runs of the same model/category', () => {
    const results = [
      evalResult('openrouter', 'model-a', [{ category: 'grammar', score: 100 }]),
      evalResult('openrouter', 'model-a', [{ category: 'grammar', score: 50 }]),
    ];
    const recs = computeCategoryModelRecommendations(results);
    const grammar = recs.find((r) => r.category === 'grammar');
    expect(grammar?.avgScore).toBe(75);
    expect(grammar?.runCount).toBe(2);
  });

  it('never invents a recommendation for a category with no runs', () => {
    const results = [evalResult('openrouter', 'model-a', [{ category: 'grammar', score: 100 }])];
    const recs = computeCategoryModelRecommendations(results);
    expect(recs.find((r) => r.category === 'ocr_noise')).toBeUndefined();
  });

  it('keeps categories independent — the best model can differ per category', () => {
    const results = [
      evalResult('openrouter', 'model-a', [
        { category: 'orthography', score: 100 },
        { category: 'grammar', score: 20 },
      ]),
      evalResult('openrouter', 'model-b', [
        { category: 'orthography', score: 40 },
        { category: 'grammar', score: 95 },
      ]),
    ];
    const recs = computeCategoryModelRecommendations(results);
    expect(recs.find((r) => r.category === 'orthography')?.modelId).toBe('model-a');
    expect(recs.find((r) => r.category === 'grammar')?.modelId).toBe('model-b');
  });
});
