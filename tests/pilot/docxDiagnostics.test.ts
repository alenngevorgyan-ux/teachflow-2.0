import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { docxDiagnostics } from '../../server/pilot/docxDiagnostics.js';
import { NUMBERING_DECIMAL, buildDocx, numbered, para, run } from '../docx/syntheticDocx.js';

const good = () => buildDocx({ numbering: NUMBERING_DECIMAL, body: para(run('Թեստ. Ավարայրի ճակատամարտ')) + numbered(run('Ե՞րբ է տեղի ունեցել ճակատամարտը։')) });

describe('pilot DOCX diagnostics (structural facts, not rendering)', () => {
  it('a sound document: opens, relationships resolve, page setup and expected text recorded', async () => {
    const d = await docxDiagnostics(await good(), ['Ավարայրի ճակատամարտ']);
    expect(d.zipOk).toBe(true);
    expect(d.openedByTeachFlow).toBe(true);
    expect(d.missingRelationshipTargets).toEqual([]);
    expect(d.sections[0]).toMatchObject({ pageWidthTwips: 11906, pageHeightTwips: 16838 });
    expect(d.expected).toEqual([{ text: 'Ավարայրի ճակատամարտ', present: true }]);
    expect(d.suspiciousEmpty).toBe(false);
    expect(d.renderedPreview).toMatch(/^NOT_RUN/);
  });

  it('corrupt bytes are reported, not thrown', async () => {
    const d = await docxDiagnostics(Buffer.from('definitely not a zip'));
    expect(d.zipOk).toBe(false);
    expect(d.openedByTeachFlow).toBe(false);
    expect(d.error).toBeTruthy();
  });

  it('a relationship pointing at a missing part is reported', async () => {
    const zip = await JSZip.loadAsync(await good());
    zip.remove('word/numbering.xml');
    const d = await docxDiagnostics(Buffer.from(await zip.generateAsync({ type: 'uint8array' })));
    expect(d.missingRelationshipTargets.join()).toMatch(/numbering\.xml/);
  });

  it('expected text that is missing is reported', async () => {
    const d = await docxDiagnostics(await good(), ['Վարդան Մամիկոնյան']);
    expect(d.expected[0].present).toBe(false);
  });

  it('an (almost) empty document is suspicious', async () => {
    const d = await docxDiagnostics(await buildDocx({ body: para(run('x')) }));
    expect(d.suspiciousEmpty).toBe(true);
  });
});
