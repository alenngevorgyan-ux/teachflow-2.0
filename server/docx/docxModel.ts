import crypto from 'crypto';
import type { PreservationItem, PreservationKind } from '../../shared/types.js';
import { PrivacyViolationError, checkPrivacy } from '../pipeline/privacyGuard.js';
import { DocxPackage, DocxRejectedError, loadDocxPackage, partText, writeDocxPackage } from './docxPackage.js';
import { XmlElement, XmlSafetyError, childElements, firstChild, parseXml, textContent, walkElements } from './xml.js';

// ------------------------------------------------------------------ types

/** A piece of a paragraph's visible text. Only 't' segments are editable. */
export type Segment =
  | { kind: 't'; text: string; el: XmlElement; run: XmlElement }
  | { kind: 'tab' | 'break' | 'hyphen' | 'object'; text: string };

export type ParagraphLocation = 'body' | 'table' | 'textbox' | 'content_control';

export interface DocxParagraph {
  /** `p<index>-<hash8>`: index in document order + hash of the original text. */
  id: string;
  index: number;
  /** Visible text: w:t text, tabs as \t, breaks as \n, objects as U+FFFC. Offsets in patches are UTF-16 code units of this string. */
  text: string;
  segments: Segment[];
  location: ParagraphLocation;
  table?: { table: number; row: number; cell: number };
  styleId?: string;
  numbering?: NumberingInfo;
  editable: boolean;
  lockReasons: string[];
}

export interface NumberingInfo {
  numId: string;
  ilvl: number;
  /** Computed list label ("3.", "ա)"). Approximate: a preview, not Word's rendering. */
  label?: string;
  format?: string;
}

export interface DocxDocument {
  pkg: DocxPackage;
  /** The uploaded bytes, untouched. A no-op export returns exactly these. */
  original: Uint8Array;
  sha256: string; // of the uploaded bytes
  mainXml: string; // decoded main part (BOM stripped)
  mainHasBom: boolean;
  root: XmlElement;
  paragraphs: DocxParagraph[];
  preservation: PreservationItem[];
  /** Parts whose text was privacy-checked, with the reason a part was not. */
  privacy: { checkedParts: string[]; uncheckable: { part: string; reason: string }[] };
}

// ---------------------------------------------------------------- helpers

export function sha256(data: Uint8Array | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function textHash(text: string): string {
  return sha256(text);
}

function decodePart(pkg: DocxPackage, name: string): { xml: string; bom: boolean } {
  const part = pkg.parts.find((p) => p.name === name)!;
  const bom = part.data.length >= 3 && part.data[0] === 0xef && part.data[1] === 0xbb && part.data[2] === 0xbf;
  let xml: string;
  try {
    xml = partText(part);
  } catch {
    throw new DocxRejectedError('encoding', `«${name}» մասը UTF-8 չէ: Աջակցվում է միայն Word-ի ստանդարտ կոդավորումը:`);
  }
  const decl = /^<\?xml[^>]*encoding=["']([^"']+)["']/i.exec(xml);
  if (decl && !/^utf-?8$/i.test(decl[1])) {
    throw new DocxRejectedError('encoding', `«${name}» մասի կոդավորումը (${decl[1]}) չի աջակցվում:`);
  }
  return { xml, bom };
}

function parsePart(pkg: DocxPackage, name: string): XmlElement | null {
  if (!pkg.parts.some((p) => p.name === name)) return null;
  try {
    return parseXml(decodePart(pkg, name).xml);
  } catch (err) {
    if (err instanceof XmlSafetyError) {
      throw new DocxRejectedError('unsafe_xml', `«${name}» մասը չի կարող ապահով կարդացվել: ${err.message}`);
    }
    throw err;
  }
}

// -------------------------------------------------------------- numbering

interface LevelDef {
  start: number;
  numFmt: string;
  lvlText: string;
}

interface NumberingDefs {
  numToAbstract: Map<string, string>;
  startOverrides: Map<string, Map<number, number>>; // numId -> ilvl -> start
  levels: Map<string, Map<number, LevelDef>>; // abstractNumId -> ilvl -> def
}

function readNumbering(root: XmlElement | null): NumberingDefs {
  const defs: NumberingDefs = { numToAbstract: new Map(), startOverrides: new Map(), levels: new Map() };
  if (!root) return defs;
  for (const an of childElements(root, 'w:abstractNum')) {
    const id = an.attrs['w:abstractNumId'];
    const lv = new Map<number, LevelDef>();
    for (const l of childElements(an, 'w:lvl')) {
      lv.set(Number(l.attrs['w:ilvl']), {
        start: Number(firstChild(l, 'w:start')?.attrs['w:val'] ?? 1),
        numFmt: firstChild(l, 'w:numFmt')?.attrs['w:val'] ?? 'decimal',
        lvlText: firstChild(l, 'w:lvlText')?.attrs['w:val'] ?? '',
      });
    }
    defs.levels.set(id, lv);
  }
  for (const num of childElements(root, 'w:num')) {
    const numId = num.attrs['w:numId'];
    const abs = firstChild(num, 'w:abstractNumId')?.attrs['w:val'];
    if (abs !== undefined) defs.numToAbstract.set(numId, abs);
    const ov = new Map<number, number>();
    for (const o of childElements(num, 'w:lvlOverride')) {
      const s = firstChild(o, 'w:startOverride')?.attrs['w:val'];
      if (s !== undefined) ov.set(Number(o.attrs['w:ilvl']), Number(s));
    }
    if (ov.size) defs.startOverrides.set(numId, ov);
  }
  return defs;
}

interface StyleNum {
  numId?: string;
  ilvl?: number;
  basedOn?: string;
}

function readStyleNumbering(root: XmlElement | null): Map<string, StyleNum> {
  const out = new Map<string, StyleNum>();
  if (!root) return out;
  for (const st of childElements(root, 'w:style')) {
    if (st.attrs['w:type'] !== 'paragraph') continue;
    const numPr = firstChild(firstChild(st, 'w:pPr') ?? st, 'w:numPr');
    out.set(st.attrs['w:styleId'], {
      numId: numPr ? firstChild(numPr, 'w:numId')?.attrs['w:val'] : undefined,
      ilvl: numPr && firstChild(numPr, 'w:ilvl') ? Number(firstChild(numPr, 'w:ilvl')!.attrs['w:val']) : undefined,
      basedOn: firstChild(st, 'w:basedOn')?.attrs['w:val'],
    });
  }
  return out;
}

function styleNumbering(styles: Map<string, StyleNum>, styleId: string | undefined): { numId?: string; ilvl?: number } {
  const seen = new Set<string>();
  let id = styleId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const s = styles.get(id);
    if (!s) break;
    if (s.numId !== undefined) return { numId: s.numId, ilvl: s.ilvl };
    id = s.basedOn;
  }
  return {};
}

const ROMAN: [number, string][] = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

function formatNumber(n: number, fmt: string): string | null {
  switch (fmt) {
    case 'decimal':
      return String(n);
    case 'decimalZero':
      return n < 10 ? `0${n}` : String(n);
    case 'lowerLetter':
    case 'upperLetter': {
      const letter = String.fromCharCode(97 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1);
      return fmt === 'upperLetter' ? letter.toUpperCase() : letter;
    }
    case 'lowerRoman':
    case 'upperRoman': {
      let r = '';
      let v = n;
      for (const [k, s] of ROMAN) while (v >= k) { r += s; v -= k; }
      return fmt === 'upperRoman' ? r.toUpperCase() : r;
    }
    default:
      return null; // not rendered; reported as a limitation
  }
}

class NumberingCounter {
  private counters = new Map<string, number[]>(); // abstractNumId -> per-level counters
  private usedNums = new Set<string>();
  readonly unrenderedFormats = new Set<string>();

  constructor(private defs: NumberingDefs) {}

  next(numId: string, ilvl: number): NumberingInfo {
    const info: NumberingInfo = { numId, ilvl };
    const abs = this.defs.numToAbstract.get(numId);
    const lvls = abs !== undefined ? this.defs.levels.get(abs) : undefined;
    const lvl = lvls?.get(ilvl);
    if (abs === undefined || !lvls || !lvl) return info;

    const c = this.counters.get(abs) ?? [];
    const ov = this.defs.startOverrides.get(numId);
    if (!this.usedNums.has(numId)) {
      this.usedNums.add(numId);
      // A startOverride restarts the list when this num instance is first used.
      if (ov) for (const [l, s] of ov) c[l] = s - 1;
    }
    for (let l = 0; l <= ilvl; l++) if (c[l] === undefined) c[l] = (lvls.get(l)?.start ?? 1) - 1;
    c[ilvl] += 1;
    c.length = ilvl + 1; // deeper levels restart
    this.counters.set(abs, c);

    info.format = lvl.numFmt;
    if (lvl.numFmt === 'bullet' || lvl.numFmt === 'none') {
      info.label = lvl.numFmt === 'bullet' ? lvl.lvlText || '•' : '';
      return info;
    }
    let ok = true;
    const label = lvl.lvlText.replace(/%(\d)/g, (_m, d: string) => {
      const l = Number(d) - 1;
      const f = formatNumber(c[l] ?? lvls.get(l)?.start ?? 1, lvls.get(l)?.numFmt ?? 'decimal');
      if (f === null) {
        ok = false;
        this.unrenderedFormats.add(lvls.get(l)?.numFmt ?? '?');
        return '?';
      }
      return f;
    });
    info.label = ok ? label : undefined;
    return info;
  }
}

// ------------------------------------------------------ paragraph walking

// Zero-width markup inside a paragraph or run that does not affect visible text.
const IGNORABLE = new Set([
  'w:pPr', 'w:rPr', 'w:bookmarkStart', 'w:bookmarkEnd', 'w:proofErr', 'w:permStart', 'w:permEnd',
  'w:commentRangeStart', 'w:commentRangeEnd', 'w:commentReference', 'w:lastRenderedPageBreak',
  'w:annotationRef', 'w:footnoteRef', 'w:endnoteRef', 'w:separator', 'w:continuationSeparator',
  'w:moveFromRangeStart', 'w:moveFromRangeEnd', 'w:moveToRangeStart', 'w:moveToRangeEnd',
]);

const TRACKED = new Set(['w:ins', 'w:del', 'w:moveFrom', 'w:moveTo']);

interface WalkState {
  location: ParagraphLocation;
  table?: { table: number; row: number; cell: number };
}

interface Counts {
  textBoxes: number;
  equations: number;
  fields: number;
  contentControls: number;
  tracked: number;
  unknownInline: Set<string>;
}

function readParagraph(p: XmlElement, state: WalkState, counts: Counts): Omit<DocxParagraph, 'id' | 'index' | 'numbering'> & {
  numPr?: { numId?: string; ilvl?: number };
} {
  const segments: Segment[] = [];
  const lock = new Set<string>();
  if (state.location === 'textbox') lock.add('text_box');
  if (state.location === 'content_control') lock.add('content_control');

  const pPr = firstChild(p, 'w:pPr');
  const styleId = pPr ? firstChild(pPr, 'w:pStyle')?.attrs['w:val'] : undefined;
  let numPr: { numId?: string; ilvl?: number } | undefined;
  const np = pPr ? firstChild(pPr, 'w:numPr') : undefined;
  if (np) {
    numPr = {
      numId: firstChild(np, 'w:numId')?.attrs['w:val'],
      ilvl: firstChild(np, 'w:ilvl') ? Number(firstChild(np, 'w:ilvl')!.attrs['w:val']) : undefined,
    };
  }
  if (pPr) {
    for (const e of walkElements(pPr)) {
      if (e.name === 'w:pPrChange' || e.name === 'w:rPrChange') {
        lock.add('tracked_changes');
        counts.tracked++;
      }
    }
  }

  let inField = 0; // complex field depth
  let fieldResult = false;

  const readRun = (r: XmlElement) => {
    for (const c of childElements(r)) {
      switch (c.name) {
        case 'w:rPr':
          for (const e of walkElements(c)) if (e.name === 'w:rPrChange') { lock.add('tracked_changes'); counts.tracked++; }
          break;
        case 'w:t':
          if (inField && !fieldResult) break; // field code, not visible
          segments.push({ kind: 't', text: textContent(c), el: c, run: r });
          break;
        case 'w:tab':
        case 'w:ptab':
          segments.push({ kind: 'tab', text: '\t' });
          break;
        case 'w:br':
        case 'w:cr':
          segments.push({ kind: 'break', text: '\n' });
          break;
        case 'w:noBreakHyphen':
          segments.push({ kind: 'hyphen', text: '‑' });
          break;
        case 'w:softHyphen':
          segments.push({ kind: 'hyphen', text: '­' });
          break;
        case 'w:fldChar': {
          lock.add('field');
          const t = c.attrs['w:fldCharType'];
          if (t === 'begin') { inField++; fieldResult = false; counts.fields++; }
          else if (t === 'separate') fieldResult = true;
          else if (t === 'end') { inField = Math.max(0, inField - 1); fieldResult = false; }
          break;
        }
        case 'w:instrText':
          lock.add('field');
          break;
        case 'w:delText':
          break; // deleted text is not visible
        case 'w:sym':
          lock.add('symbol');
          segments.push({ kind: 'object', text: '￼' });
          break;
        case 'w:drawing':
        case 'w:pict':
        case 'w:object':
        case 'mc:AlternateContent':
          // Images, shapes and text boxes: not text of this paragraph. Text
          // box paragraphs inside are walked separately (and locked).
          segments.push({ kind: 'object', text: '￼' });
          break;
        case 'w:footnoteReference':
        case 'w:endnoteReference':
          segments.push({ kind: 'object', text: '￼' });
          break;
        default:
          if (!IGNORABLE.has(c.name)) {
            lock.add(`unknown:${c.name}`);
            counts.unknownInline.add(c.name);
          }
      }
    }
  };

  const readInline = (el: XmlElement) => {
    for (const c of childElements(el)) {
      if (c.name === 'w:r') readRun(c);
      else if (c.name === 'w:hyperlink') readInline(c);
      else if (TRACKED.has(c.name)) {
        lock.add('tracked_changes');
        counts.tracked++;
        if (c.name === 'w:ins' || c.name === 'w:moveTo') readInline(c);
      } else if (c.name === 'w:fldSimple') {
        lock.add('field');
        counts.fields++;
        readInline(c);
      } else if (c.name === 'w:sdt') {
        lock.add('content_control');
        counts.contentControls++;
        const content = firstChild(c, 'w:sdtContent');
        if (content) readInline(content);
      } else if (c.name === 'w:smartTag' || c.name === 'w:customXml') {
        lock.add('custom_markup');
        readInline(c);
      } else if (c.name === 'm:oMath' || c.name === 'm:oMathPara') {
        lock.add('equation');
        counts.equations++;
        segments.push({ kind: 'object', text: '￼' });
      } else if (!IGNORABLE.has(c.name)) {
        lock.add(`unknown:${c.name}`);
        counts.unknownInline.add(c.name);
      }
    }
  };

  readInline(p);
  if (inField) lock.add('field');

  return {
    text: segments.map((s) => s.text).join(''),
    segments,
    location: state.location,
    table: state.table,
    styleId,
    numPr,
    editable: lock.size === 0,
    lockReasons: [...lock],
  };
}

function collectParagraphs(body: XmlElement, counts: Counts) {
  const out: ReturnType<typeof readParagraph>[] = [];
  let tableCounter = 0;

  const visit = (el: XmlElement, state: WalkState) => {
    for (const c of childElements(el)) {
      if (c.name === 'w:p') {
        out.push(readParagraph(c, state, counts));
        // Text boxes live inside runs of this paragraph.
        for (const e of walkElements(c)) {
          if (e.name === 'w:txbxContent') {
            // mc:Fallback repeats the mc:Choice text box (VML copy): skip it.
            // A text box nested in another text box belongs to that inner
            // paragraph and is visited from there.
            let a: XmlElement | null = e.parent;
            let skip = false;
            while (a && a !== c) {
              if (a.name === 'mc:Fallback' || a.name === 'w:p' || a.name === 'w:txbxContent') skip = true;
              a = a.parent;
            }
            if (skip) continue;
            counts.textBoxes++;
            visit(e, { location: 'textbox' });
          }
        }
      } else if (c.name === 'w:tbl') {
        const t = tableCounter++;
        childElements(c, 'w:tr').forEach((tr, row) => {
          childElements(tr, 'w:tc').forEach((tc, cell) => {
            visit(tc, { location: state.location === 'body' ? 'table' : state.location, table: { table: t, row, cell } });
          });
        });
      } else if (c.name === 'w:sdt') {
        counts.contentControls++;
        const content = firstChild(c, 'w:sdtContent');
        if (content) visit(content, { location: 'content_control' });
      } else if (c.name === 'w:customXml' || c.name === 'w:ins' || c.name === 'w:moveTo') {
        if (c.name !== 'w:customXml') counts.tracked++;
        visit(c, state);
      } else if (c.name === 'w:altChunk') {
        // Counted from relationships; content is not WordprocessingML.
      }
    }
  };
  visit(body, { location: 'body' });
  return out;
}

// ------------------------------------------------------------ privacy scan

const TEXT_PART = /\.(xml|rels)$/i;
const BINARY_TEXTLESS = /\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|svg|webp)$/i;

function textLines(root: XmlElement): string[] {
  const lines: string[] = [];
  const visit = (el: XmlElement) => {
    if (/(^|:)p$/.test(el.name)) {
      lines.push(textContent(el));
      // Nested paragraphs (text boxes) are also scanned on their own lines.
      for (const c of el.children) if (c.type === 'element') for (const e of walkElements(c)) if (/(^|:)p$/.test(e.name)) lines.push(textContent(e));
      return;
    }
    const direct = el.children.filter((c) => c.type === 'text').map((c) => (c as { value: string }).value).join('');
    if (direct.trim()) lines.push(direct);
    for (const c of el.children) if (c.type === 'element') visit(c);
  };
  visit(root);
  return lines;
}

function privacyScan(pkg: DocxPackage): DocxDocument['privacy'] {
  const checkedParts: string[] = [];
  const uncheckable: { part: string; reason: string }[] = [];

  for (const part of pkg.parts) {
    if (TEXT_PART.test(part.name)) {
      const root = parsePart(pkg, part.name);
      if (!root) continue;
      // One line per paragraph (w:p, a:p) and per other text-bearing element,
      // so words of neighbouring paragraphs never merge into one "sentence";
      // plus person-bearing attributes (comment and revision authors).
      const lines = textLines(root);
      for (const e of walkElements(root)) {
        for (const k of ['w:author', 'w:initials', 'w15:userId']) if (e.attrs[k]) lines.push(`${k}: ${e.attrs[k]}`);
      }
      const r = checkPrivacy(lines.join('\n'));
      if (r.blocked) {
        throw new PrivacyViolationError(`docx:${part.name}`, {
          ...r,
          warnings: r.warnings.map((w) => `«${part.name}»: ${w}`),
        });
      }
      checkedParts.push(part.name);
    } else if (BINARY_TEXTLESS.test(part.name)) {
      uncheckable.push({ part: part.name, reason: 'image: text inside images is not read' });
    } else {
      uncheckable.push({ part: part.name, reason: 'binary part (embedded object / font / other): not read' });
    }
  }
  return { checkedParts, uncheckable };
}

// ------------------------------------------------------------------ entry

/**
 * Opens a DOCX for review. Order matters: the package is validated, every
 * XML part is parsed safely, and all readable text (body, headers, footers,
 * footnotes, comments, metadata, charts, ...) passes the privacy check before
 * the caller may store the file or send any of it to a model.
 */
export async function openDocx(buffer: Uint8Array): Promise<DocxDocument> {
  const pkg = await loadDocxPackage(buffer);
  const privacy = privacyScan(pkg);

  const { xml: mainXml, bom: mainHasBom } = decodePart(pkg, pkg.mainPartName);
  let root: XmlElement;
  try {
    root = parseXml(mainXml);
  } catch (err) {
    throw new DocxRejectedError('unsafe_xml', `Հիմնական մասը չի կարող ապահով կարդացվել: ${err instanceof Error ? err.message : String(err)}`);
  }
  const body = firstChild(root, 'w:body');
  if (!body) throw new DocxRejectedError('not_docx', 'Փաստաթղթի մարմինը (w:body) բացակայում է:');

  const numbering = readNumbering(parsePart(pkg, 'word/numbering.xml'));
  const styles = readStyleNumbering(parsePart(pkg, 'word/styles.xml'));
  const counter = new NumberingCounter(numbering);

  const counts: Counts = { textBoxes: 0, equations: 0, fields: 0, contentControls: 0, tracked: 0, unknownInline: new Set() };
  const raw = collectParagraphs(body, counts);

  const paragraphs: DocxParagraph[] = raw.map((r, index) => {
    const fromStyle = styleNumbering(styles, r.styleId);
    const numId = r.numPr?.numId ?? fromStyle.numId;
    const ilvl = r.numPr?.ilvl ?? fromStyle.ilvl ?? 0;
    const numberingInfo = numId && numId !== '0' ? counter.next(numId, ilvl) : undefined;
    const { numPr: _numPr, ...rest } = r;
    return {
      ...rest,
      id: `p${String(index).padStart(4, '0')}-${textHash(r.text).slice(0, 8)}`,
      index,
      numbering: numberingInfo,
    };
  });

  // ---- preservation report
  const names = pkg.parts.map((p) => p.name);
  const preservation: PreservationItem[] = [];
  const add = (kind: PreservationKind, count: number, parts: string[], textChecked: boolean, note: string) => {
    if (count > 0) preservation.push({ kind, count, parts, textChecked, editable: false, note });
  };
  const hf = names.filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n));
  add('header_footer', hf.length, hf, true, 'Headers and footers are kept as they are and are not reviewed or edited.');
  const notes = names.filter((n) => /^word\/(footnotes|endnotes)\.xml$/.test(n));
  add('footnotes_endnotes', notes.length, notes, true, 'Footnotes and endnotes are kept as they are and are not reviewed or edited.');
  const comments = names.filter((n) => /^word\/comments[A-Za-z]*\.xml$/.test(n));
  add('comments', comments.length, comments, true, 'Word comments are kept as they are; their anchors are not moved.');
  add('text_box', counts.textBoxes, [pkg.mainPartName], true, 'Text in text boxes is read but not edited.');
  add('equation', counts.equations, [pkg.mainPartName], true, 'Equations are kept and not edited; paragraphs containing them cannot be edited.');
  add('field', counts.fields, [pkg.mainPartName], true, 'Paragraphs with fields (page numbers, references, SEQ) cannot be edited.');
  add('content_control', counts.contentControls, [pkg.mainPartName], true, 'Content controls are kept and not edited.');
  add('tracked_changes', counts.tracked, [pkg.mainPartName], true, 'The file contains tracked changes; affected paragraphs cannot be edited until they are accepted or rejected in Word.');
  const media = names.filter((n) => BINARY_TEXTLESS.test(n));
  add('images', media.length, media, false, 'Images are kept; text inside images is not read, so it is not reviewed or privacy-checked.');
  const embedded = names.filter((n) => /^word\/embeddings\//.test(n));
  add('embedded_objects', embedded.length, embedded, false, 'Embedded objects are kept; their content is not read.');
  const charts = names.filter((n) => /^word\/(charts|diagrams)\//.test(n) && n.endsWith('.xml'));
  add('charts_diagrams', charts.length, charts, true, 'Charts and SmartArt are kept; their text is privacy-checked but not reviewed or edited.');
  const alt = [...walkElements(body)].filter((e) => e.name === 'w:altChunk').length;
  add('alt_chunk', alt, [pkg.mainPartName], false, 'Imported chunks (altChunk) are kept; their content is not read.');
  const meta = names.filter((n) => /^docProps\//.test(n));
  add('metadata', meta.length, meta, true, 'Document properties (author, title) are kept unchanged.');
  if (counter.unrenderedFormats.size) {
    add('numbering_format', counter.unrenderedFormats.size, ['word/numbering.xml'], true,
      `List numbering format(s) ${[...counter.unrenderedFormats].join(', ')} are not rendered in the preview; Word's numbering itself is unchanged.`);
  }
  add('unknown_inline', counts.unknownInline.size, [pkg.mainPartName], true,
    `Unrecognised inline elements (${[...counts.unknownInline].join(', ')}); paragraphs containing them cannot be edited.`);

  return {
    pkg,
    original: buffer,
    sha256: sha256(buffer),
    mainXml,
    mainHasBom,
    root,
    paragraphs,
    preservation,
    privacy,
  };
}

/**
 * Writes the document back. With no `mainXml`, every part is written from its
 * original bytes. With `mainXml`, only the main part changes (BOM kept).
 */
export async function writeDocx(doc: DocxDocument, mainXml?: string): Promise<Buffer> {
  const replacements = new Map<string, Uint8Array>();
  if (mainXml !== undefined && mainXml !== doc.mainXml) {
    const body = new TextEncoder().encode(mainXml);
    if (doc.mainHasBom) {
      const withBom = new Uint8Array(body.length + 3);
      withBom.set([0xef, 0xbb, 0xbf]);
      withBom.set(body, 3);
      replacements.set(doc.pkg.mainPartName, withBom);
    } else {
      replacements.set(doc.pkg.mainPartName, body);
    }
  }
  return writeDocxPackage(doc.pkg, replacements);
}
