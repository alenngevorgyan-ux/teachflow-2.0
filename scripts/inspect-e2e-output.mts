// Inspects the E2E downloads (docs/e2e): original = uploaded bytes, which paragraphs changed,
// which package parts differ and exactly where document.xml differs.
import fs from 'fs';
import crypto from 'crypto';
import { openDocx } from '../server/docx/docxModel.js';
import { unzipParts } from '../tests/docx/syntheticDocx.js';
const fixture = fs.readFileSync('docs/fixtures/Թեստ_Ավարայր_7-րդ դասարան (FIXTURE) v2.docx');
const orig = fs.readFileSync('docs/e2e/original.docx');
const corr = fs.readFileSync('docs/e2e/corrected.docx');
console.log('original download == uploaded fixture bytes:', Buffer.compare(fixture, orig) === 0, crypto.createHash('sha256').update(orig).digest('hex'));
const a = await openDocx(orig), b = await openDocx(corr);
const diff = a.paragraphs.map((p, i) => [p.text, b.paragraphs[i].text]).filter(([x, y]) => x !== y);
console.log('paragraphs', a.paragraphs.length, b.paragraphs.length, 'changed:', JSON.stringify(diff));
const pa = await unzipParts(orig), pb = await unzipParts(corr);
const changedParts = [...pa.keys()].filter((k) => !Buffer.from(pa.get(k)!).equals(Buffer.from(pb.get(k)!)));
console.log('parts', pa.size, pb.size, 'differing parts:', changedParts);
const xa = new TextDecoder().decode(pa.get('word/document.xml')), xb = new TextDecoder().decode(pb.get('word/document.xml'));
let i = 0; while (xa[i] === xb[i]) i++; let j = 0; while (xa[xa.length - 1 - j] === xb[xb.length - 1 - j]) j++;
console.log('document.xml differs only in:', JSON.stringify(xa.slice(i - 30, xa.length - j + 10)), '=>', JSON.stringify(xb.slice(i - 30, xb.length - j + 10)));
console.log('numbering labels equal:', JSON.stringify(a.paragraphs.map((p) => p.numbering?.label)) === JSON.stringify(b.paragraphs.map((p) => p.numbering?.label)));
