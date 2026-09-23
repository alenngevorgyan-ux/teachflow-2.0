import { SourceChunk } from '../../shared/types.js';
import { repository } from '../store/repository.js';
import { normalizeArmenianText } from './normalization.js';

export interface RetrievedChunk {
  chunk: SourceChunk;
  sourceId: string;
  sourceTitle: string;
  sourceRole: 'FACT' | 'METHOD' | 'TEMPLATE';
  version: string;
  score: number;
}

export function retrieveChunks(
  subject: string,
  grade: number,
  topic: string,
  selectedSourceIds?: string[]
): {
  factChunks: RetrievedChunk[];
  methodChunks: RetrievedChunk[];
} {
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

  const allFactChunks: RetrievedChunk[] = [];
  const allMethodChunks: RetrievedChunk[] = [];

  for (const source of eligibleSources) {
    for (const chunk of source.chunks) {
      const normalizedChunk = normalizeArmenianText(chunk.text);
      let score = 0;

      // Calculate term frequency & phrase match
      if (normalizedChunk.includes(normalizedTopic)) {
        score += 15;
      }
      for (const term of topicTerms) {
        if (normalizedChunk.includes(term)) {
          score += 3;
        }
      }

      // Base presence score so all chunks in eligible sources have baseline visibility
      score += 1;

      const item: RetrievedChunk = {
        chunk,
        sourceId: source.id,
        sourceTitle: source.title,
        sourceRole: source.role,
        version: source.version,
        score,
      };

      if (source.role === 'FACT') {
        allFactChunks.push(item);
      } else if (source.role === 'METHOD') {
        allMethodChunks.push(item);
      }
    }
  }

  // Sort descending by score
  allFactChunks.sort((a, b) => b.score - a.score);
  allMethodChunks.sort((a, b) => b.score - a.score);

  return {
    factChunks: allFactChunks,
    methodChunks: allMethodChunks,
  };
}
