// Pilot tool: render the original and the corrected DOCX with a real word
// processor and compare pagination.
//
//   npx tsx scripts/docx-layout-check.ts original.docx corrected.docx [out-dir]
//
// Renderer: LibreOffice (soffice) if installed, otherwise Microsoft Word on
// macOS via AppleScript (Word opens while it runs). Writes both PDFs and a
// JSON report into out-dir so a person can look at the pages.
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDocx } from '../server/docx/docxModel.js';
import { comparePagination } from '../server/docx/layoutCompare.js';

function which(cmd: string): string | null {
  try {
    return execFileSync('which', [cmd], { encoding: 'utf-8' }).trim() || null;
  } catch {
    return null;
  }
}

function renderWithSoffice(soffice: string, docx: string, outDir: string): string {
  execFileSync(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, docx], { stdio: 'inherit' });
  return path.join(outDir, path.basename(docx).replace(/\.docx$/i, '.pdf'));
}

function renderWithWord(docx: string, outPdf: string): string {
  // Word is sandboxed: work inside its container so no access prompt is needed.
  const box = path.join(os.homedir(), 'Library/Containers/com.microsoft.Word/Data/tmp/teachflow-layout');
  fs.mkdirSync(box, { recursive: true });
  const inBox = path.join(box, path.basename(docx));
  const pdfBox = inBox.replace(/\.docx$/i, '.pdf');
  fs.copyFileSync(docx, inBox);
  const script = `
    tell application "Microsoft Word"
      open POSIX file "${inBox}"
      set d to active document
      save as d file name "${pdfBox}" file format format PDF
      close d saving no
    end tell`;
  execFileSync('osascript', ['-e', script], { stdio: 'inherit' });
  fs.copyFileSync(pdfBox, outPdf);
  return outPdf;
}

async function pdfPages(pdf: string): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdf)), useWorkerFetch: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    pages.push(c.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  return pages;
}

async function main() {
  const [a, b, out = fs.mkdtempSync(path.join(os.tmpdir(), 'teachflow-layout-'))] = process.argv.slice(2);
  if (!a || !b) {
    console.error('usage: npx tsx scripts/docx-layout-check.ts original.docx corrected.docx [out-dir]');
    process.exit(2);
  }
  fs.mkdirSync(out, { recursive: true });
  const soffice = which('soffice') ?? which('libreoffice');
  const render = (docx: string, name: string) => {
    const copy = path.join(out, `${name}.docx`);
    fs.copyFileSync(docx, copy);
    if (soffice) return renderWithSoffice(soffice, copy, out);
    if (process.platform === 'darwin' && fs.existsSync('/Applications/Microsoft Word.app')) return renderWithWord(copy, path.join(out, `${name}.pdf`));
    throw new Error('No renderer: install LibreOffice, or run on macOS with Microsoft Word.');
  };
  const pdfA = render(a, 'original');
  const pdfB = render(b, 'corrected');

  // The accepted edits, from the documents themselves (paragraph text before -> after).
  const [da, db] = [await openDocx(fs.readFileSync(a)), await openDocx(fs.readFileSync(b))];
  const replacements = da.paragraphs
    .map((p, i) => ({ expected: p.text, replacement: db.paragraphs[i]?.text ?? '' }))
    .filter((r) => r.expected !== r.replacement);

  const report = {
    renderer: soffice ? `LibreOffice (${soffice})` : 'Microsoft Word (macOS)',
    original: pdfA,
    corrected: pdfB,
    ...comparePagination(await pdfPages(pdfA), await pdfPages(pdfB), replacements),
  };
  fs.writeFileSync(path.join(out, 'layout-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
