// Compares the pagination of two renderings (original vs corrected) of the
// same document, page by page, from the text of each rendered page. This is
// a text-level signal: it catches moved page breaks and a changed page
// count. It does not measure table widths, line spacing or images, so the
// rendered PDFs are always kept for a person to look at.

export interface LayoutComparison {
  pagesBefore: number;
  pagesAfter: number;
  /** 1-based pages whose first or last words differ. */
  shiftedPages: number[];
  verdict: 'same_pagination' | 'pagination_changed';
  notes: string[];
}

const ANCHOR = 40;

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * `replacements` are the accepted edits (before -> after). They are applied
 * to the original page text first, so an edit that sits at the start of a
 * page is not mistaken for a moved page break.
 */
export function comparePagination(before: string[], after: string[], replacements: { expected: string; replacement: string }[] = []): LayoutComparison {
  const edited = before.map((p) => replacements.reduce((t, r) => (r.expected ? t.split(r.expected).join(r.replacement) : t), p));
  const shifted: number[] = [];
  const n = Math.max(edited.length, after.length);
  for (let i = 0; i < n; i++) {
    const a = norm(edited[i] ?? '');
    const b = norm(after[i] ?? '');
    if (a.slice(0, ANCHOR) !== b.slice(0, ANCHOR) || a.slice(-ANCHOR) !== b.slice(-ANCHOR)) shifted.push(i + 1);
  }
  const notes: string[] = [];
  if (edited.length !== after.length) notes.push(`Page count changed: ${edited.length} -> ${after.length}.`);
  if (shifted.length) notes.push(`Page start or end moved on page(s) ${shifted.join(', ')}.`);
  notes.push('Text-level check only: table widths, spacing and images are not compared. Look at both PDFs.');
  return {
    pagesBefore: edited.length,
    pagesAfter: after.length,
    shiftedPages: shifted,
    verdict: shifted.length === 0 && edited.length === after.length ? 'same_pagination' : 'pagination_changed',
    notes,
  };
}
