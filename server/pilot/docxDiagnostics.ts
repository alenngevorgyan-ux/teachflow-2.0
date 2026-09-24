import path from 'path';
import { openDocx } from '../docx/docxModel.js';
import { DocxRejectedError, loadDocxPackage, partText } from '../docx/docxPackage.js';
import { XmlElement, parseXml, walkElements } from '../docx/xml.js';
import { sha256 } from './preflight.js';

// Automatic DOCX diagnostics for pilot evidence. These are structural and
// textual facts only. They are NOT a rendering check: page breaks, glyphs,
// wrapping and table layout need Microsoft Word (see the Word QA checklist).

export interface DocxDiagnostics {
  bytes: number;
  sha256: string;
  zipOk: boolean;
  openedByTeachFlow: boolean;
  error: string | null;
  parts: number;
  relationships: { source: string; target: string; exists: boolean | null; external: boolean }[];
  missingRelationshipTargets: string[];
  sections: { pageWidthTwips: number | null; pageHeightTwips: number | null; orientation: string; marginsTwips: Record<string, number> }[];
  paragraphs: number;
  textLength: number;
  suspiciousEmpty: boolean;
  fonts: string[];
  expected: { text: string; present: boolean }[];
  renderedPreview: 'NOT_RUN — no renderer in this environment; Microsoft Word QA is a separate human step';
}

function attr(el: XmlElement | undefined, name: string): string | undefined {
  return el?.attrs[name];
}

export async function docxDiagnostics(buf: Buffer, expectedTexts: string[] = []): Promise<DocxDiagnostics> {
  const d: DocxDiagnostics = {
    bytes: buf.length,
    sha256: sha256(buf),
    zipOk: false,
    openedByTeachFlow: false,
    error: null,
    parts: 0,
    relationships: [],
    missingRelationshipTargets: [],
    sections: [],
    paragraphs: 0,
    textLength: 0,
    suspiciousEmpty: true,
    fonts: [],
    expected: [],
    renderedPreview: 'NOT_RUN — no renderer in this environment; Microsoft Word QA is a separate human step',
  };
  try {
    const pkg = await loadDocxPackage(buf);
    d.zipOk = true;
    d.parts = pkg.parts.length;
    const names = new Set(pkg.parts.map((p) => p.name));
    for (const part of pkg.parts.filter((p) => p.name.endsWith('.rels'))) {
      const baseDir = path.posix.dirname(path.posix.dirname(part.name)); // "word/_rels/document.xml.rels" -> "word"
      for (const rel of walkElements(parseXml(partText(part)))) {
        if (rel.name !== 'Relationship') continue;
        const target = rel.attrs.Target ?? '';
        const external = rel.attrs.TargetMode === 'External';
        const resolved = external ? null : target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(baseDir === '.' ? '' : baseDir, target));
        const exists = external ? null : names.has(resolved!);
        d.relationships.push({ source: part.name, target, exists, external });
        if (exists === false) d.missingRelationshipTargets.push(`${part.name} -> ${target}`);
      }
    }
    const main = parseXml(partText(pkg.parts.find((p) => p.name === pkg.mainPartName)!));
    const fonts = new Set<string>();
    for (const el of walkElements(main)) {
      if (el.name === 'w:sectPr') {
        const pgSz = el.children.find((c): c is XmlElement => c.type === 'element' && c.name === 'w:pgSz');
        const pgMar = el.children.find((c): c is XmlElement => c.type === 'element' && c.name === 'w:pgMar');
        const w = attr(pgSz, 'w:w');
        const h = attr(pgSz, 'w:h');
        d.sections.push({
          pageWidthTwips: w ? Number(w) : null,
          pageHeightTwips: h ? Number(h) : null,
          orientation: attr(pgSz, 'w:orient') ?? (w && h ? (Number(w) > Number(h) ? 'landscape (by size)' : 'portrait (by size)') : 'unknown'),
          marginsTwips: Object.fromEntries(Object.entries(pgMar?.attrs ?? {}).map(([k, v]) => [k.replace('w:', ''), Number(v)])),
        });
      }
      if (el.name === 'w:rFonts') for (const k of ['w:ascii', 'w:hAnsi', 'w:cs', 'w:eastAsia']) if (el.attrs[k]) fonts.add(el.attrs[k]);
    }
    const stylesPart = pkg.parts.find((p) => p.name === 'word/styles.xml');
    if (stylesPart) for (const el of walkElements(parseXml(partText(stylesPart)))) if (el.name === 'w:rFonts') for (const k of ['w:ascii', 'w:hAnsi', 'w:cs']) if (el.attrs[k]) fonts.add(el.attrs[k]);
    d.fonts = [...fonts].sort();

    const doc = await openDocx(buf);
    d.openedByTeachFlow = true;
    const texts = doc.paragraphs.map((p) => p.text);
    d.paragraphs = texts.filter((t) => t.trim() !== '').length;
    d.textLength = texts.join('\n').length;
    d.suspiciousEmpty = d.paragraphs === 0 || d.textLength < 20;
    const all = texts.join('\n');
    d.expected = expectedTexts.map((t) => ({ text: t, present: all.includes(t) }));
  } catch (err) {
    d.error = err instanceof DocxRejectedError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err);
  }
  return d;
}
