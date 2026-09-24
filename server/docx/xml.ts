// Minimal XML reader for OOXML parts that keeps the exact character offsets of
// every element. Edits are spliced into the original string at those offsets,
// so everything outside the edited elements stays byte-identical. Re-
// serialising a DOM would reorder namespaces, drop whitespace and change
// quoting in parts of the document nobody asked to change.
//
// Safety: DOCTYPE and ENTITY declarations are refused outright (no external
// or internal entities, no entity expansion). Only the five predefined
// entities and numeric character references are decoded.

export interface XmlText {
  type: 'text';
  start: number;
  end: number;
  value: string; // decoded
}

export interface XmlElement {
  type: 'element';
  name: string; // qualified name as written, e.g. "w:p"
  attrs: Record<string, string>; // decoded values
  start: number; // offset of '<'
  openEnd: number; // offset just after the opening tag's '>'
  closeStart: number; // offset of '</' (=== end for a self-closing element)
  end: number; // offset just after the element
  selfClosing: boolean;
  children: XmlNode[];
  parent: XmlElement | null;
}

export type XmlNode = XmlElement | XmlText;

export class XmlSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XmlSafetyError';
  }
}

const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(raw: string): string {
  if (!raw.includes('&')) return raw;
  return raw.replace(/&([^;&\s]*);?/g, (m, body: string) => {
    if (!m.endsWith(';')) throw new XmlSafetyError(`Unterminated entity reference «${m}»`);
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const cp = parseInt(body.slice(2), 16);
      if (!Number.isFinite(cp)) throw new XmlSafetyError(`Invalid character reference «${m}»`);
      return String.fromCodePoint(cp);
    }
    if (body.startsWith('#')) {
      const cp = parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp)) throw new XmlSafetyError(`Invalid character reference «${m}»`);
      return String.fromCodePoint(cp);
    }
    const v = PREDEFINED[body];
    if (v === undefined) throw new XmlSafetyError(`Undeclared entity «${m}» (entities are not allowed)`);
    return v;
  });
}

export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// XML 1.0 Char production (without the surrogate range check, which JS
// strings handle as pairs).
export function hasInvalidXmlChars(s: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/.test(s);
}

function parseAttrs(src: string, from: number, to: number, tagStart: number): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /\s*([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/y;
  let i = from;
  while (i < to) {
    // Skip whitespace up to the end.
    while (i < to && /\s/.test(src[i])) i++;
    if (i >= to) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m || m.index !== i || re.lastIndex > to) {
      throw new XmlSafetyError(`Malformed attributes in tag at offset ${tagStart}`);
    }
    attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
    i = re.lastIndex;
  }
  return attrs;
}

/** Finds the '>' that ends a tag starting at `i`, skipping quoted attribute values. */
function tagEnd(src: string, i: number): number {
  let quote: string | null = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return j;
    }
  }
  throw new XmlSafetyError(`Unterminated tag at offset ${i}`);
}

/**
 * Parses `src` into a tree with offsets. Returns the document element.
 * Throws XmlSafetyError on DOCTYPE/ENTITY, undeclared entities or malformed
 * markup.
 */
export function parseXml(src: string): XmlElement {
  if (/<!DOCTYPE/i.test(src) || /<!ENTITY/i.test(src)) {
    throw new XmlSafetyError('DOCTYPE / ENTITY declarations are not allowed in DOCX parts');
  }

  const root: XmlElement = {
    type: 'element',
    name: '#document',
    attrs: {},
    start: 0,
    openEnd: 0,
    closeStart: src.length,
    end: src.length,
    selfClosing: false,
    children: [],
    parent: null,
  };
  let current = root;
  let i = 0;
  const n = src.length;

  while (i < n) {
    const lt = src.indexOf('<', i);
    const textEnd = lt === -1 ? n : lt;
    if (textEnd > i) {
      if (current !== root) {
        current.children.push({ type: 'text', start: i, end: textEnd, value: decodeEntities(src.slice(i, textEnd)) });
      } else if (src.slice(i, textEnd).trim() !== '' && src.slice(i, textEnd) !== '﻿') {
        throw new XmlSafetyError(`Text outside the document element at offset ${i}`);
      }
    }
    if (lt === -1) break;
    i = lt;

    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4);
      if (e === -1) throw new XmlSafetyError(`Unterminated comment at offset ${i}`);
      i = e + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const e = src.indexOf(']]>', i + 9);
      if (e === -1) throw new XmlSafetyError(`Unterminated CDATA at offset ${i}`);
      if (current !== root) current.children.push({ type: 'text', start: i, end: e + 3, value: src.slice(i + 9, e) });
      i = e + 3;
      continue;
    }
    if (src.startsWith('<?', i)) {
      const e = src.indexOf('?>', i + 2);
      if (e === -1) throw new XmlSafetyError(`Unterminated processing instruction at offset ${i}`);
      i = e + 2;
      continue;
    }
    if (src.startsWith('<!', i)) {
      throw new XmlSafetyError(`Unsupported markup declaration at offset ${i}`);
    }

    const gt = tagEnd(src, i + 1);
    if (src[i + 1] === '/') {
      const name = src.slice(i + 2, gt).trim();
      if (current === root || current.name !== name) {
        throw new XmlSafetyError(`Mismatched closing tag </${name}> at offset ${i}`);
      }
      current.closeStart = i;
      current.end = gt + 1;
      current = current.parent!;
      i = gt + 1;
      continue;
    }

    const selfClosing = src[gt - 1] === '/';
    const inner = src.slice(i + 1, selfClosing ? gt - 1 : gt);
    const nameMatch = /^[^\s/>]+/.exec(inner);
    if (!nameMatch) throw new XmlSafetyError(`Malformed tag at offset ${i}`);
    const name = nameMatch[0];
    const attrs = parseAttrs(src, i + 1 + name.length, selfClosing ? gt - 1 : gt, i);
    const el: XmlElement = {
      type: 'element',
      name,
      attrs,
      start: i,
      openEnd: gt + 1,
      closeStart: selfClosing ? gt + 1 : -1,
      end: selfClosing ? gt + 1 : -1,
      selfClosing,
      children: [],
      parent: current,
    };
    if (current === root && root.children.some((c) => c.type === 'element')) {
      throw new XmlSafetyError(`More than one document element (offset ${i})`);
    }
    current.children.push(el);
    if (!selfClosing) current = el;
    i = gt + 1;
  }

  if (current !== root) throw new XmlSafetyError(`Unclosed element <${current.name}>`);
  const docEl = root.children.find((c): c is XmlElement => c.type === 'element');
  if (!docEl) throw new XmlSafetyError('No document element');
  docEl.parent = null;
  return docEl;
}

export function childElements(el: XmlElement, name?: string): XmlElement[] {
  return el.children.filter((c): c is XmlElement => c.type === 'element' && (!name || c.name === name));
}

export function firstChild(el: XmlElement, name: string): XmlElement | undefined {
  return el.children.find((c): c is XmlElement => c.type === 'element' && c.name === name);
}

/** Depth-first, document order. */
export function* walkElements(el: XmlElement): Generator<XmlElement> {
  yield el;
  for (const c of el.children) if (c.type === 'element') yield* walkElements(c);
}

/** Concatenated decoded text of all text nodes under `el`. */
export function textContent(el: XmlElement): string {
  let out = '';
  for (const c of el.children) out += c.type === 'text' ? c.value : textContent(c);
  return out;
}
