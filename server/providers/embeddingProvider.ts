import { GoogleGenAI } from '@google/genai';
import { CallUsage, repository } from '../store/repository.js';

// Verified against the official Gemini API docs (ai.google.dev/gemini-api/docs/models/gemini-embedding-001):
// this is the current, stable embedding model — there is no newer successor as of this writing.
export const EMBEDDING_MODEL_ID = 'gemini-embedding-001';
// 768 is one of Google's recommended output dimensions (128-3072 range) and keeps
// per-chunk storage in our JSON file store reasonable.
const OUTPUT_DIMENSIONALITY = 768;

// The fixture environment makes no external calls at all: embeddings are
// disabled there (retrieval degrades visibly to keyword-only), even when a
// Gemini key happens to be present in the shell or .env.
function embeddingsDisabledByFixture(): boolean {
  return process.env.TEACHFLOW_FIXTURE_MODE === '1' || process.env.MODEL_PROVIDER?.trim() === 'fixture';
}

// Route to the same Google model: 'gemini' (default) calls the Gemini API
// directly with GEMINI_API_KEY; 'openrouter' calls OpenRouter's embeddings
// endpoint (google/gemini-embedding-001) with OPENROUTER_API_KEY. Chosen
// explicitly with EMBEDDING_PROVIDER, never by fallback. Both return
// OUTPUT_DIMENSIONALITY-sized vectors; any other size is rejected, so vectors
// from the two routes are never silently mixed.
export type EmbeddingRoute = 'gemini' | 'openrouter';
export const OPENROUTER_EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings';
const OPENROUTER_EMBEDDING_MODEL_ID = `google/${EMBEDDING_MODEL_ID}`;

export function embeddingRoute(): EmbeddingRoute {
  return process.env.EMBEDDING_PROVIDER?.trim() === 'openrouter' ? 'openrouter' : 'gemini';
}

/** What semantic retrieval uses right now: provider/model, or null when it is off (keyword-only). */
export function embeddingIdentity(): string | null {
  if (!isEmbeddingProviderConfigured()) return null;
  return embeddingRoute() === 'openrouter' ? `openrouter/${OPENROUTER_EMBEDDING_MODEL_ID}@${OUTPUT_DIMENSIONALITY}` : `gemini/${EMBEDDING_MODEL_ID}@${OUTPUT_DIMENSIONALITY}`;
}

export function isEmbeddingProviderConfigured(): boolean {
  if (embeddingsDisabledByFixture()) return false;
  return embeddingRoute() === 'openrouter' ? Boolean(process.env.OPENROUTER_API_KEY?.trim()) : Boolean(process.env.GEMINI_API_KEY?.trim());
}

async function embedViaOpenRouter(texts: string[]): Promise<{ vectors: number[][]; usage: CallUsage }> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error('Embedding Provider Error: EMBEDDING_PROVIDER=openrouter but OPENROUTER_API_KEY is not set.');
  const res = await fetch(OPENROUTER_EMBEDDINGS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'TeachFlow' },
    body: JSON.stringify({ model: OPENROUTER_EMBEDDING_MODEL_ID, input: texts, dimensions: OUTPUT_DIMENSIONALITY, encoding_format: 'float' }),
  });
  const body = (await res.json().catch(() => null)) as {
    data?: { embedding?: number[]; index?: number }[];
    usage?: { prompt_tokens?: number; cost?: number };
    error?: { message?: string };
  } | null;
  if (!res.ok || !body || body.error) throw new Error(`Embedding Provider Error: OpenRouter (${OPENROUTER_EMBEDDING_MODEL_ID}): ${body?.error?.message || `HTTP ${res.status}`}`);
  const data = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    vectors: data.map((d) => d.embedding ?? []),
    usage: { attempts: 1, promptTokens: num(body.usage?.prompt_tokens), completionTokens: 0, reasoningTokens: 0, costUsd: num(body.usage?.cost) },
  };
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
//
// Every attempt is written to the audit log here, success or failure, so no
// caller can bypass it and nothing is counted twice. The texts themselves are
// never logged (they can be source or teacher content); usage is not
// reported by the API and is recorded as unknown, not zero. Chunks that
// already carry an embedding make no call and produce no entry.
export async function embedTexts(texts: string[], purpose = 'embed'): Promise<number[][]> {
  if (texts.length === 0) return [];
  // No call is attempted, so there is nothing to audit.
  if (embeddingsDisabledByFixture()) throw new Error('Embedding Provider: disabled in FIXTURE mode (no external calls); keyword-only retrieval.');
  const start = Date.now();
  const route = embeddingRoute();
  // The Gemini embeddings API reports no usage: recorded as unknown, not zero.
  const input = `${texts.length} text(s), ${texts.reduce((n, t) => n + t.length, 0)} chars (text not logged)${route === 'gemini' ? '; usage: unknown' : ''}`;
  let usage: CallUsage | undefined;
  const audit = (action: string, output: string) =>
    repository.logAIInteraction({
      providerId: route,
      modelId: route === 'openrouter' ? OPENROUTER_EMBEDDING_MODEL_ID : EMBEDDING_MODEL_ID,
      action,
      prompt: input,
      output,
      latencyMs: Date.now() - start,
      ...(usage ? { usage } : {}),
    });

  let vectors: number[][];
  try {
    if (route === 'openrouter') {
      const r = await embedViaOpenRouter(texts);
      usage = r.usage;
      vectors = r.vectors;
    } else {
      const ai = getClient();
      const res = await ai.models.embedContent({
        model: EMBEDDING_MODEL_ID,
        contents: texts,
        config: { outputDimensionality: OUTPUT_DIMENSIONALITY },
      });
      vectors = (res.embeddings ?? []).map((e) => e.values ?? []);
    }
    if (vectors.length !== texts.length) {
      throw new Error(`Embedding Provider Error: expected ${texts.length} embeddings, got ${vectors.length}`);
    }
    vectors.forEach((v, i) => {
      if (v.length !== OUTPUT_DIMENSIONALITY) {
        throw new Error(`Embedding Provider Error: vector #${i} has ${v.length} dimensions, expected ${OUTPUT_DIMENSIONALITY}`);
      }
    });
  } catch (err: unknown) {
    audit(`embed:${purpose}:FAILED`, `Error: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
  audit(`embed:${purpose}`, `${vectors.length} vector(s) × ${vectors[0]?.length ?? 0} dims`);
  return vectors;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vec] = await embedTexts([text], 'query');
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
    const vectors = await embedTexts(pending.map((c) => c.text), 'chunks');
    pending.forEach((c, i) => {
      c.embedding = vectors[i];
    });
    return { embedded: pending.length };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Already audited once inside embedTexts.
    console.warn('embedChunksInPlace failed, chunks stored without embeddings:', msg);
    return {
      embedded: 0,
      warning: `Իմաստային որոնման վեկտորները (embeddings) չհաշվարկվեցին. ${msg} Աղբյուրը պահպանվել է, բայց որոնումը այս հատվածների համար կաշխատի միայն բանալի բառերով:`,
    };
  }
}
