import { describe, expect, it } from 'vitest';
import { DocxDocument, openDocx } from '../../server/docx/docxModel.js';
import { DocxWorkingCopy, PatchGroup, TextPatch } from '../../server/docx/patch.js';
import { NUMBERING_DECIMAL, buildDocx, numbered, para, run, unzipParts } from './syntheticDocx.js';

const TABLE =
  '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="4675"/><w:gridCol w:w="4675"/></w:tblGrid>' +
  '<w:tr w:rsidR="00B1C2D3"><w:tc><w:tcPr><w:tcW w:w="4675" w:type="dxa"/></w:tcPr>' + para(run('Հարց')) + '</w:tc>' +
  '<w:tc><w:tcPr><w:tcW w:w="4675" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/></w:tcPr>' + para(run('Պատասխան՝ բ')) + '</w:tc></w:tr></w:tbl>';

const BODY =
  para(run('Թեստ', '<w:b/><w:sz w:val="32"/>')) +
  numbered(run('Ո՞վ էր ') + run('Տիգրան', '<w:i/>') + run(' Մեծը:')) +
  numbered(run('ա) 95 թ.') + '<w:r><w:tab/></w:r>' + run('բ) 55 թ.')) +
  numbered(run('Ե՞րբ է տեղի ունեցել Ավարայրի ճակատամարտը:')) +
  TABLE +
  para(run('Էջ ') + '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' + run('1') + '<w:r><w:fldChar w:fldCharType="end"/></w:r>');

async function setup(): Promise<{ input: Buffer; doc: DocxDocument; w: DocxWorkingCopy; id: (text: string) => string }> {
  const input = await buildDocx({ body: BODY, numbering: NUMBERING_DECIMAL });
  const doc = await openDocx(input);
  const w = new DocxWorkingCopy(doc);
  const id = (text: string) => doc.paragraphs.find((p) => p.text.includes(text))!.id;
  return { input, doc, w, id };
}

function group(id: string, ...patches: TextPatch[]): PatchGroup {
  return { id, patches };
}

function patchAt(w: DocxWorkingCopy, pid: string, find: string, replacement: string, id = `x-${find}`): TextPatch {
  const text = w.paragraphText(pid)!;
  const start = text.indexOf(find);
  if (start < 0) throw new Error(`"${find}" not in "${text}"`);
  return w.makePatch(id, pid, start, start + find.length, replacement);
}

describe('DocxWorkingCopy: edits', () => {
  it('replaces text inside one run and changes nothing else in the XML', async () => {
    const { doc, w, id } = await setup();
    const pid = id('Ավարայրի');
    const r = w.applyGroup(group('g1', patchAt(w, pid, 'Ավարայրի', 'Ավարայրի (451 թ.)')));
    expect(r.ok).toBe(true);

    const before = doc.mainXml;
    const after = w.toMainXml();
    // Only the one w:t element differs: common prefix up to it, common suffix after it.
    const seg = doc.paragraphs.find((p) => p.id === pid)!.segments[0] as { el: { start: number; end: number } };
    expect(after.slice(0, seg.el.start)).toBe(before.slice(0, seg.el.start));
    const tail = before.length - seg.el.end;
    expect(after.slice(after.length - tail)).toBe(before.slice(before.length - tail));
    expect(w.paragraphText(pid)).toBe('Ե՞րբ է տեղի ունեցել Ավարայրի (451 թ.) ճակատամարտը:');
  });

  it('refuses an edit across runs with different formatting (policy: no silent formatting change)', async () => {
    const { w, id } = await setup();
    const pid = id('Տիգրան');
    const r = w.applyGroup(group('g', patchAt(w, pid, 'էր Տիգրան Մ', 'էր Արտաշես Մ')));
    expect(!r.ok && r.errors[0].code).toBe('mixed_formatting');
    expect(w.toMainXml()).toBe(w.doc.mainXml);
  });

  it('edits across runs that Word split without any formatting difference; the text goes into the first run', async () => {
    const body = para(run('Ավարայրի ', '<w:lang w:val="hy-AM"/>') + run('ճակատա', '<w:lang w:val="hy-AM"/>') + run('մարտը', '<w:lang w:val="hy-AM"/>'));
    const doc = await openDocx(await buildDocx({ body }));
    const w = new DocxWorkingCopy(doc);
    const pid = doc.paragraphs[0].id;
    const r = w.applyGroup(group('g', w.makePatch('x', pid, 9, 20, 'պատերազմը')));
    expect(r.ok).toBe(true);
    expect(w.paragraphText(pid)).toBe('Ավարայրի պատերազմը');
    const xml = w.toMainXml();
    expect(xml).toContain('<w:rPr><w:lang w:val="hy-AM"/></w:rPr><w:t xml:space="preserve">պատերազմը</w:t>');
    // Emptied runs stay (with their properties) rather than being removed.
    expect(xml.match(/<w:t xml:space="preserve"><\/w:t>/g)).toHaveLength(1);
  });

  it('inserts at a boundary into the run before the point', async () => {
    const { w, id } = await setup();
    const pid = id('Տիգրան');
    const text = w.paragraphText(pid)!;
    const at = text.indexOf('Տիգրան') + 'Տիգրան'.length;
    expect(w.applyGroup(group('g', w.makePatch('i', pid, at, at, ' Բ'))).ok).toBe(true);
    expect(w.paragraphText(pid)).toBe('Ո՞վ էր Տիգրան Բ Մեծը:');
    expect(w.toMainXml()).toContain('<w:rPr><w:i/></w:rPr><w:t xml:space="preserve">Տիգրան Բ</w:t>');
  });

  it('edits a table cell without touching the table structure or cell shading', async () => {
    const { doc, w, id } = await setup();
    const pid = id('Պատասխան');
    expect(w.applyGroup(group('g', patchAt(w, pid, 'բ', 'ա'))).ok).toBe(true);
    const xml = w.toMainXml();
    for (const piece of ['<w:tblGrid><w:gridCol w:w="4675"/><w:gridCol w:w="4675"/></w:tblGrid>', '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>']) {
      expect(xml).toContain(piece);
      expect(doc.mainXml).toContain(piece);
    }
    expect(w.paragraphText(pid)).toBe('Պատասխան՝ ա');
  });

  it('escapes XML special characters in the replacement', async () => {
    const { w, id } = await setup();
    const pid = id('Ավարայրի');
    expect(w.applyGroup(group('g', patchAt(w, pid, 'Ավարայրի', 'A < B & C > D'))).ok).toBe(true);
    expect(w.toMainXml()).toContain('A &lt; B &amp; C &gt; D');
    const out = await openDocx(await w.export());
    expect(out.paragraphs.find((p) => p.id.startsWith('p0003'))!.text).toContain('A < B & C > D');
  });
});

describe('DocxWorkingCopy: refusals', () => {
  it('refuses a paragraph that cannot be edited (field)', async () => {
    const { w, id } = await setup();
    const r = w.applyGroup(group('g', patchAt(w, id('Էջ'), 'Էջ', 'Էջը')));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe('paragraph_locked');
  });

  it('refuses a range that covers a tab', async () => {
    const { w, id } = await setup();
    const pid = id('95 թ.');
    const r = w.applyGroup(group('g', patchAt(w, pid, 'թ.\tբ', 'թ. բ')));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe('touches_non_text');
  });

  it('refuses a replacement with a line break or tab', async () => {
    const { w, id } = await setup();
    const r = w.applyGroup(group('g', patchAt(w, id('Ավարայրի'), 'Ավարայրի', 'Ավա\nրայրի')));
    expect(!r.ok && r.errors[0].code).toBe('unsupported_replacement');
  });

  it('refuses a replacement that carries personal data', async () => {
    const { w, id } = await setup();
    const r = w.applyGroup(group('g', patchAt(w, id('Ավարայրի'), 'Ավարայրի', 'զանգել +374 91 234567')));
    expect(!r.ok && r.errors[0].code).toBe('privacy');
  });

  it('refuses a patch whose expected text is not at the offsets', async () => {
    const { w, id } = await setup();
    const p = patchAt(w, id('Ավարայրի'), 'Ավարայրի', 'X');
    const r = w.applyGroup(group('g', { ...p, start: p.start + 1, end: p.end + 1 }));
    expect(!r.ok && r.errors[0].code).toBe('expected_mismatch');
  });

  it('refuses overlapping patches in one group', async () => {
    const { w, id } = await setup();
    const pid = id('Ավարայրի');
    const r = w.applyGroup(group('g', patchAt(w, pid, 'Ավարայրի', 'A', 'a'), patchAt(w, pid, 'րայրի ճակ', 'B', 'b')));
    expect(!r.ok && r.errors.map((e) => e.code)).toEqual(['overlap']);
  });

  it('applies non-overlapping patches of one group in the same paragraph against the same base', async () => {
    const { w, id } = await setup();
    const pid = id('Ավարայրի');
    const r = w.applyGroup(group('g', patchAt(w, pid, 'Ե՞րբ', 'Ո՞ր թվականին', 'a'), patchAt(w, pid, 'ճակատամարտը', 'ճակատամարտը (451)', 'b')));
    expect(r.ok).toBe(true);
    expect(w.paragraphText(pid)).toBe('Ո՞ր թվականին է տեղի ունեցել Ավարայրի ճակատամարտը (451):');
  });

  it('is atomic: one invalid patch means nothing in the group is applied', async () => {
    const { w, id } = await setup();
    const good = patchAt(w, id('Ավարայրի'), 'Ավարայրի', 'Ավարայրի (451)', 'good');
    const bad = patchAt(w, id('Էջ'), 'Էջ', 'Էջը', 'bad');
    const rev = w.revision;
    const r = w.applyGroup(group('g', good, bad));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.patchId)).toEqual(['bad']);
    expect(w.revision).toBe(rev);
    expect(w.paragraphText(id('Ավարայրի'))).toBe('Ե՞րբ է տեղի ունեցել Ավարայրի ճակատամարտը:');
    expect(w.toMainXml()).toBe(w.doc.mainXml);
  });

  it('marks a patch stale once its paragraph changed, but keeps patches on other paragraphs valid', async () => {
    const { w, id } = await setup();
    const avarayr = id('Ավարայրի');
    const tigran = id('Տիգրան');
    const first = patchAt(w, avarayr, 'Ավարայրի', 'Ավարայրի (451)', 'first');
    const sameParaLater = patchAt(w, avarayr, 'ճակատամարտը', 'ճակատամարտը!', 'same');
    const otherPara = patchAt(w, tigran, 'Տիգրան', 'Արտաշես', 'other');

    expect(w.applyGroup(group('g1', first)).ok).toBe(true);
    expect(w.checkPatch(sameParaLater)?.code).toBe('stale');
    expect(w.checkPatch(otherPara)).toBeNull();
    expect(otherPara.baseRevision).not.toBe(w.revision);
    expect(w.applyGroup(group('g2', otherPara)).ok).toBe(true);
  });

  it('changes the revision id with every applied group', async () => {
    const { w, id } = await setup();
    const r0 = w.revision;
    w.applyGroup(group('g1', patchAt(w, id('Ավարայրի'), 'Ավարայրի', 'A')));
    const r1 = w.revision;
    w.applyGroup(group('g2', patchAt(w, id('Տիգրան'), 'Տիգրան', 'B')));
    expect(new Set([r0, r1, w.revision]).size).toBe(3);
    expect(w.revision.startsWith('r2-')).toBe(true);
  });
});

describe('DocxWorkingCopy.export', () => {
  it('keeps every other part byte-identical and numbering labels unchanged', async () => {
    const { input, doc, w, id } = await setup();
    w.applyGroup(group('g', patchAt(w, id('Տիգրան'), 'Մեծը', 'Առաջինը')));
    const out = await w.export();

    const a = await unzipParts(input);
    const b = await unzipParts(out);
    expect([...b.keys()]).toEqual([...a.keys()]);
    for (const [name, data] of a) {
      if (name === 'word/document.xml') continue;
      expect(Buffer.from(b.get(name)!).equals(Buffer.from(data)), name).toBe(true);
    }
    const reopened = await openDocx(out);
    expect(reopened.paragraphs.map((p) => p.numbering?.label)).toEqual(doc.paragraphs.map((p) => p.numbering?.label));
    expect(reopened.paragraphs.map((p) => p.editable)).toEqual(doc.paragraphs.map((p) => p.editable));
  });

  it('with no accepted groups, returns exactly the uploaded bytes', async () => {
    const { input, w } = await setup();
    expect(Buffer.compare(await w.export(), input)).toBe(0);
  });
});

describe('DocxWorkingCopy: explicit spans and Unicode', () => {
  it('an explicit span disambiguates text that occurs twice', async () => {
    const doc = await openDocx(await buildDocx({ body: para(run('Այո, Այո')) }));
    const w = new DocxWorkingCopy(doc);
    const pid = doc.paragraphs[0].id;
    expect(w.applyGroup(group('g', w.makePatch('second', pid, 5, 8, 'Ոչ'))).ok).toBe(true);
    expect(w.paragraphText(pid)).toBe('Այո, Ոչ');
  });

  it('never splits a surrogate pair; combining sequences are edited as whole units by the caller', async () => {
    const doc = await openDocx(await buildDocx({ body: para(run('Ա𝒜Բ և ե́')) }));
    const w = new DocxWorkingCopy(doc);
    const pid = doc.paragraphs[0].id;
    // 𝒜 is two UTF-16 units at [1,3); a boundary at 2 would split it.
    const split = w.makePatch('s', pid, 1, 2, 'x');
    expect(w.checkPatch(split)?.code).toBe('splits_character');
    expect(w.applyGroup(group('g', w.makePatch('ok', pid, 1, 3, 'B'))).ok).toBe(true);
    expect(w.paragraphText(pid)).toBe('ԱBԲ և ե́');
    // և (one code point) and ե + combining acute survive a nearby edit untouched.
    const out = await openDocx(await w.export());
    expect(out.paragraphs[0].text).toBe('ԱBԲ և ե́');
  });
});
