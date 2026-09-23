import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Source } from '../shared/types.js';

const store = vi.hoisted(() => ({ sources: [] as Source[] }));

vi.mock('../server/store/repository.js', () => ({
  repository: { getSources: () => store.sources },
}));

import { parseWorkspaceIntent } from '../server/pipeline/workspaceIntent.js';
import type { IModelProvider } from '../server/providers/modelProvider.js';
import type { WorkspaceIntentOutput } from '../shared/schemas.js';

function source(overrides: Partial<Source> = {}): Source {
  return {
    id: 'src-1',
    title: 'Բնագիտություն 5-րդ դասարան դասագիրք',
    authority: 'test',
    docType: 'textbook',
    subject: 'Բնագիտություն',
    grades: [5],
    role: 'FACT',
    version: '2025-v1',
    effectiveFrom: '2026-01-01',
    status: 'active',
    sha256: 'x',
    isDemo: true,
    uploadedAt: '2026-01-01',
    chunks: [],
    ...overrides,
  };
}

function providerReturning(output: WorkspaceIntentOutput): IModelProvider {
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

beforeEach(() => {
  store.sources = [source()];
});

describe('parseWorkspaceIntent', () => {
  it('resolves to the pinned subject/grade when the model omits them', async () => {
    const provider = providerReturning({ intent: 'generate_thematic_plan' });
    const result = await parseWorkspaceIntent({
      message: 'Ստեղծիր թեմատիկ պլան',
      pinnedSubject: 'Բնագիտություն',
      pinnedGrade: 5,
      provider,
    });
    expect(result.resolvedSubject).toBe('Բնագիտություն');
    expect(result.resolvedGrade).toBe(5);
  });

  it('uses the model-named subject/grade when the teacher overrides them', async () => {
    const provider = providerReturning({
      intent: 'generate_thematic_plan',
      subject: 'Հայոց պատմություն',
      grade: 7,
    });
    const result = await parseWorkspaceIntent({
      message: 'Ստեղծիր 7-րդ դասարանի պատմության պլան',
      pinnedSubject: 'Բնագիտություն',
      pinnedGrade: 5,
      provider,
    });
    expect(result.resolvedSubject).toBe('Հայոց պատմություն');
    expect(result.resolvedGrade).toBe(7);
  });

  it('returns matching active FACT sources for confirmation', async () => {
    const provider = providerReturning({ intent: 'generate_thematic_plan' });
    const result = await parseWorkspaceIntent({
      message: 'x',
      pinnedSubject: 'Բնագիտություն',
      pinnedGrade: 5,
      provider,
    });
    expect(result.matchedSources).toHaveLength(1);
    expect(result.matchedSources[0].title).toContain('Բնագիտություն');
    expect(result.matchedSources[0].version).toBe('2025-v1');
  });

  it('excludes METHOD/TEMPLATE and inactive/other-grade sources from the confirmation list', async () => {
    store.sources = [
      source({ id: 'a', role: 'METHOD' }),
      source({ id: 'b', status: 'superseded' }),
      source({ id: 'c', grades: [7] }),
      source({ id: 'd', subject: 'Այլ առարկա' }),
      source({ id: 'e' }), // the only one that should match
    ];
    const provider = providerReturning({ intent: 'generate_thematic_plan' });
    const result = await parseWorkspaceIntent({
      message: 'x',
      pinnedSubject: 'Բնագիտություն',
      pinnedGrade: 5,
      provider,
    });
    expect(result.matchedSources.map((s) => s.id)).toEqual(['e']);
  });

  it('returns no matched sources when the registry has nothing for that subject/grade', async () => {
    store.sources = [];
    const provider = providerReturning({ intent: 'generate_thematic_plan' });
    const result = await parseWorkspaceIntent({
      message: 'x',
      pinnedSubject: 'Բնագիտություն',
      pinnedGrade: 5,
      provider,
    });
    expect(result.matchedSources).toEqual([]);
  });

  it('passes through an unclear intent with its clarifying question', async () => {
    const provider = providerReturning({
      intent: 'unclear',
      clarifyingQuestion: 'Ի՞նչ եք ցանկանում ստեղծել՝ թեմատիկ պլան, թե՞ դասի պլան:',
    });
    const result = await parseWorkspaceIntent({
      message: 'օգնիր ինձ',
      pinnedSubject: 'Բնագիտություն',
      pinnedGrade: 5,
      provider,
    });
    expect(result.intent).toBe('unclear');
    expect(result.clarifyingQuestion).toContain('Ի՞նչ');
  });

  it('passes through the topic for a lesson-plan intent', async () => {
    const provider = providerReturning({
      intent: 'generate_lesson_plan',
      topic: 'Լուսասինթեզ',
    });
    const result = await parseWorkspaceIntent({
      message: 'Դասի պլան Լուսասինթեզի մասին',
      pinnedSubject: 'Բնագիտություն',
      pinnedGrade: 5,
      provider,
    });
    expect(result.intent).toBe('generate_lesson_plan');
    expect(result.topic).toBe('Լուսասինթեզ');
  });
});
