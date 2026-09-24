import type { MaterialParagraph, MaterialReview, PatchGroup, TextSpan } from '../../shared/types.js';
import { DocxDocument, openDocx } from '../docx/docxModel.js';
import { DocxWorkingCopy } from '../docx/patch.js';
import { repository } from '../store/repository.js';

/**
 * The review's current revision: the original upload plus every accepted
 * group, in order. Rebuilt from the stored bytes each time; a group that no
 * longer applies means the stored state is inconsistent, which is an error,
 * not something to skip.
 */
export async function loadWorkingCopy(review: MaterialReview): Promise<DocxWorkingCopy> {
  return (await workingCopyFactory(review))();
}

/** Parses the stored file once; each call returns a fresh copy at the current revision. */
export async function workingCopyFactory(review: MaterialReview): Promise<() => DocxWorkingCopy> {
  const bytes = repository.getMaterialFile(review.fileSha256);
  if (!bytes) throw new Error(`Original file for material ${review.id} is missing from storage`);
  const doc = await openDocx(bytes);
  const groups = [...review.acceptedGroups];
  const revision = review.revision;
  return () => rebuild(doc, groups, revision);
}

function rebuild(doc: DocxDocument, groups: PatchGroup[], revision: string): DocxWorkingCopy {
  const w = new DocxWorkingCopy(doc);
  for (const g of groups) {
    const r = w.applyGroup(g);
    if (!r.ok) {
      throw new Error(`Stored accepted group ${g.id} no longer applies: ${r.errors.map((e) => e.code).join(', ')}`);
    }
  }
  if (w.revision !== revision) {
    throw new Error(`Stored revision ${revision} does not match rebuilt revision ${w.revision}`);
  }
  return w;
}

export function currentParagraphs(w: DocxWorkingCopy): MaterialParagraph[] {
  return w.doc.paragraphs.map((p) => ({
    id: p.id,
    index: p.index,
    text: w.paragraphText(p.id) ?? '',
    label: p.numbering?.label,
    location: p.location,
    table: p.table,
    editable: p.editable,
    lockReasons: p.lockReasons,
  }));
}

/**
 * Where a span of the text before `group` sits in the text after it.
 * Positions before a patch stay; positions after it shift by the length
 * change; a span that overlaps a patch grows to cover the replacement.
 * Returns `touched: true` when the span's own text changed.
 */
export function mapSpan(span: TextSpan, group: PatchGroup): { span: TextSpan; touched: boolean } {
  const patches = group.patches.filter((p) => p.paragraphId === span.paragraphId).sort((a, b) => b.start - a.start);
  let { start, end } = span;
  let touched = false;
  for (const p of patches) {
    const delta = p.replacement.length - (p.end - p.start);
    const overlaps = p.start < end && p.end > start;
    const insertInside = p.start === p.end && p.start > start && p.start < end;
    if (overlaps || insertInside) {
      touched = true;
      start = Math.min(start, p.start);
      end = Math.max(end, p.end) + delta;
    } else if (p.start >= end) {
      // after the span: no effect
    } else {
      // entirely before the span
      start += delta;
      end += delta;
    }
  }
  return { span: { paragraphId: span.paragraphId, start, end }, touched };
}
