import type { MaterialAnswerKeyEntry, MaterialItem, MaterialReview, TextSpan } from '../../shared/types.js';
import { mapSpan } from './workingCopy.js';

// Spans in a segmentation are stored in the text of the revision where the
// split was made (segmentation.atGroupCount accepted groups). They are never
// edited in place: reading maps them forward through the groups accepted
// since. Undoing a group therefore gives back exactly the earlier spans.

export interface ResolvedStructure {
  items: MaterialItem[];
  answerKey: MaterialAnswerKeyEntry[];
}

function mapThrough(span: TextSpan, review: MaterialReview, from: number): TextSpan {
  let s = span;
  for (const g of review.acceptedGroups.slice(from)) s = mapSpan(s, g).span;
  return s;
}

export function resolveStructure(review: MaterialReview): ResolvedStructure {
  const seg = review.segmentation;
  if (!seg) return { items: [], answerKey: review.answerKey };
  const from = seg.atGroupCount ?? review.acceptedGroups.length;
  const items = seg.items.map((it) => ({
    ...it,
    stemSpans: it.stemSpans?.map((sp) => mapThrough(sp, review, from)),
    options: it.options.map((o) => ({ ...o, ...mapThrough(o, review, from) })),
  }));
  const answerKey = review.answerKey.map((k) => (k.span ? { ...k, span: mapThrough(k.span, review, from) } : k));
  return { items, answerKey };
}

/** Rebases spans that are valid at the current revision into segmentation coordinates at the current group count. */
export function rebaseToCurrent(review: MaterialReview): void {
  if (!review.segmentation) return;
  const { items, answerKey } = resolveStructure(review);
  review.segmentation.items = items;
  review.answerKey = answerKey;
  review.segmentation.atGroupCount = review.acceptedGroups.length;
}
