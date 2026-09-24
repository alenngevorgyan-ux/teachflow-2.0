import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logSpy = vi.hoisted(() => vi.fn());
const embedMock = vi.hoisted(() => vi.fn());

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { embedContent: embedMock };
  },
}));

vi.mock('../server/store/repository.js', () => ({
  repository: { logAIInteraction: logSpy },
}));

import { cosineSimilarity, embedChunksInPlace, embedQuery, isEmbeddingProviderConfigured } from '../server/providers/embeddingProvider.js';

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

describe('embedding audit: every real call once, no text, no double counting', () => {
  const original = process.env.GEMINI_API_KEY;
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    logSpy.mockClear();
    embedMock.mockReset();
  });
  afterEach(() => {
    process.env.GEMINI_API_KEY = original;
  });

  it('logs a successful query embedding with model and size, without the text', async () => {
    embedMock.mockResolvedValue({ embeddings: [{ values: [0.1, 0.2, 0.3] }] });
    await embedQuery('Ավարայրի ճակատամարտ');
    expect(logSpy).toHaveBeenCalledTimes(1);
    const entry = logSpy.mock.calls[0][0];
    expect(entry).toMatchObject({ providerId: 'gemini', modelId: 'gemini-embedding-001', action: 'embed:query' });
    expect(entry.prompt).not.toContain('Ավարայր');
    expect(entry.prompt).toContain('usage: unknown');
    expect(entry.output).toContain('3 dims');
  });

  it('logs a failed query embedding once (retrieval then degrades to keywords)', async () => {
    embedMock.mockRejectedValue(new Error('quota exceeded'));
    await expect(embedQuery('x')).rejects.toThrow('quota');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0].action).toBe('embed:query:FAILED');
  });

  it('logs a chunk batch once on success and once on failure (not twice)', async () => {
    embedMock.mockResolvedValue({ embeddings: [{ values: [1] }, { values: [2] }] });
    await embedChunksInPlace([{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }]);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0].action).toBe('embed:chunks');
    logSpy.mockClear();
    embedMock.mockRejectedValue(new Error('down'));
    const r = await embedChunksInPlace([{ id: 'c', text: 'c' }]);
    expect(r.warning).toBeTruthy();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0].action).toBe('embed:chunks:FAILED');
  });

  it('cached chunks (already embedded) make no call and no entry', async () => {
    await embedChunksInPlace([{ id: 'a', text: 'a', embedding: [1] }]);
    expect(embedMock).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });
});
