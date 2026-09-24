// SYNTHETIC test documents, built by hand-written XML shaped like Word's
// output (run splits, rsid attributes, numbering, tables). They exercise the
// engine; they are NOT evidence that real Word files from teachers work —
// that check is a separate, still-open pilot criterion.
import JSZip from 'jszip';

export const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="w14"';

export interface SyntheticOptions {
  /** Inner XML of <w:body>, without the final sectPr. */
  body: string;
  numbering?: string;
  styles?: string;
  header?: string;
  comments?: string;
  core?: string;
  extraParts?: Record<string, string | Uint8Array>;
  contentTypeOverride?: string;
  bom?: boolean;
}

export const NUMBERING_DECIMAL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W_NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

export const SECT_PR =
  '<w:sectPr w:rsidR="00A1B2C3"><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';

export function run(text: string, rPr = ''): string {
  const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  return `<w:r w:rsidRPr="00D4E5F6">${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t${space}>${text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')}</w:t></w:r>`;
}

export function para(runs: string, pPr = ''): string {
  return `<w:p w:rsidR="00A1B2C3" w:rsidRDefault="00A1B2C3" w14:paraId="1A2B3C4D">${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${runs}</w:p>`;
}

export function numbered(runs: string, ilvl = 0, numId = 1): string {
  return para(runs, `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`);
}

export async function buildDocx(o: SyntheticOptions): Promise<Buffer> {
  const zip = new JSZip();
  const overrides: string[] = [
    `<Override PartName="/word/document.xml" ContentType="${
      o.contentTypeOverride ?? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
    }"/>`,
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
  ];
  const rels: string[] = [];
  if (o.numbering) {
    overrides.push('<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>');
    rels.push('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>');
  }
  if (o.styles) {
    overrides.push('<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>');
    rels.push('<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>');
  }
  if (o.header) {
    overrides.push('<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>');
    rels.push('<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>');
  }
  if (o.comments) {
    overrides.push('<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>');
    rels.push('<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>');
  }

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${overrides.join('')}</Types>`
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'
  );
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:document ${W_NS}><w:body>${o.body}${SECT_PR}</w:body></w:document>`;
  zip.file('word/document.xml', o.bom ? '﻿' + doc : doc);
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`
  );
  if (o.numbering) zip.file('word/numbering.xml', o.numbering);
  if (o.styles) zip.file('word/styles.xml', o.styles);
  if (o.header) zip.file('word/header1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr ${W_NS}>${o.header}</w:hdr>`);
  if (o.comments) zip.file('word/comments.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments ${W_NS}>${o.comments}</w:comments>`);
  zip.file(
    'docProps/core.xml',
    o.core ??
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Թեստ</dc:title><dc:creator>Synthetic</dc:creator></cp:coreProperties>'
  );
  for (const [name, data] of Object.entries(o.extraParts ?? {})) zip.file(name, data);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export async function unzipParts(buf: Uint8Array): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(buf);
  const out = new Map<string, Uint8Array>();
  for (const f of Object.values(zip.files)) if (!f.dir) out.set(f.name, await f.async('uint8array'));
  return out;
}
