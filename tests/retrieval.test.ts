import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Source } from '../shared/types.js';

const store = vi.hoisted(() => ({
  sources: [] as Source[],
  embeddingConfigured: false,
  queryEmbedding: null as number[] | null,
}));

vi.mock('../server/store/repository.js', () => ({
  repository: { getSources: () => store.sources },
}));

vi.mock('../server/providers/embeddingProvider.js', async () => {
  const actual = await vi.importActual<typeof import('../server/providers/embeddingProvider.js')>(
    '../server/providers/embeddingProvider.js'
  );
  return {
    ...actual,
    isEmbeddingProviderConfigured: () => store.embeddingConfigured,
    embedQuery: async () => {
      if (!store.queryEmbedding) throw new Error('no query embedding configured for test');
      return store.queryEmbedding;
    },
  };
});

import { retrieveChunks, TOP_K_FACT, TOP_K_METHOD } from '../server/pipeline/retrieval.js';

function source(overrides: Partial<Source> = {}): Source {
  const id = overrides.id ?? 'src-1';
  return {
    id,
    title: 'Test source',
    authority: 'test',
    docType: 'textbook',
    subject: 'history',
    grades: [7],
    role: 'FACT',
    version: 'v1',
    effectiveFrom: '2026-01-01',
    status: 'active',
    sha256: 'x',
    isDemo: true,
    uploadedAt: '2026-01-01',
    chunks: [],
    ...overrides,
  };
}

beforeEach(() => {
  store.sources = [];
  store.embeddingConfigured = false;
  store.queryEmbedding = null;
});

describe('retrieveChunks: top-K limits', () => {
  it('caps FACT chunks to TOP_K_FACT and METHOD chunks to TOP_K_METHOD', async () => {
    const factChunks = Array.from({ length: 20 }, (_, i) => ({
      id: `src-fact#p1#c${i}`,
      sourceId: 'src-fact',
      page: 1,
      text: `Ընդհանուր տեքստ ${i}`,
    }));
    const methodChunks = Array.from({ length: 10 }, (_, i) => ({
      id: `src-method#p1#c${i}`,
      sourceId: 'src-method',
      page: 1,
      text: `Մեթոդական տեքստ ${i}`,
    }));
    store.sources = [
      source({ id: 'src-fact', role: 'FACT', chunks: factChunks }),
      source({ id: 'src-method', role: 'METHOD', chunks: methodChunks }),
    ];

    const { factChunks: retrievedFact, methodChunks: retrievedMethod } = await retrieveChunks(
      'history',
      7,
      'ընդհանուր'
    );

    expect(retrievedFact.length).toBe(TOP_K_FACT);
    expect(retrievedMethod.length).toBe(TOP_K_METHOD);
  });
});

describe('retrieveChunks: keyword-only fallback (no embedding provider configured)', () => {
  it('ranks a chunk matching both topic terms above one matching neither, and reports usedSemanticSearch=false', async () => {
    store.sources = [
      source({
        chunks: [
          { id: 'no-match', sourceId: 'src-1', page: 1, text: 'Անկապ տեքստ այլ բովանդակությամբ' },
          { id: 'full-match', sourceId: 'src-1', page: 1, text: 'Ֆոտոսինթեզը տեղի է ունենում բույսերում' },
        ],
      }),
    ];

    const { factChunks, usedSemanticSearch } = await retrieveChunks('history', 7, 'ֆոտոսինթեզ բույսեր');

    expect(usedSemanticSearch).toBe(false);
    expect(factChunks[0].chunk.id).toBe('full-match');
    expect(factChunks[0].score).toBeGreaterThan(factChunks[1].score);
  });
});

describe('retrieveChunks: hybrid semantic + keyword scoring', () => {
  it('uses semantic similarity when the provider is configured and chunks have embeddings', async () => {
    store.embeddingConfigured = true;
    store.queryEmbedding = [1, 0, 0];

    store.sources = [
      source({
        chunks: [
          // No keyword overlap at all, but embedding is identical to the query -> should still rank first.
          { id: 'semantic-match', sourceId: 'src-1', page: 1, text: 'unrelated words only', embedding: [1, 0, 0] },
          // No keyword overlap either, and no embedding -> only the baseline presence score.
          { id: 'no-match', sourceId: 'src-1', page: 1, text: 'բոլորովին այլ բովանդակություն' },
        ],
      }),
    ];

    const { factChunks, usedSemanticSearch } = await retrieveChunks('history', 7, 'ֆոտոսինթեզ');

    expect(usedSemanticSearch).toBe(true);
    expect(factChunks[0].chunk.id).toBe('semantic-match');
    expect(factChunks[0].semanticScore).toBeCloseTo(1, 5);
  });

  it('a chunk without an embedding still gets scored (keyword-only) even when the provider is configured', async () => {
    store.embeddingConfigured = true;
    store.queryEmbedding = [1, 0, 0];

    store.sources = [
      source({
        chunks: [{ id: 'no-embedding', sourceId: 'src-1', page: 1, text: 'ֆոտոսինթեզ' }],
      }),
    ];

    const { factChunks } = await retrieveChunks('history', 7, 'ֆոտոսինթեզ');
    expect(factChunks).toHaveLength(1);
    expect(factChunks[0].semanticScore).toBeUndefined();
    expect(factChunks[0].score).toBeGreaterThan(0);
  });
});
