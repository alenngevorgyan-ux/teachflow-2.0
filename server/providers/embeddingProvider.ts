import { GoogleGenAI } from '@google/genai';
import { repository } from '../store/repository.js';

// Verified against the official Gemini API docs (ai.google.dev/gemini-api/docs/models/gemini-embedding-001):
// this is the current, stable embedding model — there is no newer successor as of this writing.
export const EMBEDDING_MODEL_ID = 'gemini-embedding-001';
// 768 is one of Google's recommended output dimensions (128-3072 range) and keeps
// per-chunk storage in our JSON file store reasonable.
const OUTPUT_DIMENSIONALITY = 768;

export function isEmbeddingProviderConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'Embedding Provider Error: GEMINI_API_KEY is not set. Gemini embeddings require a direct Gemini API key (OpenRouter has no embeddings endpoint).'
    );
  }
  return new GoogleGenAI({ apiKey });
}

// Embeds a batch of texts in one call. Throws on failure — callers decide
// whether a missing/failed embedding should block their operation or degrade
// visibly to keyword-only scoring; this function never silently returns
// fabricated vectors.
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const ai = getClient();

  const res = await ai.models.embedContent({
    model: EMBEDDING_MODEL_ID,
    contents: texts,
    config: { outputDimensionality: OUTPUT_DIMENSIONALITY },
  });

  const embeddings = res.embeddings;
  if (!embeddings || embeddings.length !== texts.length) {
    throw new Error(
      `Embedding Provider Error: expected ${texts.length} embeddings, got ${embeddings?.length ?? 0}`
    );
  }

  return embeddings.map((e, i) => {
    if (!e.values || e.values.length === 0) {
      throw new Error(`Embedding Provider Error: empty embedding vector for input #${i}`);
    }
    return e.values;
  });
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vec] = await embedTexts([text]);
  return vec;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Computes and attaches embeddings to chunks that don't already have one.
// Never throws: a failure (no key, API error) is logged and surfaced to the
// caller via the returned warning, but chunks are still saved — they just
// keep degrading to keyword-only retrieval, same as before this feature
// existed. This is an explicit, visible degradation, not a silent one.
export async function embedChunksInPlace(
  chunks: { id: string; text: string; embedding?: number[] }[]
): Promise<{ embedded: number; warning?: string }> {
  const pending = chunks.filter((c) => !c.embedding);
  if (pending.length === 0) return { embedded: 0 };

  try {
    const vectors = await embedTexts(pending.map((c) => c.text));
    pending.forEach((c, i) => {
      c.embedding = vectors[i];
    });
    return { embedded: pending.length };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('embedChunksInPlace failed, chunks stored without embeddings:', msg);
    repository.logAIInteraction({
      providerId: 'gemini',
      modelId: EMBEDDING_MODEL_ID,
      action: 'embedChunksInPlace:FAILED',
      prompt: `${pending.length} chunk(s)`,
      output: `Error: ${msg}`,
      latencyMs: 0,
    });
    return {
      embedded: 0,
      warning: `Իմաստային որոնման վեկտորները (embeddings) չհաշվարկվեցին. ${msg} Աղբյուրը պահպանվել է, բայց որոնումը այս հատվածների համար կաշխատի միայն բանալի բառերով:`,
    };
  }
}
