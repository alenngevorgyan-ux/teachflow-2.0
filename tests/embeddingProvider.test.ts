import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logSpy = vi.hoisted(() => vi.fn());

vi.mock('../server/store/repository.js', () => ({
  repository: { logAIInteraction: logSpy },
}));

import { cosineSimilarity, embedChunksInPlace, isEmbeddingProviderConfigured } from '../server/providers/embeddingProvider.js';

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it('is -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });

  it('is 0 when either vector is all zeros (no division by zero)', () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });
});

describe('isEmbeddingProviderConfigured', () => {
  const original = process.env.GEMINI_API_KEY;
  afterEach(() => {
    process.env.GEMINI_API_KEY = original;
  });

  it('is false when GEMINI_API_KEY is unset', () => {
    delete process.env.GEMINI_API_KEY;
    expect(isEmbeddingProviderConfigured()).toBe(false);
  });

  it('is true when GEMINI_API_KEY is set', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    expect(isEmbeddingProviderConfigured()).toBe(true);
  });
});

describe('embedChunksInPlace: no key configured', () => {
  const original = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    logSpy.mockClear();
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = original;
  });

  it('never throws, leaves chunks without embeddings, and returns a visible warning', async () => {
    const chunks = [{ id: 'c1', text: 'some text' }];
    const result = await embedChunksInPlace(chunks);

    expect(result.embedded).toBe(0);
    expect(result.warning).toBeTruthy();
    expect(chunks[0]).not.toHaveProperty('embedding');
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when every chunk already has an embedding', async () => {
    const chunks = [{ id: 'c1', text: 'x', embedding: [1, 2, 3] }];
    const result = await embedChunksInPlace(chunks);
    expect(result.embedded).toBe(0);
    expect(result.warning).toBeUndefined();
  });
});
