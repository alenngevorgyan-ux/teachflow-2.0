import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LessonPlan, Source, ThematicPlan } from '../shared/types.js';

const FACT_TEXT = 'Ֆոտոսինթեզը կատարվում է բույսի կանաչ մասերում՝ քլորոպլաստներում:';

const store = vi.hoisted(() => ({
  plan: null as ThematicPlan | null,
  sources: [] as Source[],
  saved: [] as LessonPlan[],
  coverageOutput: { topicCovered: true, coveredOutcomeCodes: [], missingAspects: [] } as any,
}));

vi.mock('../server/store/repository.js', () => ({
  repository: {
    getThematicPlan: (id: string) => (store.plan && store.plan.id === id ? store.plan : null),
    getSources: () => store.sources,
    saveLessonPlan: (lp: LessonPlan) => {
      store.saved.push(lp);
      return lp;
    },
    computePolicyVersion: () => 'test-policy',
    getConfirmedOutcomes: () => [],
    logAIInteraction: () => undefined,
  },
}));

vi.mock('../server/pipeline/coverage.js', () => ({
  checkCoverageGate: vi.fn(async () => store.coverageOutput),
}));

import { generateLessonPlanFromRow } from '../server/pipeline/lessonPlanGenerator.js';
import { checkCoverageGate } from '../server/pipeline/coverage.js';
import type { IJudgeProvider } from '../server/providers/judgeProvider.js';
import type { IModelProvider } from '../server/providers/modelProvider.js';

function source(): Source {
  return {
    id: 'src-fact',
    title: 'Test biology textbook',
    authority: 'test',
    docType: 'textbook',
    subject: 'history',
    grades: [5],
    role: 'FACT',
    version: 'v1',
    effectiveFrom: '2026-01-01',
    status: 'active',
    sha256: 'x',
    isDemo: true,
    uploadedAt: '2026-01-01',
    chunks: [{ id: 'src-fact#p1#c1', sourceId: 'src-fact', page: 1, text: FACT_TEXT }],
  };
}

function thematicPlan(): ThematicPlan {
  return {
    id: 'plan-1',
    title: 't',
    subject: 'history',
    grade: 5,
    programVersion: 'v',
    academicYear: '2026-2027',
    schoolId: 's',
    schoolName: 's',
    teacherName: 't',
    weeklyHours: 2,
    totalAnnualHours: 4,
    programTargetHours: 4,
    status: 'draft',
    calendar: { term1Weeks: 16, term2Weeks: 18, holidays: [] },
    validationErrors: [],
    createdAt: '',
    updatedAt: '',
    rows: [
      {
        id: 'row-1',
        topic: 'Ֆոտոսինթեզ',
        outcomeCodes: ['BIO-1'],
        plannedHours: 2,
        weekNumber: 1,
        plannedDates: '01.09-05.09',
        hasAssessment: false,
      },
    ],
  };
}

function providerReturning(output: {
  objectives: string[];
  requiredMaterials: string[];
  stages: any[];
  homework: string;
  citations: { chunkId: string; quote: string }[];
}): IModelProvider {
  return {
    providerId: 'fake',
    generateStructured: vi.fn(async () => ({
      output,
      providerId: 'fake',
      modelId: 'fake-model',
      latencyMs: 0,
      requestId: 'r',
    })) as unknown as IModelProvider['generateStructured'],
    generateText: vi.fn() as unknown as IModelProvider['generateText'],
  };
}

function judgeReturning(
  result: Awaited<ReturnType<IJudgeProvider['verifyClaim']>> | Error
): IJudgeProvider {
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

const validStages = [
  { title: 'Խ', durationMinutes: 7, teacherActivity: 'a', studentActivity: 'b', formativeCheck: 'c' },
  { title: 'Ի', durationMinutes: 20, teacherActivity: 'a', studentActivity: 'b', formativeCheck: 'c' },
  { title: 'Կ', durationMinutes: 12, teacherActivity: 'a', studentActivity: 'b', formativeCheck: 'c' },
  { title: 'Ա', durationMinutes: 6, teacherActivity: 'a', studentActivity: 'b', formativeCheck: 'c' },
];

beforeEach(() => {
  store.plan = thematicPlan();
  store.sources = [source()];
  store.saved = [];
  store.coverageOutput = { topicCovered: true, coveredOutcomeCodes: [], missingAspects: [] };
  vi.mocked(checkCoverageGate).mockClear();
});

describe('generateLessonPlanFromRow', () => {
  it('throws when the thematic plan does not exist', async () => {
    await expect(
      generateLessonPlanFromRow({ thematicPlanId: 'nope', rowId: 'row-1', provider: providerReturning({} as any) })
    ).rejects.toThrow(/not found/i);
  });

  it('throws when the row does not exist', async () => {
    await expect(
      generateLessonPlanFromRow({ thematicPlanId: 'plan-1', rowId: 'nope', provider: providerReturning({} as any) })
    ).rejects.toThrow(/Row not found/);
  });

  it('refuses (throws) when the coverage gate says the topic is not covered', async () => {
    store.coverageOutput = {
      topicCovered: false,
      coveredOutcomeCodes: [],
      missingAspects: [],
      refusalReasonArmenian: 'թեման ծածկված չէ',
    };
    const provider = providerReturning({
      objectives: ['x'],
      requiredMaterials: ['y'],
      stages: validStages,
      homework: 'hw',
      citations: [{ chunkId: 'src-fact#p1#c1', quote: FACT_TEXT }],
    });

    await expect(
      generateLessonPlanFromRow({ thematicPlanId: 'plan-1', rowId: 'row-1', provider, judgeProvider: judgeReturning({ verdict: 'supported', probability: 1, confidence: 1, reason: '' }) })
    ).rejects.toThrow(/ծածկված չէ/);
    expect(store.saved).toHaveLength(0);
  });

  it('produces a PASS lesson plan with a verbatim, judge-supported citation', async () => {
    const provider = providerReturning({
      objectives: ['Objective'],
      requiredMaterials: ['Material'],
      stages: validStages,
      homework: 'Homework text',
      citations: [{ chunkId: 'src-fact#p1#c1', quote: FACT_TEXT }],
    });
    const judge = judgeReturning({ verdict: 'supported', probability: 0.95, confidence: 0.95, reason: 'ok' });

    const plan = await generateLessonPlanFromRow({
      thematicPlanId: 'plan-1',
      rowId: 'row-1',
      provider,
      judgeProvider: judge,
    });

    expect(plan.trace.status).toBe('PASS');
    expect(plan.trace.factSources).toEqual([
      { sourceId: 'src-fact', version: 'v1', chunkId: 'src-fact#p1#c1', page: 1 },
    ]);
    expect(plan.factCitations[0].sourceTitle).toBe('Test biology textbook');
    expect(store.saved).toHaveLength(1);
  });

  it('fails deterministically when the citation is not verbatim in the chunk', async () => {
    const provider = providerReturning({
      objectives: ['x'],
      requiredMaterials: ['y'],
      stages: validStages,
      homework: 'hw',
      citations: [{ chunkId: 'src-fact#p1#c1', quote: 'Սա ամբողջովին սխալ մեջբերում է' }],
    });
    const judge = judgeReturning({ verdict: 'supported', probability: 1, confidence: 1, reason: '' });

    const plan = await generateLessonPlanFromRow({ thematicPlanId: 'plan-1', rowId: 'row-1', provider, judgeProvider: judge });

    expect(plan.trace.status).toBe('FAIL');
    expect(plan.trace.checks.some((c) => c.checkId === 'quote_verbatim' && c.result === 'fail')).toBe(true);
    // The judge should never even be consulted for a non-verbatim quote.
    expect(judge.verifyClaim).not.toHaveBeenCalled();
  });

  it('fails deterministically when the cited chunkId does not exist among the retrieved FACT chunks', async () => {
    const provider = providerReturning({
      objectives: ['x'],
      requiredMaterials: ['y'],
      stages: validStages,
      homework: 'hw',
      citations: [{ chunkId: 'nonexistent#p1#c1', quote: 'anything' }],
    });

    const plan = await generateLessonPlanFromRow({
      thematicPlanId: 'plan-1',
      rowId: 'row-1',
      provider,
      judgeProvider: judgeReturning({ verdict: 'supported', probability: 1, confidence: 1, reason: '' }),
    });

    expect(plan.trace.status).toBe('FAIL');
    expect(plan.trace.checks.some((c) => c.checkId === 'citation_exists' && c.result === 'fail')).toBe(true);
  });

  it('a judge error on a verbatim citation is a visible fail, not a silent pass', async () => {
    const provider = providerReturning({
      objectives: ['x'],
      requiredMaterials: ['y'],
      stages: validStages,
      homework: 'hw',
      citations: [{ chunkId: 'src-fact#p1#c1', quote: FACT_TEXT }],
    });
    const judge = judgeReturning(new Error('judge unavailable'));

    const plan = await generateLessonPlanFromRow({ thematicPlanId: 'plan-1', rowId: 'row-1', provider, judgeProvider: judge });

    expect(plan.trace.status).toBe('FAIL');
    const claimCheck = plan.trace.checks.find((c) => c.checkId === 'claim_supported');
    expect(claimCheck?.result).toBe('fail');
    expect(claimCheck?.detail).toContain('judge unavailable');
  });

  it('a "partially_supported" verdict warns rather than fails', async () => {
    const provider = providerReturning({
      objectives: ['x'],
      requiredMaterials: ['y'],
      stages: validStages,
      homework: 'hw',
      citations: [{ chunkId: 'src-fact#p1#c1', quote: FACT_TEXT }],
    });
    const judge = judgeReturning({ verdict: 'partially_supported', probability: 0.5, confidence: 0.6, reason: 'meh' });

    const plan = await generateLessonPlanFromRow({ thematicPlanId: 'plan-1', rowId: 'row-1', provider, judgeProvider: judge });

    expect(plan.trace.status).toBe('WARN');
  });
});
