// End-to-end flow on a SYNTHETIC document with fake model / judge / retrieval:
// upload DOCX -> select sources -> split into questions -> confirm -> check ->
// suggest -> accept (with re-check) / reject -> export DOCX + change list.
// Real sources and real teacher files are separate, still-open criteria.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumOutcome, MaterialReview, MethodRule, Source } from '../../shared/types.js';

const store = vi.hoisted(() => ({
  reviews: new Map<string, MaterialReview>(),
  files: new Map<string, Uint8Array>(),
  sources: [] as Source[],
  outcomes: [] as CurriculumOutcome[],
  rules: [] as MethodRule[],
}));

vi.mock('../../server/store/repository.js', () => ({
  repository: {
    getMaterialReview: (id: string) => store.reviews.get(id),
    getMaterialReviews: () => [...store.reviews.values()],
    saveMaterialReview: (r: MaterialReview) => {
      store.reviews.set(r.id, structuredClone(r));
      return r;
    },
    saveMaterialFile: (sha: string, data: Uint8Array) => store.files.set(sha, data),
    getMaterialFile: (sha: string) => store.files.get(sha),
    getSource: (id: string) => store.sources.find((s) => s.id === id),
    getSources: () => store.sources,
    getOutcomes: () => store.outcomes,
    getActiveRules: () => store.rules.filter((r) => r.active),
    logAIInteraction: () => undefined,
  },
}));

import { openDocx } from '../../server/docx/docxModel.js';
import { buildChangeList, exportReviewDocx } from '../../server/materials/exportReview.js';
import {
  ReviewDeps,
  confirmSegmentation,
  createReview,
  decide,
  getReview,
  reviewStatus,
  runChecks,
  segment,
  selectSources,
  setTeacherKey,
  suggest,
} from '../../server/materials/reviewService.js';
import { UserInputError } from '../../server/pipeline/errors.js';
import { confirmSource, sourceContentHash } from '../../server/pipeline/sourceConfirmation.js';
import type { RetrievedChunk } from '../../server/pipeline/retrieval.js';
import type { IJudgeProvider } from '../../server/providers/judgeProvider.js';
import type { IModelProvider } from '../../server/providers/modelProvider.js';
import { NUMBERING_DECIMAL, buildDocx, numbered, para, run, unzipParts } from '../docx/syntheticDocx.js';

// ---------------------------------------------------------------- fixtures

const SUBJECT = 'Հայոց պատմություն';

const BODY =
  para(run('Թեստ', '<w:b/>')) +
  numbered(run('Ե՞րբ է տեղի ունեցել Ավարայրի ճակատամարտը:')) +
  para(run('ա) 451 թ.') + '<w:r><w:tab/></w:r>' + run('բ) 301 թ.') + '<w:r><w:tab/></w:r>' + run('գ) 387 թ.')) +
  numbered(run('Ո՞վ էր հայոց զորավարը Ավարայրի ճակատամարտում:')) +
  para(run('ա) Վարդան Մամիկոնյան')) +
  para(run('բ) Տիգրան Մեծ')) +
  para(run('գ) Արտաշես Առաջին')) +
  para(run('Պատասխաններ', '<w:b/>')) +
  para(run('1-ա, 2-գ'));

function src(id: string, overrides: Partial<Source>): Source {
  const s: Source = {
    id,
    title: id,
    authority: 'test',
    docType: 'textbook',
    subject: SUBJECT,
    grades: [7],
    role: 'FACT',
    version: 'v1',
    effectiveFrom: '2026-09-01',
    status: 'active',
    sha256: id,
    isDemo: false,
    uploadedAt: '2026-09-01',
    chunks: [],
    ...overrides,
  };
  return s;
}

function confirmed(s: Source): Source {
  return confirmSource(s, { confirmedByName: 'Test methodologist', expectedVersion: s.version, expectedContentHash: sourceContentHash(s) });
}

const FACT_TEXT = 'Ավարայրի ճակատամարտը տեղի է ունեցել 451 թվականին: Հայոց զորքը գլխավորում էր Վարդան Մամիկոնյանը:';

function chunk(): RetrievedChunk {
  return {
    chunk: { id: 'fact-1#p12#c1', sourceId: 'fact-1', page: 12, text: FACT_TEXT },
    sourceId: 'fact-1',
    sourceTitle: 'fact-1',
    sourceRole: 'FACT',
    version: 'v1',
    score: 0.9,
  };
}

// Paragraph ids depend on text hashes; the fake model reads them from the prompt.
function idOf(prompt: string, text: string): string {
  const line = prompt.split('\n').find((l) => l.includes(text));
  const m = line && /\[(p\d{4}-[0-9a-f]{8})\]/.exec(line);
  if (!m) throw new Error(`fake model: no paragraph with «${text}»`);
  return m[1];
}

interface FakeState {
  keyedTwo: string; // what the judge thinks about question 2
  failSuggest?: boolean;
  scopeThrows?: boolean;
}

function fakes(state: FakeState): ReviewDeps {
  const provider: IModelProvider = {
    providerId: 'fake',
    defaultModelId: 'fake-model',
    generateText: vi.fn() as unknown as IModelProvider['generateText'],
    generateStructured: (async (prompt: string, schema: { parse: (x: unknown) => unknown }, options?: { actionName?: string }) => {
      let output: unknown;
      switch (options?.actionName) {
        case 'material:segment':
          output = {
            items: [
              {
                number: '1.',
                type: 'single_choice',
                stemParagraphIds: [idOf(prompt, 'Ավարայրի ճակատամարտը:')],
                options: [
                  { label: 'ա)', paragraphId: idOf(prompt, '451 թ.'), text: 'ա) 451 թ.' },
                  { label: 'բ)', paragraphId: idOf(prompt, '451 թ.'), text: 'բ) 301 թ.' },
                  { label: 'գ)', paragraphId: idOf(prompt, '451 թ.'), text: 'գ) 387 թ.' },
                ],
              },
              {
                number: '2.',
                type: 'single_choice',
                stemParagraphIds: [idOf(prompt, 'զորավարը')],
                options: [
                  { label: 'ա)', paragraphId: idOf(prompt, 'Վարդան'), text: 'ա) Վարդան Մամիկոնյան' },
                  { label: 'բ)', paragraphId: idOf(prompt, 'Տիգրան'), text: 'բ) Տիգրան Մեծ' },
                  { label: 'գ)', paragraphId: idOf(prompt, 'Արտաշես'), text: 'գ) Արտաշես Առաջին' },
                  // Invented text: must be dropped by the deterministic check.
                  { label: 'դ)', paragraphId: idOf(prompt, 'Արտաշես'), text: 'դ) Աշոտ Երկաթ' },
                ],
              },
              // A heading claimed as a question AND by the key: dropped.
              { number: '3', type: 'open', stemParagraphIds: [idOf(prompt, '1-ա, 2-գ')], options: [] },
            ],
            answerKey: {
              paragraphIds: [idOf(prompt, '1-ա, 2-գ')],
              entries: [
                { itemNumber: '1', optionLabels: ['ա'], paragraphId: idOf(prompt, '1-ա, 2-գ'), quote: '1-ա' },
                { itemNumber: '2', optionLabels: ['գ'], paragraphId: idOf(prompt, '1-ա, 2-գ'), quote: '2-գ' },
              ],
            },
          };
          break;
        case 'material:program_scope':
          if (state.scopeThrows) throw new Error('provider out of credits');
          output = { verdict: 'in_scope', outcomeCodes: ['HP-7-1'], reason: 'Ծրագրում է', confidence: 0.95 };
          break;
        case 'material:answer_unambiguous': {
          const q2 = prompt.includes('զորավարը');
          const keyed = /Answer key given by the teacher: (.*)/.exec(prompt)?.[1] ?? '';
          if (q2 && !keyed.includes('Վարդան')) {
            output = { verdict: 'single_correct', defensibleLabels: ['ա'], reason: 'Աղբյուրը նշում է Վարդան Մամիկոնյանին', confidence: 0.95 };
          } else {
            output = { verdict: 'single_correct', defensibleLabels: [q2 ? 'ա' : 'ա'], reason: 'Համապատասխանում է', confidence: 0.95 };
          }
          break;
        }
        case 'material:suggest_fix':
          if (state.failSuggest) throw new Error('model down');
          output = {
            suggestions: [
              {
                addresses: ['answer_unambiguous', 'fact_support'],
                edits: [{ paragraphId: idOf(prompt, '1-ա, 2-գ'), find: '2-գ', replacement: '2-ա' }],
                keyChange: { optionLabels: ['ա'] },
                rationale: 'Ճիշտ պատասխանը Վարդան Մամիկոնյանն է',
                evidence: [{ chunkId: 'fact-1#p12#c1', quote: 'Հայոց զորքը գլխավորում էր Վարդան Մամիկոնյանը' }],
              },
              {
                // Evidence that is not in the passage: must be dropped.
                addresses: ['fact_support'],
                edits: [{ paragraphId: idOf(prompt, 'զորավարը'), find: 'զորավարը', replacement: 'սպարապետը' }],
                keyChange: null,
                rationale: 'x',
                evidence: [{ chunkId: 'fact-1#p12#c1', quote: 'Վարդանը սպարապետ էր' }],
              },
            ],
          };
          break;
        default:
          throw new Error(`fake provider: unexpected ${options?.actionName}`);
      }
      return { output: schema.parse(output), providerId: 'fake', modelId: 'fake-model', latencyMs: 1, requestId: 'req' };
    }) as unknown as IModelProvider['generateStructured'],
  };
  const judge: IJudgeProvider = {
    providerId: 'fake-judge',
    modelId: 'fake-judge-model',
    classify: vi.fn() as unknown as IJudgeProvider['classify'],
    verifyClaim: async (claim: string) => {
      if (claim.includes('զորավարը') && !/Answer key: .*Վարդան/.test(claim)) {
        return { verdict: 'not_supported', probability: 0.1, confidence: 0.95, reason: 'Աղբյուրը նշում է Վարդան Մամիկոնյանին' };
      }
      return { verdict: 'supported', probability: 0.95, confidence: 0.95, reason: 'Հաստատված է' };
    },
  };
  return { provider, judge, retrieve: async () => ({ factChunks: [chunk()], methodChunks: [], usedSemanticSearch: false }) };
}

async function upload(body = BODY): Promise<MaterialReview> {
  const bytes = await buildDocx({ body, numbering: NUMBERING_DECIMAL });
  return createReview({ fileName: 'Ավարայր թեստ.docx', subject: SUBJECT, grade: '7', bytes: new Uint8Array(bytes) });
}

beforeEach(() => {
  store.reviews.clear();
  store.files.clear();
  store.sources = [
    confirmed(src('program-1', { docType: 'subject_program', role: 'FACT' })),
    confirmed(src('fact-1', { docType: 'textbook', role: 'FACT' })),
    src('fact-unconfirmed', { docType: 'textbook' }),
    confirmed(src('fact-grade-8', { grades: [8] })),
  ];
  store.outcomes = [
    { code: 'HP-7-1', text: 'Ավարայրի ճակատամարտի նշանակությունը', subject: SUBJECT, grade: 7, standardVersion: 'v1', sourceId: 'program-1', confirmed: true },
  ];
  store.rules = [{ id: 'rule-min-options', title: 'min', description: '', kind: 'deterministic', params: { min_options: 3 }, severity: 'error', active: true }];
});

async function readyForChecks(state: FakeState = { keyedTwo: 'գ' }) {
  const deps = fakes(state);
  let r = await upload();
  r = selectSources(r.id, ['program-1'], ['fact-1']);
  r = await segment(r.id, deps);
  r = confirmSegmentation(r.id, r.revision);
  return { r, deps };
}

// ------------------------------------------------------------------- tests

describe('material review: upload and sources', () => {
  it('stores the file only after it opened and passed the privacy check', async () => {
    const r = await upload();
    expect(store.files.has(r.fileSha256)).toBe(true);
    expect(r.revision).toBe(`r0-${r.fileSha256.slice(0, 12)}`);
  });

  it('requires subject and grade (no defaults) and a .docx name', async () => {
    const bytes = new Uint8Array(await buildDocx({ body: BODY }));
    await expect(createReview({ fileName: 'x.docx', subject: '', grade: '7', bytes })).rejects.toThrow(UserInputError);
    await expect(createReview({ fileName: 'x.docx', subject: SUBJECT, grade: true, bytes })).rejects.toThrow(UserInputError);
    await expect(createReview({ fileName: 'x.pdf', subject: SUBJECT, grade: '7', bytes })).rejects.toThrow(UserInputError);
  });

  it('accepts only explicitly selected, confirmed sources of the same subject and grade', async () => {
    const r = await upload();
    expect(() => selectSources(r.id, [], ['fact-unconfirmed'])).toThrow(/հաստատված չէ/);
    expect(() => selectSources(r.id, [], ['fact-grade-8'])).toThrow(/7-րդ դասարանի/);
    expect(() => selectSources(r.id, ['fact-1'], [])).toThrow(/ծրագիր/); // a textbook is not a program
    const ok = selectSources(r.id, ['program-1'], ['fact-1']);
    expect(ok.selectedSources.map((s) => `${s.purpose}:${s.sourceId}`)).toEqual(['program:program-1', 'fact:fact-1']);
  });
});

describe('material review: splitting into questions', () => {
  it('keeps only what matches the document and reports the rest', async () => {
    const deps = fakes({ keyedTwo: 'գ' });
    const r = await segment((await upload()).id, deps);
    const seg = r.segmentation!;
    expect(seg.status).toBe('proposed');
    expect(seg.items.map((i) => i.number)).toEqual(['1', '2']);
    expect(seg.items[0].options.map((o) => o.label)).toEqual(['ա', 'բ', 'գ']);
    expect(seg.items[1].options.map((o) => o.label)).toEqual(['ա', 'բ', 'գ']); // invented «դ» dropped
    expect(seg.problems.some((p) => p.includes('Աշոտ Երկաթ'))).toBe(true);
    expect(seg.problems.some((p) => p.includes('«3» հարց'))).toBe(true);
    expect(r.answerKey.map((k) => [k.itemId, k.optionLabels.join()])).toEqual([
      ['item-1', 'ա'],
      ['item-2', 'գ'],
    ]);
    expect(seg.model).toMatchObject({ providerId: 'fake', modelId: 'fake-model', promptVersion: 'segment_material.v1' });
  });

  it('refuses checks until the split is confirmed', async () => {
    const deps = fakes({ keyedTwo: 'գ' });
    const r = await segment((await upload()).id, deps);
    await expect(runChecks(r.id, deps)).rejects.toThrow(/հաստատեք/);
  });
});

describe('material review: checks', () => {
  it('reports pass / fail per check with evidence, model ids and the revision', async () => {
    const { r, deps } = await readyForChecks();
    const checked = await runChecks(r.id, deps);
    const q1 = checked.results.find((x) => x.itemId === 'item-1')!;
    const q2 = checked.results.find((x) => x.itemId === 'item-2')!;
    expect(q1.checks.every((c) => c.status === 'pass')).toBe(true);
    const byId = Object.fromEntries(q2.checks.map((c) => [c.checkId, c]));
    expect(byId.fact_support.status).toBe('fail');
    expect(byId.answer_unambiguous.status).toBe('fail');
    expect(byId.fact_support.evidence?.[0]).toMatchObject({ sourceId: 'fact-1', sourceVersion: 'v1', chunkId: 'fact-1#p12#c1' });
    expect(byId.fact_support.model).toMatchObject({ providerId: 'fake-judge', modelId: 'fake-judge-model' });
    expect(byId.program_scope).toMatchObject({ status: 'pass', outcomeCodes: ['HP-7-1'] });
    expect(q2.revision).toBe(checked.revision);
    expect(reviewStatus(checked).final).toBe(false);
  });

  it('a model error is not_evaluated, never pass or fail', async () => {
    const { r, deps } = await readyForChecks({ keyedTwo: 'գ', scopeThrows: true });
    const checked = await runChecks(r.id, deps);
    const scope = checked.results[0].checks.find((c) => c.checkId === 'program_scope')!;
    expect(scope.status).toBe('not_evaluated');
    expect(scope.detail).toContain('provider out of credits');
  });

  it('without sources only the source-dependent checks are not evaluated', async () => {
    const deps = fakes({ keyedTwo: 'գ' });
    let r = await upload();
    r = await segment(r.id, deps);
    r = confirmSegmentation(r.id, r.revision);
    const checked = await runChecks(r.id, deps);
    const byId = Object.fromEntries(checked.results[0].checks.map((c) => [c.checkId, c.status]));
    expect(byId).toMatchObject({
      key_present: 'pass',
      key_valid_option: 'pass',
      option_count: 'pass',
      program_scope: 'not_evaluated',
      fact_support: 'not_evaluated',
      answer_unambiguous: 'not_evaluated',
    });
  });

  it('a source that changed after selection is not used', async () => {
    const { r, deps } = await readyForChecks();
    store.sources = store.sources.map((s) => (s.id === 'fact-1' ? { ...s, chunks: [{ id: 'x', sourceId: 'fact-1', text: 'changed' }] } : s));
    const checked = await runChecks(r.id, deps);
    expect(checked.results[0].checks.find((c) => c.checkId === 'fact_support')!.status).toBe('not_evaluated');
    expect(checked.log.some((l) => l.action === 'source_problems')).toBe(true);
  });

  it('a missing key is "key not found"; the teacher can set it by hand, bold is never used', async () => {
    const deps = fakes({ keyedTwo: 'գ' });
    let r = await upload();
    r = await segment(r.id, deps);
    // Pretend the document had no key.
    const stored = store.reviews.get(r.id)!;
    stored.answerKey = [];
    r = confirmSegmentation(r.id, r.revision);
    let checked = await runChecks(r.id, deps);
    expect(checked.results[0].checks.find((c) => c.checkId === 'key_present')!.status).toBe('not_evaluated');

    expect(() => setTeacherKey(r.id, 'item-1', ['ե'])).toThrow(UserInputError);
    r = setTeacherKey(r.id, 'item-1', ['ա']);
    expect(r.results.find((x) => x.itemId === 'item-1')!.stale).toBe(true);
    checked = await runChecks(r.id, deps);
    expect(checked.results.find((x) => x.itemId === 'item-1')!.checks.find((c) => c.checkId === 'key_present')!.status).toBe('pass');
  });
});

describe('material review: suggestions and decisions', () => {
  it('keeps only suggestions backed by an exact quote, as one group with the key change', async () => {
    const { r, deps } = await readyForChecks();
    await runChecks(r.id, deps);
    const { review, problems } = await suggest(r.id, deps);
    expect(review.suggestions).toHaveLength(1);
    const s = review.suggestions[0];
    expect(s).toMatchObject({ itemId: 'item-2', status: 'proposed', keyChange: ['ա'] });
    expect(s.group.patches).toHaveLength(1);
    expect(s.evidence?.[0].text).toBe('Հայոց զորքը գլխավորում էր Վարդան Մամիկոնյանը');
    expect(problems['item-2'].some((p) => p.includes('Վարդանը սպարապետ էր'))).toBe(true);
  });

  it('rejecting a fix leaves the failed check failed', async () => {
    const { r, deps } = await readyForChecks();
    await runChecks(r.id, deps);
    const { review } = await suggest(r.id, deps);
    const after = await decide(r.id, review.suggestions[0].id, { decision: 'reject', expectedRevision: review.revision }, deps);
    expect(after.suggestions[0].status).toBe('rejected');
    expect(after.results.find((x) => x.itemId === 'item-2')!.checks.find((c) => c.checkId === 'fact_support')!.status).toBe('fail');
    expect(after.revision).toBe(review.revision);
  });

  it('accepting applies the group, moves spans, updates the key and re-checks every item keyed in the shared key line', async () => {
    const { r, deps } = await readyForChecks();
    await runChecks(r.id, deps);
    const { review } = await suggest(r.id, deps);
    const sid = review.suggestions[0].id;

    const after = await decide(r.id, sid, { decision: 'accept', expectedRevision: review.revision }, deps);
    expect(after.revision).not.toBe(review.revision);
    expect(after.acceptedGroups).toHaveLength(1);
    expect(after.answerKey.find((k) => k.itemId === 'item-2')!.optionLabels).toEqual(['ա']);
    const s = after.suggestions.find((x) => x.id === sid)!;
    expect(s).toMatchObject({ status: 'accepted', recheck: 'done' });
    // Both items are keyed in the edited key paragraph: both were re-checked at the new revision.
    for (const res of after.results) {
      expect(res.revision).toBe(after.revision);
      expect(res.stale).toBe(false);
    }
    const q2 = after.results.find((x) => x.itemId === 'item-2')!;
    expect(q2.checks.every((c) => c.status === 'pass')).toBe(true);
    expect(reviewStatus(after).final).toBe(true);
  });

  it('an accepted fix is not "checked" while its re-check is pending', async () => {
    const { r, deps } = await readyForChecks();
    await runChecks(r.id, deps);
    const { review } = await suggest(r.id, deps);
    // Simulate the state saved between applying and re-checking.
    const stored = store.reviews.get(r.id)!;
    stored.suggestions[0].status = 'accepted';
    stored.suggestions[0].recheck = 'pending';
    const st = reviewStatus(getReview(review.id));
    expect(st.final).toBe(false);
    expect(st.counts.pendingRechecks).toBe(1);
  });

  it('a teacher edit is re-validated: the edited key text must still match the key change', async () => {
    const { r, deps } = await readyForChecks();
    await runChecks(r.id, deps);
    const { review } = await suggest(r.id, deps);
    const s = review.suggestions[0];
    const patchId = s.group.patches[0].id;
    await expect(
      decide(r.id, s.id, { decision: 'accept', expectedRevision: review.revision, replacements: { [patchId]: '2-բ' } }, deps)
    ).rejects.toThrow(/բանալու տեքստն/);
    const ok = await decide(r.id, s.id, { decision: 'accept', expectedRevision: review.revision, replacements: { [patchId]: '2 - ա' } }, deps);
    expect(ok.suggestions[0].editedByTeacher).toBe(true);
  });

  it('refuses a decision made against an older revision', async () => {
    const { r, deps } = await readyForChecks();
    await runChecks(r.id, deps);
    const { review } = await suggest(r.id, deps);
    await expect(decide(r.id, review.suggestions[0].id, { decision: 'accept', expectedRevision: 'r0-old' }, deps)).rejects.toThrow(
      /փոխվել է/
    );
  });
});

describe('material review: export', () => {
  it('exports a corrected copy (original untouched) and a change list with open items and limitations', async () => {
    const { r, deps } = await readyForChecks();
    await runChecks(r.id, deps);
    const { review } = await suggest(r.id, deps);
    const accepted = await decide(r.id, review.suggestions[0].id, { decision: 'accept', expectedRevision: review.revision }, deps);

    const out = await exportReviewDocx(accepted);
    const doc = await openDocx(out);
    expect(doc.paragraphs.map((p) => p.text)).toContain('1-ա, 2-ա');
    // The stored original is unchanged.
    const original = await openDocx(store.files.get(accepted.fileSha256)!);
    expect(original.paragraphs.map((p) => p.text)).toContain('1-ա, 2-գ');
    // Every part except the main document is byte-identical to the upload.
    const a = await unzipParts(store.files.get(accepted.fileSha256)!);
    const b = await unzipParts(out);
    for (const [name, data] of a) if (name !== 'word/document.xml') expect(Buffer.from(b.get(name)!).equals(Buffer.from(data)), name).toBe(true);

    const list = await buildChangeList(accepted);
    expect(list).toContain('«2-գ» → «2-ա»');
    expect(list).toContain('Հայոց զորքը գլխավորում էր Վարդան Մամիկոնյանը');
    expect(list).toContain('նշված անուն, ոչ ստուգված ինքնություն');
    expect(list).toContain('Էջի դասավորությունը TeachFlow-ը չի ստուգում');
  });

  it('labels a draft export as a draft', async () => {
    const { r, deps } = await readyForChecks();
    const checked = await runChecks(r.id, deps);
    const list = await buildChangeList(checked);
    expect(list).toContain('ՍԵՎԱԳԻՐ');
    expect(list).toContain('ձախողվել է');
  });
});

describe('material review: typed question numbers', () => {
  it('an accepted edit over a typed number marks every result stale and asks to confirm the split again', async () => {
    const typed = BODY.replace(
      numbered(run('Ե՞րբ է տեղի ունեցել Ավարայրի ճակատամարտը:')),
      para(run('1. Ե՞րբ է տեղի ունեցել Ավարայրի ճակատամարտը:'))
    );
    const deps = fakes({ keyedTwo: 'գ' });
    let r = await upload(typed);
    r = selectSources(r.id, ['program-1'], ['fact-1']);
    r = await segment(r.id, deps);
    r = confirmSegmentation(r.id, r.revision);
    r = await runChecks(r.id, deps);

    // A proposal that renumbers question 1 ("1." -> "3.").
    const stored = store.reviews.get(r.id)!;
    const stemId = stored.segmentation!.items[0].stemParagraphIds[0];
    const { loadWorkingCopy } = await import('../../server/materials/workingCopy.js');
    const w = await loadWorkingCopy(stored);
    const patch = w.makePatch('renumber', stemId, 0, 2, '3.');
    stored.suggestions.push({
      id: 'sug-renumber',
      itemId: 'item-1',
      addresses: ['fact_support'],
      group: { id: 'grp-renumber', patches: [patch] },
      rationale: 'test',
      status: 'proposed',
      model: { providerId: 'fake', modelId: 'fake-model', promptVersion: 'test' },
    });

    const after = await decide(r.id, 'sug-renumber', { decision: 'accept', expectedRevision: stored.revision }, deps);
    expect(after.segmentation!.status).toBe('needs_reconfirmation');
    expect(after.results.every((x) => x.stale)).toBe(true);
    expect(after.suggestions.find((x) => x.id === 'sug-renumber')!.recheck).toBe('pending');
    expect(reviewStatus(after).final).toBe(false);
    await expect(runChecks(r.id, deps)).rejects.toThrow(/հաստատեք/);

    const reconfirmed = confirmSegmentation(r.id, after.revision);
    const rechecked = await runChecks(reconfirmed.id, deps);
    expect(rechecked.suggestions.find((x) => x.id === 'sug-renumber')!.recheck).toBe('done');
  });
});
