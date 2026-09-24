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
  editSegmentation,
  undoLast,
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
import { ConflictError, DeclarationRequiredError, UserInputError } from '../../server/pipeline/errors.js';
import { resolveStructure } from '../../server/materials/spans.js';
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
  /** Retrieval waits for this before answering (to hold a run open). */
  gate?: Promise<void>;
  scopeCalls?: number;
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
              ...(prompt.includes('1-ա, 2-գ') ? [{ number: '3', type: 'open', stemParagraphIds: [idOf(prompt, '1-ա, 2-գ')], options: [] }] : []),
            ],
            answerKey: prompt.includes('1-ա, 2-գ')
              ? {
                  paragraphIds: [idOf(prompt, '1-ա, 2-գ')],
                  entries: [
                    { itemNumber: '1', optionLabels: ['ա'], paragraphId: idOf(prompt, '1-ա, 2-գ'), quote: '1-ա' },
                    { itemNumber: '2', optionLabels: ['գ'], paragraphId: idOf(prompt, '1-ա, 2-գ'), quote: '2-գ' },
                  ],
                }
              : null,
          };
          break;
        case 'material:program_scope':
          state.scopeCalls = (state.scopeCalls ?? 0) + 1;
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
  return {
    provider,
    judge,
    retrieve: async () => {
      if (state.gate) await state.gate;
      return { factChunks: [chunk()], methodChunks: [], usedSemanticSearch: false };
    },
  };
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
  store.rules = [{ id: 'rule-single-correct-answer', title: 'single correct', description: '', kind: 'deterministic', params: { minOptions: 3, maxOptions: 5 }, severity: 'error', active: true }];
});

async function readyForChecks(state: FakeState = { keyedTwo: 'գ' }) {
  const deps = fakes(state);
  let r = await upload();
  r = await selectSources(r.id, ['program-1'], ['fact-1']);
  r = await segment(r.id, deps);
  r = await confirmSegmentation(r.id, r.revision);
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
    await expect(selectSources(r.id, [], ['fact-unconfirmed'])).rejects.toThrow(/հաստատված չէ/);
    await expect(selectSources(r.id, [], ['fact-grade-8'])).rejects.toThrow(/7-րդ դասարանի/);
    await expect(selectSources(r.id, ['fact-1'], [])).rejects.toThrow(/ծրագիր/); // a textbook is not a program
    await expect(selectSources(r.id, [], ['program-1'])).rejects.toThrow(/ոչ որպես փաստերի աղբյուր/); // a program is not factual evidence
    const ok = await selectSources(r.id, ['program-1'], ['fact-1']);
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
    r = await confirmSegmentation(r.id, r.revision);
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
    r = await confirmSegmentation(r.id, r.revision);
    let checked = await runChecks(r.id, deps);
    expect(checked.results[0].checks.find((c) => c.checkId === 'key_present')!.status).toBe('not_evaluated');

    await expect(setTeacherKey(r.id, 'item-1', ['ե'])).rejects.toThrow(UserInputError);
    r = await setTeacherKey(r.id, 'item-1', ['ա']);
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
    // The edit is a new proposal revision; the original proposal is superseded, not rewritten.
    expect(ok.suggestions.find((x) => x.id === s.id)!.status).toBe('superseded');
    const edited = ok.suggestions.find((x) => x.id === `${s.id}-t1`)!;
    expect(edited).toMatchObject({ status: 'accepted', editedByTeacher: true, recheck: 'done' });
    expect(edited.group.patches[0].replacement).toBe('2 - ա');
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
    r = await selectSources(r.id, ['program-1'], ['fact-1']);
    r = await segment(r.id, deps);
    r = await confirmSegmentation(r.id, r.revision);
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

    const reconfirmed = await confirmSegmentation(r.id, after.revision);
    const rechecked = await runChecks(reconfirmed.id, deps);
    expect(rechecked.suggestions.find((x) => x.id === 'sug-renumber')!.recheck).toBe('done');
  });
});

describe('material review: concurrency and recovery', () => {
  it('a double submit applies the fix once; the second request is a conflict', async () => {
    const { r, deps } = await readyForChecks();
    await runChecks(r.id, deps);
    const { review } = await suggest(r.id, deps);
    const sid = review.suggestions[0].id;
    const results = await Promise.allSettled([
      decide(r.id, sid, { decision: 'accept', expectedRevision: review.revision }, deps),
      decide(r.id, sid, { decision: 'accept', expectedRevision: review.revision }, deps),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);
    expect(getReview(r.id).acceptedGroups).toHaveLength(1);
  });

  it('a second check while one is running is refused, not duplicated', async () => {
    let open!: () => void;
    const state: FakeState = { keyedTwo: 'գ', gate: new Promise<void>((res) => (open = res)) };
    const { r, deps } = await readyForChecks(state);
    const first = runChecks(r.id, deps);
    await new Promise((res) => setTimeout(res, 20));
    await expect(runChecks(r.id, deps)).rejects.toBeInstanceOf(ConflictError);
    open();
    await first;
    expect(getReview(r.id).runs.filter((x) => x.kind === 'check').map((x) => x.status)).toEqual(['succeeded']);
  });

  it('a late check result after the sources changed is discarded as obsolete', async () => {
    let open!: () => void;
    const state: FakeState = { keyedTwo: 'գ', gate: new Promise<void>((res) => (open = res)) };
    const { r, deps } = await readyForChecks(state);
    const running = runChecks(r.id, deps);
    await new Promise((res) => setTimeout(res, 20));
    await selectSources(r.id, ['program-1'], []); // inputs change mid-run
    open();
    const after = await running;
    expect(after.runs.at(-1)!.status).toBe('obsolete');
    expect(after.results.every((x) => x.stale || x.revision !== after.revision) || after.results.length === 0).toBe(true);
  });

  it('undo rebuilds the previous revision, restores the key and reopens the proposal', async () => {
    const { r, deps } = await readyForChecks();
    await runChecks(r.id, deps);
    const { review } = await suggest(r.id, deps);
    const accepted = await decide(r.id, review.suggestions[0].id, { decision: 'accept', expectedRevision: review.revision }, deps);
    expect(accepted.revision).not.toBe(review.revision);

    await expect(undoLast(r.id, review.revision, deps)).rejects.toBeInstanceOf(ConflictError); // stale revision
    const undone = await undoLast(r.id, accepted.revision, deps);
    expect(undone.revision).toBe(review.revision);
    expect(undone.acceptedGroups).toHaveLength(0);
    expect(undone.answerKey.find((k) => k.itemId === 'item-2')!.optionLabels).toEqual(['գ']);
    expect(undone.suggestions[0].status).toBe('proposed');
    // Rebuilt from the original: exporting now gives the uploaded bytes exactly.
    const out = await exportReviewDocx(undone);
    expect(Buffer.compare(out, Buffer.from(store.files.get(undone.fileSha256)!))).toBe(0);
    // Checks were re-run for the affected items at the restored revision.
    const q2 = undone.results.find((x) => x.itemId === 'item-2')!;
    expect(q2.revision).toBe(undone.revision);
    expect(q2.stale).toBe(false);
  });

  it('a reload returns the same revision, sources and decisions', async () => {
    const { r, deps } = await readyForChecks();
    await runChecks(r.id, deps);
    const { review } = await suggest(r.id, deps);
    const after = await decide(r.id, review.suggestions[0].id, { decision: 'reject', expectedRevision: review.revision }, deps);
    const reloaded = getReview(r.id);
    expect(reloaded.revision).toBe(after.revision);
    expect(reloaded.selectedSources).toEqual(after.selectedSources);
    expect(reloaded.suggestions.map((s) => s.status)).toEqual(['rejected']);
    expect(reloaded.version).toBe(after.version);
  });
});

describe('material review: model failures and reuse', () => {
  it('a failed model call is not_evaluated with an execution error, and retryFailed re-runs only it', async () => {
    const state: FakeState = { keyedTwo: 'գ', scopeThrows: true };
    const { r, deps } = await readyForChecks(state);
    let checked = await runChecks(r.id, deps);
    const scope = checked.results[0].checks.find((c) => c.checkId === 'program_scope')!;
    expect(scope).toMatchObject({ status: 'not_evaluated', executionError: true });
    expect(reviewStatus(checked).counts.executionErrors).toBe(2);

    state.scopeThrows = false;
    const calls = state.scopeCalls!;
    checked = await runChecks(r.id, deps); // nothing stale: no new calls
    expect(state.scopeCalls).toBe(calls);
    checked = await runChecks(r.id, deps, { retryFailed: true });
    expect(state.scopeCalls).toBe(calls + 2);
    expect(checked.results[0].checks.find((c) => c.checkId === 'program_scope')!.status).toBe('pass');
  });

  it('identical inputs reuse the previous result instead of calling the model again', async () => {
    const state: FakeState = { keyedTwo: 'գ' };
    const { r, deps } = await readyForChecks(state);
    await runChecks(r.id, deps);
    const calls = state.scopeCalls!;
    // Re-selecting the same sources marks everything stale, but nothing the checks read changed.
    await selectSources(r.id, ['program-1'], ['fact-1']);
    const again = await runChecks(r.id, deps);
    expect(state.scopeCalls).toBe(calls);
    expect(again.results.every((x) => !x.stale && x.revision === again.revision)).toBe(true);
  });
});

describe('material review: question types and structure', () => {
  it('single-answer and option-count rules apply to single choice only; other types are not judged wrong', async () => {
    const deps = fakes({ keyedTwo: 'գ' });
    let r = await upload();
    r = await segment(r.id, deps);
    const items = resolveStructure(r).items.map((it, i) => ({ ...it, type: i === 0 ? 'multiple_choice' : 'other' }));
    r = await editSegmentation(r.id, { expectedRevision: r.revision, items, answerKeyParagraphIds: r.segmentation!.answerKeyParagraphIds });
    r = await confirmSegmentation(r.id, r.revision);
    r = await selectSources(r.id, ['program-1'], ['fact-1']);
    const checked = await runChecks(r.id, deps);
    const q1 = Object.fromEntries(checked.results.find((x) => x.itemId === 'item-1')!.checks.map((c) => [c.checkId, c.status]));
    expect(q1.option_count).toBeUndefined();
    expect(q1.answer_unambiguous).toBe('not_evaluated');
    expect(q1.key_valid_option).toBe('pass');
    const q2 = checked.results.find((x) => x.itemId === 'item-2')!.checks;
    expect(q2.map((c) => [c.checkId, c.status])).toEqual([['question_type', 'not_evaluated']]);
  });

  it('a teacher correction of the split is validated whole and requires confirming again', async () => {
    const deps = fakes({ keyedTwo: 'գ' });
    let r = await upload();
    r = await segment(r.id, deps);
    r = await confirmSegmentation(r.id, r.revision);
    const items = resolveStructure(r).items;
    // Overlapping options: rejected with a reason, nothing changes.
    const bad = items.map((it, i) => (i === 0 ? { ...it, options: [it.options[0], { ...it.options[1], start: it.options[0].start }] } : it));
    await expect(editSegmentation(r.id, { expectedRevision: r.revision, items: bad, answerKeyParagraphIds: [] })).rejects.toThrow(/հատվում/);
    expect(getReview(r.id).segmentation!.status).toBe('confirmed');
    // Removing a wrong option is accepted and needs a new confirmation.
    const fixed = items.map((it, i) => (i === 1 ? { ...it, options: it.options.slice(0, 2) } : it));
    r = await editSegmentation(r.id, { expectedRevision: r.revision, items: fixed, answerKeyParagraphIds: r.segmentation!.answerKeyParagraphIds });
    expect(r.segmentation!.status).toBe('proposed');
    expect(r.segmentation!.model.providerId).toBe('teacher');
    expect(r.segmentation!.items[1].options.map((o) => o.label)).toEqual(['ա', 'բ']);
    await expect(runChecks(r.id, deps)).rejects.toThrow(/հաստատեք/);
  });
});

describe('material review: uninspected content and keys', () => {
  it('a file with images needs a no-student-data declaration before it is stored', async () => {
    const bytes = new Uint8Array(await buildDocx({ body: BODY, extraParts: { 'word/media/image1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]) } }));
    await expect(createReview({ fileName: 'x.docx', subject: SUBJECT, grade: '7', bytes })).rejects.toBeInstanceOf(DeclarationRequiredError);
    expect(store.files.size).toBe(0);
    const r = await createReview({ fileName: 'x.docx', subject: SUBJECT, grade: '7', bytes, declaredNoStudentData: 'true' });
    expect(r.noStudentDataDeclaration?.parts).toEqual(['word/media/image1.png']);
  });

  it('a fix for a teacher-set key changes only that key; the document gets no new key text', async () => {
    const deps = fakes({ keyedTwo: 'գ' });
    let r = await upload(BODY.replace(para(run('1-ա, 2-գ')), ''));
    r = await selectSources(r.id, ['program-1'], ['fact-1']);
    r = await segment(r.id, deps);
    r = await confirmSegmentation(r.id, r.revision);
    r = await setTeacherKey(r.id, 'item-2', ['գ']);
    r = await runChecks(r.id, deps);
    // A key-only proposal, as the model would give for a key that is not in the document.
    const stored = store.reviews.get(r.id)!;
    stored.suggestions.push({
      id: 'sug-key-only',
      itemId: 'item-2',
      addresses: ['answer_unambiguous'],
      group: { id: 'grp-key-only', patches: [] },
      keyChange: ['ա'],
      rationale: 'test',
      status: 'proposed',
      model: { providerId: 'fake', modelId: 'fake-model', promptVersion: 'test' },
    });
    const after = await decide(r.id, 'sug-key-only', { decision: 'accept', expectedRevision: r.revision }, deps);
    expect(after.revision).toBe(r.revision);
    expect(after.acceptedGroups).toHaveLength(0);
    expect(after.answerKey.find((k) => k.itemId === 'item-2')).toMatchObject({ origin: 'teacher', optionLabels: ['ա'] });
    const out = await exportReviewDocx(after);
    expect(Buffer.compare(out, Buffer.from(store.files.get(after.fileSha256)!))).toBe(0);
  });
});

describe('material review: dependency-scoped invalidation', () => {
  it('an edit inside question 1 re-checks question 1 only; question 2 stays fresh', async () => {
    const { r, deps } = await readyForChecks();
    const checked = await runChecks(r.id, deps);
    const q2Before = checked.results.find((x) => x.itemId === 'item-2')!;
    const stored = store.reviews.get(r.id)!;
    const { loadWorkingCopy } = await import('../../server/materials/workingCopy.js');
    const w = await loadWorkingCopy(stored);
    const optPara = resolveStructure(stored).items[0].options[2].paragraphId;
    const text = w.paragraphText(optPara)!;
    const at = text.indexOf('387');
    stored.suggestions.push({
      id: 'sug-q1',
      itemId: 'item-1',
      addresses: ['option_count'],
      group: { id: 'grp-q1', patches: [w.makePatch('p-q1', optPara, at, at + 3, '388')] },
      rationale: 'test',
      status: 'proposed',
      model: { providerId: 'fake', modelId: 'fake-model', promptVersion: 'test' },
    });
    const after = await decide(r.id, 'sug-q1', { decision: 'accept', expectedRevision: checked.revision }, deps);
    const q1 = after.results.find((x) => x.itemId === 'item-1')!;
    const q2 = after.results.find((x) => x.itemId === 'item-2')!;
    expect(q1.revision).toBe(after.revision);
    expect(q2).toEqual(q2Before); // untouched: same result, still fresh
    expect(reviewStatus(after).counts.staleItems).toBe(0);
  });
});

describe('material review: a superseded source invalidates dependent results', () => {
  it('results go stale, the status is not final, and a new check cannot use the superseded source', async () => {
    const { r, deps } = await readyForChecks();
    await runChecks(r.id, deps);
    // The FACT source is superseded (as POST /sources/:id/supersede does).
    store.sources = store.sources.map((s) => (s.id === 'fact-1' ? { ...s, status: 'superseded' as const, supersededAt: '2026-09-24T00:00:00Z' } : s));
    const after = getReview(r.id);
    expect(after.results.every((x) => x.stale)).toBe(true);
    expect(reviewStatus(after).final).toBe(false);
    const rechecked = await runChecks(r.id, deps);
    const fact = rechecked.results[0].checks.find((c) => c.checkId === 'fact_support')!;
    expect(fact.status).toBe('not_evaluated');
    expect(rechecked.log.some((l) => l.action === 'source_problems')).toBe(true);
  });
});

describe('material review: a linked question + key group is atomic at the review level', () => {
  async function withTwoPatchProposal(breakSecond = false) {
    const { r, deps } = await readyForChecks();
    const checked = await runChecks(r.id, deps);
    const stored = store.reviews.get(r.id)!;
    const { loadWorkingCopy } = await import('../../server/materials/workingCopy.js');
    const w = await loadWorkingCopy(stored);
    const structure = resolveStructure(stored);
    const stem = structure.items[1].stemParagraphIds[0];
    const keyPara = structure.answerKey.find((k) => k.itemId === 'item-2')!.span!.paragraphId;
    const stemText = w.paragraphText(stem)!;
    const s0 = stemText.indexOf('զորավարը');
    const k0 = w.paragraphText(keyPara)!.indexOf('2-գ');
    const question = w.makePatch('q', stem, s0, s0 + 'զորավարը'.length, 'սպարապետը');
    const key = w.makePatch('k', keyPara, k0, k0 + 3, '2-ա');
    stored.suggestions.push({
      id: 'sug-linked',
      itemId: 'item-2',
      addresses: ['answer_unambiguous'],
      group: { id: 'grp-linked', patches: [question, breakSecond ? { ...key, expected: '2-բ' } : key] },
      keyChange: ['ա'],
      rationale: 'test',
      status: 'proposed',
      model: { providerId: 'fake', modelId: 'fake-model', promptVersion: 'test' },
    });
    return { r, deps, checked, stem, keyPara };
  }

  it('both edits apply in one revision, and both reach the exported file', async () => {
    const { r, deps, checked, stem, keyPara } = await withTwoPatchProposal();
    const after = await decide(r.id, 'sug-linked', { decision: 'accept', expectedRevision: checked.revision }, deps);
    expect(after.acceptedGroups).toHaveLength(1);
    expect(after.acceptedGroups[0].patches.map((p) => p.paragraphId)).toEqual([stem, keyPara]);
    expect(after.revision.startsWith('r1-')).toBe(true);
    expect(after.answerKey.find((k) => k.itemId === 'item-2')!.optionLabels).toEqual(['ա']);
    const doc = await openDocx(await exportReviewDocx(after));
    const texts = doc.paragraphs.map((p) => p.text);
    expect(texts).toContain('Ո՞վ էր հայոց սպարապետը Ավարայրի ճակատամարտում:');
    expect(texts).toContain('1-ա, 2-ա');
  });

  it('if the second edit no longer applies, neither is applied: text, key and revision unchanged', async () => {
    const { r, deps, checked } = await withTwoPatchProposal(true);
    await expect(decide(r.id, 'sug-linked', { decision: 'accept', expectedRevision: checked.revision }, deps)).rejects.toThrow(/expected_mismatch/);
    const after = getReview(r.id);
    expect(after.revision).toBe(checked.revision);
    expect(after.acceptedGroups).toHaveLength(0);
    expect(after.answerKey.find((k) => k.itemId === 'item-2')!.optionLabels).toEqual(['գ']);
    const out = await exportReviewDocx(after);
    expect(Buffer.compare(out, Buffer.from(store.files.get(after.fileSha256)!))).toBe(0); // nothing half-applied
  });

  it('a teacher edit of one part creates a new proposal revision and still applies both parts', async () => {
    const { r, deps, checked } = await withTwoPatchProposal();
    const after = await decide(r.id, 'sug-linked', { decision: 'accept', expectedRevision: checked.revision, replacements: { q: 'հրամանատարը' } }, deps);
    const edited = after.suggestions.find((x) => x.id === 'sug-linked-t1')!;
    expect(edited.group.patches.map((p) => p.replacement)).toEqual(['հրամանատարը', '2-ա']);
    const texts = (await openDocx(await exportReviewDocx(after))).paragraphs.map((p) => p.text);
    expect(texts).toContain('Ո՞վ էր հայոց հրամանատարը Ավարայրի ճակատամարտում:');
    expect(texts).toContain('1-ա, 2-ա');
  });
});

describe('independent review R1: an obsolete proposal cannot be accepted', () => {
  async function proposalThen(change: () => void) {
    const { r, deps } = await readyForChecks();
    await runChecks(r.id, deps);
    const { review } = await suggest(r.id, deps);
    const sid = review.suggestions[0].id;
    change();
    return { r, deps, review, sid };
  }
  const refusedWithoutChange = async (r: MaterialReview, deps: ReviewDeps, sid: string, revision: string) => {
    await expect(decide(r.id, sid, { decision: 'accept', expectedRevision: revision }, deps)).rejects.toBeInstanceOf(ConflictError);
    const after = getReview(r.id);
    expect(after.revision).toBe(revision);
    expect(after.acceptedGroups).toHaveLength(0);
    expect(after.answerKey.find((k) => k.itemId === 'item-2')!.optionLabels).toEqual(['գ']);
    expect(after.suggestions.find((x) => x.id === sid)!.status).toBe('superseded');
    expect(Buffer.compare(await exportReviewDocx(after), Buffer.from(store.files.get(after.fileSha256)!))).toBe(0);
    return after;
  };

  it('after the supporting source is superseded: results stale, proposal superseded, accept refused, document untouched', async () => {
    const { r, deps, review, sid } = await proposalThen(() => {
      store.sources.find((x) => x.id === 'fact-1')!.status = 'superseded';
    });
    const before = getReview(r.id);
    expect(before.results.every((x) => x.stale)).toBe(true);
    expect(before.suggestions.find((x) => x.id === sid)!.status).toBe('superseded');
    await refusedWithoutChange(r, deps, sid, review.revision);
  });

  it('after the source confirmation is revoked (old tab still shows the proposal): refused, document untouched', async () => {
    const { r, deps, review, sid } = await proposalThen(() => {
      const src = store.sources.find((x) => x.id === 'fact-1')!;
      delete src.confirmation;
    });
    await refusedWithoutChange(r, deps, sid, review.revision);
  });

  it('after a new check the old proposal stays unusable; a fresh proposal is needed and works', async () => {
    const { r, deps, review, sid } = await proposalThen(() => {
      store.sources.find((x) => x.id === 'fact-1')!.status = 'superseded';
    });
    await refusedWithoutChange(r, deps, sid, review.revision);
    store.sources.find((x) => x.id === 'fact-1')!.status = 'active'; // source usable again
    await runChecks(r.id, deps);
    await expect(decide(r.id, sid, { decision: 'accept', expectedRevision: review.revision }, deps)).rejects.toBeInstanceOf(ConflictError);
    const { review: fresh } = await suggest(r.id, deps);
    const newSid = fresh.suggestions.find((x) => x.status === 'proposed')!.id;
    const accepted = await decide(r.id, newSid, { decision: 'accept', expectedRevision: fresh.revision }, deps);
    expect(accepted.acceptedGroups).toHaveLength(1);
  });
});

describe('independent review R2: changed dependencies invalidate finished results', () => {
  async function finalReview() {
    const { r, deps } = await readyForChecks();
    await runChecks(r.id, deps);
    const { review } = await suggest(r.id, deps);
    const after = await decide(r.id, review.suggestions[0].id, { decision: 'accept', expectedRevision: review.revision }, deps);
    expect(reviewStatus(after).final).toBe(true);
    return { r, deps };
  }

  it('raising minOptions: status no longer final at once, and an ordinary check re-runs and fails option_count', async () => {
    const { r, deps } = await finalReview();
    store.rules.find((x) => x.id === 'rule-single-correct-answer')!.params = { minOptions: 4, maxOptions: 5 };
    expect(reviewStatus(getReview(r.id)).final).toBe(false);
    const checked = await runChecks(r.id, deps);
    expect(checked.runs.at(-1)!.itemIds).toEqual(['item-1', 'item-2']);
    expect(checked.results.find((x) => x.itemId === 'item-1')!.checks.find((c) => c.checkId === 'option_count')!.status).toBe('fail');
    expect(reviewStatus(checked).final).toBe(false);
  });

  it('switching the rule off: not final, ordinary check reports option_count not evaluated', async () => {
    const { r, deps } = await finalReview();
    store.rules.find((x) => x.id === 'rule-single-correct-answer')!.active = false;
    expect(reviewStatus(getReview(r.id)).final).toBe(false);
    const checked = await runChecks(r.id, deps);
    expect(checked.results[0].checks.find((c) => c.checkId === 'option_count')!.status).toBe('not_evaluated');
    expect(reviewStatus(checked).final).toBe(false);
  });

  it('a changed confirmed outcome of the selected program invalidates the results', async () => {
    const { r } = await finalReview();
    store.outcomes = store.outcomes.map((o) => ({ ...o, text: `${o.text} (խմբագրված)` }));
    const after = getReview(r.id);
    expect(after.results.every((x) => x.stale)).toBe(true);
    expect(reviewStatus(after).final).toBe(false);
  });

  it('the change report and export status follow the invalidation', async () => {
    const { r } = await finalReview();
    store.rules.find((x) => x.id === 'rule-single-correct-answer')!.active = false;
    const list = await buildChangeList(getReview(r.id));
    expect(list).toContain('ՍԵՎԱԳԻՐ');
    expect(list).toContain('ստուգումը հնացել է');
  });

  it('valid reuse is preserved when dependencies truly match: no new model calls', async () => {
    const state: FakeState = { keyedTwo: 'գ' };
    const { r, deps } = await readyForChecks(state);
    await runChecks(r.id, deps);
    const calls = state.scopeCalls!;
    const again = await runChecks(r.id, deps);
    expect(state.scopeCalls).toBe(calls);
    expect(again.runs.at(-1)!.itemIds).toEqual([]);
    expect(again.results.every((x) => !x.stale)).toBe(true);
  });
});

describe('independent race (review 963fb4b): dependencies change while a check waits', () => {
  /** Runs checks with the first retrieval held until `change` has been applied. */
  async function raced(change: () => void, opts: { priorRun?: boolean } = {}) {
    const { r, deps } = await readyForChecks();
    if (opts.priorRun) await runChecks(r.id, deps);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const started = new Promise<void>((res) => (entered = res));
    const original = deps.retrieve!;
    let first = true;
    const held: ReviewDeps = {
      ...deps,
      retrieve: (async (...args: Parameters<NonNullable<ReviewDeps['retrieve']>>) => {
        if (first) {
          first = false;
          entered();
          await gate;
        }
        return original(...args);
      }) as ReviewDeps['retrieve'],
    };
    const pending = runChecks(r.id, held, { all: opts.priorRun });
    await started;
    change();
    release();
    const done = await pending;
    return { r, deps, done };
  }
  const rule = () => store.rules.find((x) => x.id === 'rule-single-correct-answer')!;

  it.each([
    ['threshold raised to 4', () => { rule().params = { minOptions: 4, maxOptions: 5 }; }, 'fail'],
    ['rule switched off', () => { rule().active = false; }, 'not_evaluated'],
  ] as const)('%s during the wait: run obsolete, no fresh pass, the ordinary next check re-runs it', async (_l, change, expected) => {
    const { r, deps, done } = await raced(change);
    expect(done.runs.at(-1)!.status).toBe('obsolete');
    const q1 = getReview(r.id).results.find((x) => x.itemId === 'item-1');
    expect(q1 === undefined || q1.stale).toBe(true); // never a fresh result from the old rule
    const ordinary = await runChecks(r.id, deps);
    expect(ordinary.runs.at(-1)!.itemIds).toContain('item-1');
    expect(ordinary.results.find((x) => x.itemId === 'item-1')!.checks.find((c) => c.checkId === 'option_count')!.status).toBe(expected);
  });

  it('with earlier fresh results: a threshold change during a re-run leaves them stale, not current', async () => {
    const { r, done } = await raced(() => { rule().params = { minOptions: 4, maxOptions: 5 }; }, { priorRun: true });
    expect(done.runs.at(-1)!.status).toBe('obsolete');
    expect(getReview(r.id).results.every((x) => x.stale)).toBe(true);
    expect(reviewStatus(getReview(r.id)).final).toBe(false);
  });

  it('a source superseded during the wait: run obsolete, nothing published as current', async () => {
    const { r, done } = await raced(() => {
      store.sources.find((x) => x.id === 'fact-1')!.status = 'superseded';
    });
    expect(done.runs.at(-1)!.status).toBe('obsolete');
    expect(getReview(r.id).results.filter((x) => !x.stale)).toHaveLength(0);
  });

  it('nothing changed during the wait: the run succeeds and later reuse still makes no new calls', async () => {
    const state: FakeState = { keyedTwo: 'գ' };
    const { r, deps } = await readyForChecks(state);
    const first = await runChecks(r.id, deps);
    expect(first.runs.at(-1)!.status).toBe('succeeded');
    const calls = state.scopeCalls!;
    const again = await runChecks(r.id, deps);
    expect(state.scopeCalls).toBe(calls);
    expect(again.results.every((x) => !x.stale)).toBe(true);
  });
});
