import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/store/repository.js', () => ({
  repository: { getConfirmedOutcomes: () => [] },
}));

import { checkCoverageGate, COVERAGE_SIMILARITY_THRESHOLD } from '../server/pipeline/coverage.js';
import type { RetrievedChunk } from '../server/pipeline/retrieval.js';
import type { IModelProvider } from '../server/providers/modelProvider.js';

function chunk(score: number, text = 'text'): RetrievedChunk {
  return {
    chunk: { id: 'c1', sourceId: 's1', page: 1, text },
    sourceId: 's1',
    sourceTitle: 'Source',
    sourceRole: 'FACT',
    version: 'v1',
    score,
  };
}

function providerSpy(): IModelProvider {
  return {
    providerId: 'fake',
    generateStructured: vi.fn(async () => ({
      output: { topicCovered: true, coveredOutcomeCodes: [], missingAspects: [] },
      providerId: 'fake',
      modelId: 'fake-model',
      latencyMs: 0,
      requestId: 'r',
    })) as unknown as IModelProvider['generateStructured'],
    generateText: vi.fn() as unknown as IModelProvider['generateText'],
  };
}

describe('checkCoverageGate: deterministic similarity threshold', () => {
  it('refuses without calling the model when every chunk scores below the threshold', async () => {
    const provider = providerSpy();
    const chunks = [chunk(0.01), chunk(0.02)];

    const result = await checkCoverageGate(provider, 'history', 7, 'unrelated topic', chunks);

    expect(result.topicCovered).toBe(false);
    expect(result.refusalReasonArmenian).toBeTruthy();
    expect(provider.generateStructured).not.toHaveBeenCalled();
  });

  it('calls the model when at least one chunk scores at or above the threshold', async () => {
    const provider = providerSpy();
    const chunks = [chunk(0.01), chunk(COVERAGE_SIMILARITY_THRESHOLD + 0.01)];

    await checkCoverageGate(provider, 'history', 7, 'related topic', chunks);

    expect(provider.generateStructured).toHaveBeenCalledTimes(1);
  });

  it('refuses deterministically (no model call) when there are no FACT chunks at all', async () => {
    const provider = providerSpy();

    const result = await checkCoverageGate(provider, 'history', 7, 'anything', []);

    expect(result.topicCovered).toBe(false);
    expect(provider.generateStructured).not.toHaveBeenCalled();
  });
});
