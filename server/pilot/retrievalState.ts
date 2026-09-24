import type { MaterialReview } from '../../shared/types.js';
import { embeddingIdentity } from '../providers/embeddingProvider.js';

// How the source passages behind the checks were actually found. Stated
// explicitly in the run output and the evidence: never a hidden fallback.
export type SemanticRetrievalState = 'GOOGLE_EMBEDDINGS' | 'KEYWORD_FALLBACK' | 'MIXED' | 'NOT_USED';

export function configuredRetrieval(): { state: 'GOOGLE_EMBEDDINGS' | 'KEYWORD_FALLBACK'; embedding: string | null } {
  const id = embeddingIdentity();
  return { state: id ? 'GOOGLE_EMBEDDINGS' : 'KEYWORD_FALLBACK', embedding: id };
}

/** From the current results: every check that retrieved passages records its mode. */
export function observedRetrieval(review: MaterialReview | null): {
  state: SemanticRetrievalState;
  checks: { semantic: number; keyword: number; mixed: number };
  embeddings: string[];
} {
  const counts = { semantic: 0, keyword: 0, mixed: 0 };
  const embeddings = new Set<string>();
  for (const r of review?.results ?? []) {
    if (r.stale) continue;
    for (const c of r.checks) {
      if (!c.retrieval) continue;
      counts[c.retrieval.mode]++;
      if (c.retrieval.embedding) embeddings.add(c.retrieval.embedding);
    }
  }
  const total = counts.semantic + counts.keyword + counts.mixed;
  const state: SemanticRetrievalState =
    total === 0 ? 'NOT_USED' : counts.semantic === total ? 'GOOGLE_EMBEDDINGS' : counts.keyword === total ? 'KEYWORD_FALLBACK' : 'MIXED';
  return { state, checks: counts, embeddings: [...embeddings].sort() };
}
