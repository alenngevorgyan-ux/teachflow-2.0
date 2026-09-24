import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

process.env.TEACHFLOW_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-preflight-store-'));

import { preflight } from '../../server/pilot/preflight.js';
import { readManifest } from '../../server/pilot/manifest.js';
import { buildDocx, para, run } from '../docx/syntheticDocx.js';
import { makeCase } from './helpers.js';

const errorsOf = async (dir: string) => {
  const { report, lock } = await preflight(dir);
  return { status: report.status, text: report.errors.join('\n'), report, lock };
};

describe('pilot preflight', () => {
  it('passes the synthetic example and locks every input by sha256', async () => {
    const r = await errorsOf(makeCase());
    expect(r.text).toBe('');
    expect(r.status).toBe('PREFLIGHT_PASSED');
    expect(r.lock!.inputs.map((i) => i.id).sort()).toEqual(['fact', 'program', 'teacher-doc']);
    const fact = r.report.inputs.find((i) => i.id === 'fact')!;
    expect(fact.extraction!.textSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fact.extraction!.chunkCount).toBeGreaterThan(0);
    // hashes, not text
    expect(JSON.stringify(r.report)).not.toContain('Վարդան Մամիկոնյանը');
  });

  it('missing file', async () => {
    const r = await errorsOf(makeCase((m) => (m.inputs[1].file = 'inputs/nope.txt')));
    expect(r.status).toBe('PREFLIGHT_FAILED');
    expect(r.text).toMatch(/fact: file not found/);
    expect(r.lock).toBeUndefined();
  });

  it('zero-byte file', async () => {
    const r = await errorsOf(makeCase((_m, d) => fs.writeFileSync(path.join(d, 'inputs/fact-FIXTURE.txt'), '')));
    expect(r.text).toMatch(/fact: file is empty/);
  });

  it('corrupt DOCX (not a zip)', async () => {
    const r = await errorsOf(makeCase((_m, d) => fs.writeFileSync(path.join(d, 'inputs/teacher-test-FIXTURE.docx'), 'not a zip at all, just text')));
    expect(r.status).toBe('PREFLIGHT_FAILED');
    expect(r.text).toMatch(/teacher-doc: extension "\.docx" but the content looks like/);
  });

  it('unsupported file type', async () => {
    const r = await errorsOf(
      makeCase((m, d) => {
        fs.writeFileSync(path.join(d, 'inputs/fact.rtf'), '{\\rtf1 synthetic}');
        m.inputs[1].file = 'inputs/fact.rtf';
      })
    );
    expect(r.text).toMatch(/unsupported file type "\.rtf"/);
  });

  it('teacher document that is a PDF', async () => {
    const r = await errorsOf(
      makeCase((m, d) => {
        fs.writeFileSync(path.join(d, 'inputs/t.pdf'), '%PDF-1.4\n%synthetic\n');
        m.inputs[2].file = 'inputs/t.pdf';
      })
    );
    expect(r.text).toMatch(/teacher document must be a \.docx/);
  });

  it('duplicate bytes under two inputs', async () => {
    const r = await errorsOf(
      makeCase((m, d) => {
        fs.copyFileSync(path.join(d, 'inputs/fact-FIXTURE.txt'), path.join(d, 'inputs/fact-copy.txt'));
        m.inputs.push({ ...m.inputs[1], id: 'fact2', file: 'inputs/fact-copy.txt' });
      })
    );
    expect(r.text).toMatch(/fact2: same bytes as input "fact"/);
  });

  it('same file name with different bytes', async () => {
    const r = await errorsOf(
      makeCase((m, d) => {
        fs.mkdirSync(path.join(d, 'inputs/other'));
        fs.writeFileSync(path.join(d, 'inputs/other/fact-FIXTURE.txt'), 'FIXTURE — another synthetic passage, different bytes.');
        m.inputs.push({ ...m.inputs[1], id: 'fact2', file: 'inputs/other/fact-FIXTURE.txt' });
      })
    );
    expect(r.text).toMatch(/file name "fact-FIXTURE.txt" is also used by input "fact" with different bytes/);
  });

  it('source without metadata', async () => {
    const r = await errorsOf(makeCase((m) => delete m.inputs[1].source));
    expect(r.text).toMatch(/fact: source metadata .* is required/);
  });

  it('program registered as a fact source', async () => {
    const r = await errorsOf(makeCase((m) => (m.inputs[1].source.docType = 'subject_program')));
    expect(r.text).toMatch(/use role PROGRAM_SOURCE/);
  });

  it('unknown role', async () => {
    const r = await errorsOf(makeCase((m) => (m.inputs[1].role = 'TEXTBOOK')));
    expect(r.text).toMatch(/unknown role "TEXTBOOK"/);
  });

  it('no teacher document / two teacher documents', async () => {
    expect((await errorsOf(makeCase((m) => m.inputs.pop()))).text).toMatch(/exactly one TEACHER_DOCUMENT is required \(found 0\)/);
    const two = await errorsOf(
      makeCase((m, d) => {
        fs.writeFileSync(path.join(d, 'inputs/t2.docx'), fs.readFileSync(path.join(d, 'inputs/teacher-test-FIXTURE.docx')));
        m.inputs.push({ ...m.inputs[2], id: 't2', file: 'inputs/t2.docx' });
      })
    );
    expect(two.text).toMatch(/found 2/);
  });

  it('file outside the case directory', async () => {
    const r = await errorsOf(makeCase((m) => (m.inputs[1].file = '../../etc/hosts')));
    expect(r.text).toMatch(/inside the case directory/);
  });

  it('teacher DOCX with personal data is refused without echoing the data', async () => {
    const dir = makeCase();
    fs.writeFileSync(path.join(dir, 'inputs/teacher-test-FIXTURE.docx'), await buildDocx({ body: para(run('Հարց 1')), header: para(run('Զանգել +374 91 234567')) }));
    const p = await errorsOf(dir);
    expect(p.status).toBe('PREFLIGHT_FAILED');
    expect(p.text).toMatch(/TeachFlow would reject this DOCX/);
    expect(p.text).toMatch(/personal data found: phone/);
    expect(JSON.stringify(p.report)).not.toContain('234567');
  });

  it('images in the teacher DOCX need an explicit no-student-data statement', async () => {
    const dir = makeCase((m) => delete m.inputs[2].noStudentDataDeclared);
    fs.writeFileSync(
      path.join(dir, 'inputs/teacher-test-FIXTURE.docx'),
      await buildDocx({ body: para(run('Հարց 1. Ե՞րբ է տեղի ունեցել ճակատամարտը։')), extraParts: { 'word/media/image1.png': new Uint8Array([137, 80, 78, 71]) } })
    );
    expect((await errorsOf(dir)).text).toMatch(/cannot be privacy-checked/);
  });
});

describe('pilot manifest', () => {
  it('rejects fixture mode and synthetic automation for a real case', () => {
    const dir = makeCase((m) => (m.synthetic = false));
    const { manifest, errors } = readManifest(dir);
    expect(manifest).toBeUndefined();
    expect(errors.join('\n')).toMatch(/fixture" is only allowed for synthetic cases/);
    expect(errors.join('\n')).toMatch(/syntheticAutomation is only allowed for synthetic cases/);
  });

  it('rejects unfilled template placeholders', () => {
    const dir = makeCase((m) => (m.operator = '<FILL: name>'));
    expect(readManifest(dir).errors.join('\n')).toMatch(/unfilled placeholder/);
  });

  it('the committed template is not accepted as is', () => {
    const dir = makeCase();
    fs.copyFileSync(path.resolve('pilot/case-template/manifest.example.json'), path.join(dir, 'manifest.json'));
    expect(readManifest(dir).manifest).toBeUndefined();
  });

  it('duplicate input ids', () => {
    const dir = makeCase((m) => (m.inputs[1].id = 'program'));
    expect(readManifest(dir).errors.join('\n')).toMatch(/used twice/);
  });
});

describe('pilot preflight: source text privacy', () => {
  it('reports the kind of personal data in a source, never the value', async () => {
    const dir = makeCase();
    fs.appendFileSync(path.join(dir, 'inputs/fact-FIXTURE.txt'), '\nԱրամ Պետրոսյան 7Բ-14\n');
    const { report } = await preflight(dir);
    const fact = report.inputs.find((i) => i.id === 'fact')!;
    expect(fact.warnings.join(' ')).toMatch(/Privacy guard would block this text: full_name/);
    expect(JSON.stringify(report)).not.toContain('Պետրոսյան');
  });
});
