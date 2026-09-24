import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { openDocx, writeDocx } from '../../server/docx/docxModel.js';
import { DOCX_LIMITS, DocxRejectedError } from '../../server/docx/docxPackage.js';
import { PrivacyViolationError } from '../../server/pipeline/privacyGuard.js';
import { NUMBERING_DECIMAL, W_NS, buildDocx, numbered, para, run, unzipParts } from './syntheticDocx.js';

const TEST_BODY =
  para(run('Թեստ. ', '<w:b/>') + run('Հայոց պատմություն')) +
  numbered(run('Ո՞վ էր ') + run('Տիգրան', '<w:i/>') + run(' Մեծը:')) +
  numbered(run('Արքա'), 1) +
  numbered(run('Զորավար'), 1) +
  numbered(run('Ե՞րբ է տեղի ունեցել Ավարայրի ճակատամարտը:')) +
  '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>' +
  '<w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>' + para(run('1')) + '</w:tc><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>' + para(run('ա')) + '</w:tc></w:tr>' +
  '</w:tbl>';

describe('openDocx: paragraph index', () => {
  it('joins text split across runs and keeps document order', async () => {
    const doc = await openDocx(await buildDocx({ body: TEST_BODY, numbering: NUMBERING_DECIMAL }));
    const texts = doc.paragraphs.map((p) => p.text);
    expect(texts).toEqual([
      'Թեստ. Հայոց պատմություն',
      'Ո՞վ էր Տիգրան Մեծը:',
      'Արքա',
      'Զորավար',
      'Ե՞րբ է տեղի ունեցել Ավարայրի ճակատամարտը:',
      '1',
      'ա',
    ]);
    expect(doc.paragraphs.every((p) => /^p\d{4}-[0-9a-f]{8}$/.test(p.id))).toBe(true);
    expect(doc.paragraphs[1].segments.filter((s) => s.kind === 't')).toHaveLength(3);
  });

  it('computes list labels, with deeper levels restarting', async () => {
    const doc = await openDocx(await buildDocx({ body: TEST_BODY, numbering: NUMBERING_DECIMAL }));
    expect(doc.paragraphs.map((p) => p.numbering?.label)).toEqual([undefined, '1.', 'a)', 'b)', '2.', undefined, undefined]);
  });

  it('takes numbering from the paragraph style when the paragraph has none', async () => {
    const styles = `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W_NS}><w:style w:type="paragraph" w:styleId="Q"><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Q2"><w:basedOn w:val="Q"/></w:style></w:styles>`;
    const body = para(run('a'), '<w:pStyle w:val="Q"/>') + para(run('b'), '<w:pStyle w:val="Q2"/>');
    const doc = await openDocx(await buildDocx({ body, numbering: NUMBERING_DECIMAL, styles }));
    expect(doc.paragraphs.map((p) => p.numbering?.label)).toEqual(['1.', '2.']);
  });

  it('records table position', async () => {
    const doc = await openDocx(await buildDocx({ body: TEST_BODY, numbering: NUMBERING_DECIMAL }));
    const cell = doc.paragraphs.find((p) => p.text === 'ա')!;
    expect(cell.location).toBe('table');
    expect(cell.table).toEqual({ table: 0, row: 0, cell: 1 });
    expect(cell.editable).toBe(true);
  });

  it('reports a numbering format it cannot render instead of guessing a label', async () => {
    const numbering = NUMBERING_DECIMAL.replace('<w:numFmt w:val="decimal"/>', '<w:numFmt w:val="armenian"/>');
    const doc = await openDocx(await buildDocx({ body: numbered(run('x')), numbering }));
    expect(doc.paragraphs[0].numbering?.label).toBeUndefined();
    expect(doc.preservation.find((p) => p.kind === 'numbering_format')?.note).toContain('armenian');
  });
});

describe('openDocx: content that is kept but not edited', () => {
  it('locks paragraphs with fields, tracked changes, equations and text boxes', async () => {
    const field =
      para(run('Էջ ') + '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' + run('3') + '<w:r><w:fldChar w:fldCharType="end"/></w:r>');
    const tracked = para(run('Հին ') + '<w:ins w:id="1" w:author="Reviewer" w:date="2026-01-01T00:00:00Z">' + run('նոր') + '</w:ins>');
    const eq = para(run('Բանաձև ') + '<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>');
    const textbox = para(
      '<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><w:txbxContent>' + para(run('Տուփ')) +
        '</w:txbxContent></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent>' + para(run('Տուփ')) +
        '</w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r>' + run('Շուրջը')
    );
    const doc = await openDocx(await buildDocx({ body: field + tracked + eq + textbox }));
    const byText = (t: string) => doc.paragraphs.find((p) => p.text.startsWith(t))!;

    expect(byText('Էջ').text).toBe('Էջ 3'); // field result visible, code not
    expect(byText('Էջ').lockReasons).toContain('field');
    expect(byText('Հին').lockReasons).toContain('tracked_changes');
    expect(byText('Բանաձև').lockReasons).toContain('equation');
    expect(byText('Տուփ').location).toBe('textbox');
    expect(byText('Տուփ').editable).toBe(false);
    // The VML fallback copy of the text box is not indexed twice.
    expect(doc.paragraphs.filter((p) => p.text === 'Տուփ')).toHaveLength(1);
    // The paragraph around the text box stays editable.
    expect(byText('￼Շուրջը').editable).toBe(true);

    const kinds = doc.preservation.map((p) => p.kind);
    expect(kinds).toEqual(expect.arrayContaining(['field', 'tracked_changes', 'equation', 'text_box']));
  });

  it('lists headers, comments and images; images are marked as not privacy-checked', async () => {
    const doc = await openDocx(
      await buildDocx({
        body: para(run('x')),
        header: para(run('Դպրոց, 7-րդ դասարան')),
        comments: '<w:comment w:id="0" w:author="Ուսուցիչ" w:initials="Ու">' + para(run('Ստուգել')) + '</w:comment>',
        extraParts: { 'word/media/image1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
      })
    );
    const byKind = Object.fromEntries(doc.preservation.map((p) => [p.kind, p]));
    expect(byKind.header_footer.textChecked).toBe(true);
    expect(byKind.comments.textChecked).toBe(true);
    expect(byKind.images.textChecked).toBe(false);
    expect(doc.privacy.uncheckable.map((u) => u.part)).toContain('word/media/image1.png');
    expect(doc.preservation.every((p) => p.editable === false)).toBe(true);
  });
});

describe('writeDocx without changes', () => {
  it('writes every part back byte-identical, in the same order', async () => {
    const input = await buildDocx({
      body: TEST_BODY,
      numbering: NUMBERING_DECIMAL,
      header: para(run('Վերնագիր')),
      extraParts: { 'word/media/image1.png': new Uint8Array([1, 2, 3, 4, 5]) },
    });
    const doc = await openDocx(input);
    const out = await writeDocx(doc);

    const a = await unzipParts(input);
    const b = await unzipParts(out);
    expect([...b.keys()]).toEqual([...a.keys()]);
    for (const [name, data] of a) expect(Buffer.from(b.get(name)!).equals(Buffer.from(data)), name).toBe(true);
  });

  it('keeps a byte-order mark on the main part', async () => {
    const input = await buildDocx({ body: para(run('x')), bom: true });
    const doc = await openDocx(input);
    expect(doc.mainHasBom).toBe(true);
    const out = await unzipParts(await writeDocx(doc, doc.mainXml.replace('>x<', '>y<')));
    expect([...out.get('word/document.xml')!.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});

describe('openDocx: rejected files', () => {
  const rejects = async (buf: Uint8Array, code: string) => {
    const err = await openDocx(buf).catch((e) => e);
    expect(err).toBeInstanceOf(DocxRejectedError);
    expect((err as DocxRejectedError).code).toBe(code);
  };

  it('rejects .doc / password-protected (OLE) files', async () => {
    await rejects(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), 'ole_file');
  });

  it('rejects something that is not a zip', async () => {
    await rejects(new TextEncoder().encode('hello'), 'not_zip');
  });

  it('rejects macro-enabled documents and templates', async () => {
    await rejects(await buildDocx({ body: para(run('x')), contentTypeOverride: 'application/vnd.ms-word.document.macroEnabled.main+xml' }), 'macro');
    await rejects(
      await buildDocx({ body: para(run('x')), contentTypeOverride: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml' }),
      'template'
    );
  });

  it('rejects DOCTYPE / entity declarations in any XML part', async () => {
    const evil = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>';
    await rejects(await buildDocx({ body: para(run('x')), extraParts: { 'customXml/item1.xml': evil } }), 'unsafe_xml');
  });

  it('rejects unsafe entry paths', async () => {
    const zip = await JSZip.loadAsync(await buildDocx({ body: para(run('x')) }));
    zip.file('../evil.xml', '<x/>');
    await rejects(await zip.generateAsync({ type: 'uint8array' }), 'unsafe_path');
  });

  it('rejects too many entries', async () => {
    const saved = DOCX_LIMITS.maxEntries;
    DOCX_LIMITS.maxEntries = 5;
    try {
      await rejects(await buildDocx({ body: para(run('x')), extraParts: { 'a.xml': '<a/>', 'b.xml': '<b/>', 'c.xml': '<c/>' } }), 'too_many_entries');
    } finally {
      DOCX_LIMITS.maxEntries = saved;
    }
  });

  it('rejects a part with a zip-bomb compression ratio', async () => {
    await rejects(await buildDocx({ body: para(run('x')), extraParts: { 'word/media/zero.bin': new Uint8Array(5 * 1024 * 1024) } }), 'zip_bomb');
  });
});

describe('openDocx: privacy check before anything is stored or sent', () => {
  const blocked = async (buf: Uint8Array, part: string) => {
    const err = await openDocx(buf).catch((e) => e);
    expect(err).toBeInstanceOf(PrivacyViolationError);
    expect((err as PrivacyViolationError).where).toBe(`docx:${part}`);
  };

  it('blocks a phone number in a header', async () => {
    await blocked(await buildDocx({ body: para(run('x')), header: para(run('Զանգել +374 91 234567')) }), 'word/header1.xml');
  });

  it('blocks an e-mail in the document metadata', async () => {
    const core =
      '<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>someone@example.com</dc:creator></cp:coreProperties>';
    await blocked(await buildDocx({ body: para(run('x')), core }), 'docProps/core.xml');
  });

  it('blocks a student roster in a comment', async () => {
    const comments =
      '<w:comment w:id="0" w:author="A">' + para(run('Արամ Պետրոսյան 7Բ-14')) + '</w:comment>';
    await blocked(await buildDocx({ body: para(run('x')), comments }), 'word/comments.xml');
  });

  it('passes historical names in the body', async () => {
    const doc = await openDocx(await buildDocx({ body: para(run('Տիգրան Մեծը և Արտաշես Առաջինը')) }));
    expect(doc.privacy.checkedParts).toContain('word/document.xml');
  });

  it('scans paragraph by paragraph: a class label in the title does not attach to a name in another paragraph', async () => {
    const doc = await openDocx(
      await buildDocx({ body: para(run('Թեստ, 7Բ դասարան')) + para(run('Արամ Պետրոսյան')) })
    );
    expect(doc.privacy.checkedParts).toContain('word/document.xml');
  });

  it('still blocks a name next to a class label in the same paragraph', async () => {
    await blocked(await buildDocx({ body: para(run('7Բ դասարան՝ Արամ Պետրոսյան')) }), 'word/document.xml');
  });
});
