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

import { OPENROUTER_EMBEDDINGS_URL, cosineSimilarity, embedChunksInPlace, embedQuery, embeddingIdentity, isEmbeddingProviderConfigured } from '../server/providers/embeddingProvider.js';

const vec = (seed: number) => Array.from({ length: 768 }, (_, i) => ((i + seed) % 7) / 7);

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
    embedMock.mockResolvedValue({ embeddings: [{ values: vec(1) }] });
    await embedQuery('Ավարայրի ճակատամարտ');
    expect(logSpy).toHaveBeenCalledTimes(1);
    const entry = logSpy.mock.calls[0][0];
    expect(entry).toMatchObject({ providerId: 'gemini', modelId: 'gemini-embedding-001', action: 'embed:query' });
    expect(entry.prompt).not.toContain('Ավարայր');
    expect(entry.prompt).toContain('usage: unknown');
    expect(entry.output).toContain('768 dims');
  });

  it('logs a failed query embedding once (retrieval then degrades to keywords)', async () => {
    embedMock.mockRejectedValue(new Error('quota exceeded'));
    await expect(embedQuery('x')).rejects.toThrow('quota');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0].action).toBe('embed:query:FAILED');
  });

  it('logs a chunk batch once on success and once on failure (not twice)', async () => {
    embedMock.mockResolvedValue({ embeddings: [{ values: vec(1) }, { values: vec(2) }] });
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

describe('fixture mode (pilot audit)', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    embedMock.mockReset();
  });

  it('never sends text to the embedding API in the fixture environment, even when a key is set', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.TEACHFLOW_FIXTURE_MODE = '1';
    process.env.TEACHFLOW_DATA_DIR = '/tmp/fixture-store';
    process.env.MODEL_PROVIDER = 'fixture';
    logSpy.mockReset();
    embedMock.mockResolvedValue({ embeddings: [{ values: [1, 2, 3] }] });
    await expect(embedQuery('synthetic text')).rejects.toThrow(/fixture/i);
    const chunks = [{ id: 'c1', text: 'synthetic text' }];
    const r = await embedChunksInPlace(chunks);
    expect(r.embedded).toBe(0);
    expect(r.warning).toMatch(/fixture/i);
    expect(embedMock).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalledWith(expect.objectContaining({ providerId: 'gemini' }));
    expect(isEmbeddingProviderConfigured()).toBe(false);
  });
});

describe('embedding route and dimensions (pilot audit)', () => {
  const saved = { ...process.env };
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    logSpy.mockReset();
    embedMock.mockReset();
    delete process.env.TEACHFLOW_FIXTURE_MODE;
    delete process.env.MODEL_PROVIDER;
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllGlobals();
  });

  it('a vector of another size is rejected, never mixed into retrieval', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    delete process.env.EMBEDDING_PROVIDER;
    embedMock.mockResolvedValue({ embeddings: [{ values: [0.1, 0.2, 0.3] }] });
    await expect(embedQuery('x')).rejects.toThrow(/3 dimensions, expected 768/);
    expect(logSpy.mock.calls[0][0].action).toBe('embed:query:FAILED');
  });

  it('EMBEDDING_PROVIDER=openrouter uses the same Google model through OpenRouter, with usage and cost audited', async () => {
    process.env.EMBEDDING_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'or-test-key';
    delete process.env.GEMINI_API_KEY;
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ data: [{ index: 1, embedding: vec(2) }, { index: 0, embedding: vec(1) }], usage: { prompt_tokens: 12, cost: 0.0000018 } }), { status: 200 }));
    expect(isEmbeddingProviderConfigured()).toBe(true);
    expect(embeddingIdentity()).toBe('openrouter/google/gemini-embedding-001@768');
    const chunks: { id: string; text: string; embedding?: number[] }[] = [{ id: 'a', text: 'Ավարայր' }, { id: 'b', text: '451' }];
    expect((await embedChunksInPlace(chunks)).embedded).toBe(2);
    expect(chunks[0].embedding).toEqual(vec(1)); // ordered by index
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(OPENROUTER_EMBEDDINGS_URL);
    expect(JSON.parse(init.body)).toMatchObject({ model: 'google/gemini-embedding-001', dimensions: 768 });
    expect(embedMock).not.toHaveBeenCalled();
    const entry = logSpy.mock.calls[0][0];
    expect(entry).toMatchObject({ providerId: 'openrouter', modelId: 'google/gemini-embedding-001', action: 'embed:chunks', usage: { promptTokens: 12, costUsd: 0.0000018 } });
    expect(entry.prompt).not.toContain('Ավարայր');
  });

  it('no silent fallback: the openrouter route without its key is not configured, even with a Gemini key', () => {
    process.env.EMBEDDING_PROVIDER = 'openrouter';
    delete process.env.OPENROUTER_API_KEY;
    process.env.GEMINI_API_KEY = 'test-key';
    expect(isEmbeddingProviderConfigured()).toBe(false);
    expect(embeddingIdentity()).toBeNull();
  });
});
