import type { PatchGroup, TextPatch } from '../../shared/types.js';
import { checkPrivacy } from '../pipeline/privacyGuard.js';
import { DocxDocument, DocxParagraph, openDocx, sha256, textHash, writeDocx } from './docxModel.js';
import { escapeText, hasInvalidXmlChars } from './xml.js';

export type { PatchGroup, TextPatch };

// Text patches on a DOCX, applied without rebuilding the document.
//
// Offsets: UTF-16 code units in the paragraph's visible text
// (DocxParagraph.text: w:t text, \t for tabs, \n for breaks, U+FFFC for
// objects) as it was at the patch's base revision.
//
// Versions: a revision is the original file (sha256) plus the ordered list of
// applied groups. Each patch records the revision it was made against and the
// hash of its paragraph's text at that revision. A patch is stale when its
// paragraph's current text no longer has that hash — i.e. something changed
// that paragraph since. Patches on other, untouched paragraphs stay valid
// after an unrelated group is applied.
//
// Groups: all patches of a group are validated against the current revision
// before any is applied; if one fails, none is applied. Patches within a group
// may not overlap. A patch only rewrites the text of existing w:t elements:
// run properties, paragraph properties, numbering and tables are untouched,
// and tabs, breaks and objects can never be deleted or crossed.

export type PatchErrorCode =
  | 'empty_group'
  | 'duplicate_patch_id'
  | 'unknown_paragraph'
  | 'paragraph_locked'
  | 'stale'
  | 'expected_mismatch'
  | 'out_of_range'
  | 'splits_character'
  | 'touches_non_text'
  | 'no_text_run'
  | 'unsupported_replacement'
  | 'overlap'
  | 'noop'
  | 'privacy';

export interface PatchError {
  patchId: string;
  code: PatchErrorCode;
  detail: string;
}

export type ApplyResult = { ok: true; revision: string } | { ok: false; errors: PatchError[] };

interface ParagraphState {
  para: DocxParagraph;
  /** Current text of each segment (only 't' segments ever change). */
  texts: string[];
}

function isLowSurrogate(s: string, i: number): boolean {
  const c = s.charCodeAt(i);
  return c >= 0xdc00 && c <= 0xdfff;
}

export class DocxWorkingCopy {
  private readonly states = new Map<string, ParagraphState>();
  private readonly applied: PatchGroup[] = [];
  private _revision: string;

  constructor(readonly doc: DocxDocument) {
    for (const p of doc.paragraphs) this.states.set(p.id, { para: p, texts: p.segments.map((s) => s.text) });
    this._revision = `r0-${doc.sha256.slice(0, 12)}`;
  }

  get revision(): string {
    return this._revision;
  }

  get appliedGroups(): readonly PatchGroup[] {
    return this.applied;
  }

  paragraphText(paragraphId: string): string | undefined {
    const s = this.states.get(paragraphId);
    return s ? s.texts.join('') : undefined;
  }

  /** Builds a patch against the current revision. Validation happens on apply. */
  makePatch(id: string, paragraphId: string, start: number, end: number, replacement: string): TextPatch {
    const text = this.paragraphText(paragraphId) ?? '';
    return {
      id,
      paragraphId,
      start,
      end,
      expected: text.slice(start, end),
      replacement,
      baseRevision: this._revision,
      baseTextHash: textHash(text),
    };
  }

  /** Why a single patch cannot be applied now, or null if it can. */
  checkPatch(patch: TextPatch): PatchError | null {
    const err = (code: PatchErrorCode, detail: string): PatchError => ({ patchId: patch.id, code, detail });
    const st = this.states.get(patch.paragraphId);
    if (!st) return err('unknown_paragraph', `No paragraph ${patch.paragraphId}`);
    if (!st.para.editable) return err('paragraph_locked', `Paragraph cannot be edited: ${st.para.lockReasons.join(', ')}`);
    const text = st.texts.join('');
    if (textHash(text) !== patch.baseTextHash) {
      return err('stale', `Paragraph changed since revision ${patch.baseRevision}`);
    }
    if (!Number.isInteger(patch.start) || !Number.isInteger(patch.end) || patch.start < 0 || patch.end < patch.start || patch.end > text.length) {
      return err('out_of_range', `Range [${patch.start}, ${patch.end}) outside paragraph of length ${text.length}`);
    }
    if (isLowSurrogate(text, patch.start) || (patch.end < text.length && isLowSurrogate(text, patch.end))) {
      return err('splits_character', 'Range boundary splits a character');
    }
    if (text.slice(patch.start, patch.end) !== patch.expected) {
      return err('expected_mismatch', `Expected «${patch.expected}» at [${patch.start}, ${patch.end})`);
    }
    if (patch.replacement === patch.expected) return err('noop', 'Replacement equals the current text');
    if (/[\t\n\r￼]/.test(patch.replacement) || hasInvalidXmlChars(patch.replacement)) {
      return err('unsupported_replacement', 'Replacement may not contain tabs, line breaks, objects or control characters');
    }
    const priv = checkPrivacy(patch.replacement);
    if (priv.blocked) return err('privacy', priv.warnings.join(' '));

    // Covered segments must all be text runs.
    let off = 0;
    for (let i = 0; i < st.para.segments.length; i++) {
      const len = st.texts[i].length;
      const segStart = off;
      const segEnd = off + len;
      off = segEnd;
      if (st.para.segments[i].kind === 't') continue;
      if (patch.start < segEnd && patch.end > segStart) {
        return err('touches_non_text', `Range covers a ${st.para.segments[i].kind}, which cannot be edited`);
      }
    }
    if (this.hostSegment(st, patch.start, patch.end) === -1) {
      return err('no_text_run', 'No text run at this position to carry the new text');
    }
    return null;
  }

  /** Index of the 't' segment that receives the replacement text (inherits its run formatting). */
  private hostSegment(st: ParagraphState, start: number, end: number): number {
    let off = 0;
    let endingAtStart = -1;
    let startingAtStart = -1;
    for (let i = 0; i < st.para.segments.length; i++) {
      const len = st.texts[i].length;
      const segStart = off;
      const segEnd = off + len;
      off = segEnd;
      if (st.para.segments[i].kind !== 't') continue;
      if (start < end) {
        if (start < segEnd && end > segStart) return i; // first covered text segment
      } else {
        if (start > segStart && start < segEnd) return i;
        if (start === segEnd && endingAtStart === -1) endingAtStart = i;
        if (start === segStart && startingAtStart === -1) startingAtStart = i;
      }
    }
    // Pure insertion at a boundary: prefer the run before the point.
    return endingAtStart !== -1 ? endingAtStart : startingAtStart;
  }

  private applyOne(st: ParagraphState, texts: string[], p: TextPatch): void {
    const host = this.hostSegment({ para: st.para, texts }, p.start, p.end);
    let off = 0;
    const offsets = texts.map((t) => {
      const o = off;
      off += t.length;
      return o;
    });
    if (p.start === p.end) {
      const rel = p.start - offsets[host];
      texts[host] = texts[host].slice(0, rel) + p.replacement + texts[host].slice(rel);
      return;
    }
    let placed = false;
    for (let i = 0; i < texts.length; i++) {
      if (st.para.segments[i].kind !== 't') continue;
      const segStart = offsets[i];
      const segEnd = segStart + texts[i].length;
      if (!(p.start < segEnd && p.end > segStart)) continue;
      const a = Math.max(p.start, segStart) - segStart;
      const b = Math.min(p.end, segEnd) - segStart;
      texts[i] = texts[i].slice(0, a) + (i === host && !placed ? p.replacement : '') + texts[i].slice(b);
      if (i === host) placed = true;
    }
  }

  /** Validates every patch, then applies all of them or none. */
  applyGroup(group: PatchGroup): ApplyResult {
    if (group.patches.length === 0) return { ok: false, errors: [{ patchId: '', code: 'empty_group', detail: 'Group has no patches' }] };
    const errors: PatchError[] = [];
    const ids = new Set<string>();
    for (const p of group.patches) {
      if (ids.has(p.id)) errors.push({ patchId: p.id, code: 'duplicate_patch_id', detail: 'Duplicate patch id in group' });
      ids.add(p.id);
      const e = this.checkPatch(p);
      if (e) errors.push(e);
    }

    const byPara = new Map<string, TextPatch[]>();
    for (const p of group.patches) byPara.set(p.paragraphId, [...(byPara.get(p.paragraphId) ?? []), p]);
    for (const list of byPara.values()) {
      const sorted = [...list].sort((a, b) => a.start - b.start || a.end - b.end);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        if (cur.start < prev.end || cur.start === prev.start) {
          errors.push({ patchId: cur.id, code: 'overlap', detail: `Overlaps patch ${prev.id}` });
        }
      }
    }
    if (errors.length) return { ok: false, errors };

    // All patches of a paragraph share the same base text; apply right-to-left
    // so earlier offsets stay valid.
    const next = new Map<string, string[]>();
    for (const [pid, list] of byPara) {
      const st = this.states.get(pid)!;
      const texts = [...st.texts];
      for (const p of [...list].sort((a, b) => b.start - a.start)) this.applyOne(st, texts, p);
      next.set(pid, texts);
    }
    for (const [pid, texts] of next) this.states.get(pid)!.texts = texts;
    this.applied.push(group);
    this._revision = `r${this.applied.length}-${sha256(
      this.doc.sha256 +
        JSON.stringify(
          this.applied.map((g) => [g.id, g.patches.map((p) => [p.paragraphId, p.start, p.end, p.expected, p.replacement, p.baseTextHash])])
        )
    ).slice(0, 12)}`;
    return { ok: true, revision: this._revision };
  }

  /** The main part with every changed w:t spliced in; everything else is the original text. */
  toMainXml(): string {
    const edits: { start: number; end: number; xml: string }[] = [];
    for (const st of this.states.values()) {
      st.para.segments.forEach((seg, i) => {
        if (seg.kind !== 't' || st.texts[i] === seg.text) return;
        const tag = seg.el.name;
        edits.push({ start: seg.el.start, end: seg.el.end, xml: `<${tag} xml:space="preserve">${escapeText(st.texts[i])}</${tag}>` });
      });
    }
    edits.sort((a, b) => b.start - a.start);
    let xml = this.doc.mainXml;
    for (const e of edits) xml = xml.slice(0, e.start) + e.xml + xml.slice(e.end);
    return xml;
  }

  /**
   * Writes the revised DOCX and re-opens it to verify that every paragraph
   * reads back as expected. A file that does not verify is never returned.
   */
  async export(): Promise<Buffer> {
    const out = await writeDocx(this.doc, this.toMainXml());
    const reopened = await openDocx(out);
    const expected = this.doc.paragraphs.map((p) => this.paragraphText(p.id));
    const actual = reopened.paragraphs.map((p) => p.text);
    if (actual.length !== expected.length || actual.some((t, i) => t !== expected[i])) {
      const i = actual.findIndex((t, k) => t !== expected[k]);
      throw new Error(`Export verification failed at paragraph ${i}: the written file does not read back as the revised text`);
    }
    return out;
  }
}
