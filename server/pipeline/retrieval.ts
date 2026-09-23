import { SourceChunk } from '../../shared/types.js';
import { repository } from '../store/repository.js';
import { normalizeArmenianText } from './normalization.js';
import { cosineSimilarity, embedQuery, isEmbeddingProviderConfigured } from '../providers/embeddingProvider.js';

export interface RetrievedChunk {
  chunk: SourceChunk;
  sourceId: string;
  sourceTitle: string;
  sourceRole: 'FACT' | 'METHOD' | 'TEMPLATE';
  version: string;
  score: number;
  semanticScore?: number;
}

export const TOP_K_FACT = 12;
export const TOP_K_METHOD = 4;

// Keyword score is unbounded (phrase match + per-term hits); this caps it into
// a 0..1 range so it can be combined with the 0..1 cosine similarity.
const KEYWORD_SCORE_NORMALIZATION_CAP = 20;
const SEMANTIC_WEIGHT = 0.65;
const KEYWORD_WEIGHT = 0.35;

function keywordScore(normalizedChunk: string, normalizedTopic: string, topicTerms: string[]): number {
  let score = 0;
  if (normalizedTopic && normalizedChunk.includes(normalizedTopic)) {
    score += 15;
  }
  for (const term of topicTerms) {
    if (normalizedChunk.includes(term)) {
      score += 3;
    }
  }
  score += 1; // baseline presence in an eligible source
  return score;
}

export async function retrieveChunks(
  subject: string,
  grade: number,
  topic: string,
  selectedSourceIds?: string[]
): Promise<{
  factChunks: RetrievedChunk[];
  methodChunks: RetrievedChunk[];
  usedSemanticSearch: boolean;
}> {
  const sources = repository.getSources();
  const eligibleSources = sources.filter((s) => {
    if (s.status !== 'active') return false;
    if (!s.grades.includes(grade)) return false;
    if (s.subject.toLowerCase() !== subject.toLowerCase()) return false;
    if (selectedSourceIds && selectedSourceIds.length > 0) {
      return selectedSourceIds.includes(s.id);
    }
    return true;
  });

  const normalizedTopic = normalizeArmenianText(topic);
  const topicTerms = normalizedTopic
    .split(' ')
    .filter((w) => w.length > 2)
    .map((w) => w.toLowerCase());

  // Only attempt semantic search if the provider is configured AND we can
  // actually embed the query — otherwise every chunk degrades to keyword-only,
  // visibly (via the returned usedSemanticSearch flag), never silently.
  let queryEmbedding: number[] | null = null;
  if (isEmbeddingProviderConfigured()) {
    try {
      queryEmbedding = await embedQuery(topic);
    } catch (err: unknown) {
      console.warn('retrieveChunks: query embedding failed, falling back to keyword-only:', err);
    }
  }

  const allFactChunks: RetrievedChunk[] = [];
  const allMethodChunks: RetrievedChunk[] = [];

  for (const source of eligibleSources) {
    for (const chunk of source.chunks) {
      const normalizedChunk = normalizeArmenianText(chunk.text);
      const rawKeywordScore = keywordScore(normalizedChunk, normalizedTopic, topicTerms);
      const normalizedKeywordScore = Math.min(1, rawKeywordScore / KEYWORD_SCORE_NORMALIZATION_CAP);

      let semanticScore: number | undefined;
      let score: number;
      if (queryEmbedding && chunk.embedding) {
        semanticScore = Math.max(0, cosineSimilarity(queryEmbedding, chunk.embedding));
        score = SEMANTIC_WEIGHT * semanticScore + KEYWORD_WEIGHT * normalizedKeywordScore;
      } else {
        score = normalizedKeywordScore;
      }

      const item: RetrievedChunk = {
        chunk,
        sourceId: source.id,
        sourceTitle: source.title,
        sourceRole: source.role,
        version: source.version,
        score,
        semanticScore,
      };

      if (source.role === 'FACT') {
        allFactChunks.push(item);
      } else if (source.role === 'METHOD') {
        allMethodChunks.push(item);
      }
    }
  }

  allFactChunks.sort((a, b) => b.score - a.score);
  allMethodChunks.sort((a, b) => b.score - a.score);

  return {
    factChunks: allFactChunks.slice(0, TOP_K_FACT),
    methodChunks: allMethodChunks.slice(0, TOP_K_METHOD),
    usedSemanticSearch: Boolean(queryEmbedding),
  };
}
