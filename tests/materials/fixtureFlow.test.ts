// The labelled FIXTURE provider end to end (deterministic rules, not a model),
// on a SYNTHETIC Armenian document. Guards the local UI scenario.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
    saveMaterialReview: (r: MaterialReview) => (store.reviews.set(r.id, structuredClone(r)), r),
    saveMaterialFile: (sha: string, data: Uint8Array) => store.files.set(sha, data),
    getMaterialFile: (sha: string) => store.files.get(sha),
    getSource: (id: string) => store.sources.find((s) => s.id === id),
    getSources: () => store.sources,
    getOutcomes: () => store.outcomes,
    getActiveRules: () => store.rules,
    logAIInteraction: () => undefined,
  },
}));

import { openDocx } from '../../server/docx/docxModel.js';
import { exportReviewDocx } from '../../server/materials/exportReview.js';
import { confirmSegmentation, createReview, decide, runChecks, segment, selectSources, suggest } from '../../server/materials/reviewService.js';
import { confirmSource, sourceContentHash } from '../../server/pipeline/sourceConfirmation.js';
import { FixtureJudgeProvider, FixtureModelProvider } from '../../server/providers/fixtureProvider.js';
import { NUMBERING_DECIMAL, buildDocx, numbered, para, run } from '../docx/syntheticDocx.js';

const SUBJECT = 'Հայոց պատմություն';
const FACT = 'Ավարայրի ճակատամարտը տեղի է ունեցել 451 թվականին: Հայոց զորքը գլխավորում էր Վարդան Մամիկոնյանը:';

const env = { ...process.env };
beforeAll(() => {
  process.env.TEACHFLOW_FIXTURE_MODE = '1';
  process.env.TEACHFLOW_DATA_DIR = '/tmp/teachflow-fixture-test';
});
afterAll(() => {
  process.env = env;
});

beforeEach(() => {
  store.reviews.clear();
  store.files.clear();
  const base = (id: string, o: Partial<Source>): Source => ({
    id, title: `FIXTURE ${id}`, authority: 'fixture', docType: 'textbook', subject: SUBJECT, grades: [7], role: 'FACT', version: 'fx-1',
    effectiveFrom: '2026-09-01', status: 'active', sha256: id, isDemo: false, uploadedAt: '2026-09-01', chunks: [], ...o,
  });
  const c = (s: Source) => confirmSource(s, { confirmedByName: 'fixture setup', expectedVersion: s.version, expectedContentHash: sourceContentHash(s) });
  store.sources = [
    c(base('fx-program', { docType: 'subject_program' })),
    c(base('fx-fact', { chunks: [{ id: 'fx-fact#p1#c1', sourceId: 'fx-fact', page: 1, text: FACT }] })),
  ];
  store.outcomes = [{ code: 'FX-HP7-1', text: 'Ավարայրի ճակատամարտի պատմական նշանակությունը', subject: SUBJECT, grade: 7, standardVersion: 'fx-1', sourceId: 'fx-program', confirmed: true }];
  store.rules = [{ id: 'rule-single-correct-answer', title: 'single correct', description: '', kind: 'deterministic', params: { minOptions: 3, maxOptions: 5 }, severity: 'error', active: true }];
});

describe('FIXTURE provider flow', () => {
  it('splits, finds the wrong key with evidence, proposes the linked key fix, and the export carries it', async () => {
    const deps = {
      provider: new FixtureModelProvider(),
      judge: new FixtureJudgeProvider(),
      retrieve: async () => ({
        factChunks: [{ chunk: store.sources[1].chunks[0], sourceId: 'fx-fact', sourceTitle: 'FIXTURE fx-fact', sourceRole: 'FACT' as const, version: 'fx-1', score: 0.9 }],
        methodChunks: [],
        usedSemanticSearch: false,
      }),
    };
    const body =
      para(run('Թեստ՝ Ավարայրի ճակատամարտ')) +
      para(run('Ընտրեք մեկ ճիշտ պատասխան:')) + // an instruction, not the key heading
      numbered(run('Ե՞րբ է տեղի ունեցել Ավարայրի ճակատամարտը:')) +
      para(run('ա) 451 թ.') + '<w:r><w:tab/></w:r>' + run('բ) 301 թ.') + '<w:r><w:tab/></w:r>' + run('գ) 387 թ.')) +
      numbered(run('Ո՞վ էր հայոց զորավարը Ավարայրի ճակատամարտում:')) +
      para(run('ա) Վարդան Մամիկոնյան')) + para(run('բ) Տիգրան Մեծ')) + para(run('գ) Արտաշես Առաջին')) +
      para(run('Պատասխաններ')) + para(run('1-ա, 2-գ'));
    let r = await createReview({ fileName: 'Ավարայր.docx', subject: SUBJECT, grade: '7', bytes: new Uint8Array(await buildDocx({ body, numbering: NUMBERING_DECIMAL })) });
    r = await selectSources(r.id, ['fx-program'], ['fx-fact']);
    r = await segment(r.id, deps);
    expect(r.segmentation!.items.map((i) => [i.number, i.options.length])).toEqual([['1', 3], ['2', 3]]);
    expect(r.answerKey.map((k) => k.optionLabels[0])).toEqual(['ա', 'գ']);
    r = await confirmSegmentation(r.id, r.revision);
    r = await runChecks(r.id, deps);
    const q2 = Object.fromEntries(r.results.find((x) => x.itemId === 'item-2')!.checks.map((c) => [c.checkId, c.status]));
    expect(q2).toMatchObject({ fact_support: 'fail', answer_unambiguous: 'fail', program_scope: 'pass' });
    expect(r.results.find((x) => x.itemId === 'item-1')!.checks.every((c) => c.status === 'pass')).toBe(true);

    const { review } = await suggest(r.id, deps);
    expect(review.suggestions).toHaveLength(1);
    expect(review.suggestions[0].group.patches[0]).toMatchObject({ expected: '2-գ', replacement: '2-ա' });
    expect(review.suggestions[0].model.providerId).toBe('fixture');

    const after = await decide(r.id, review.suggestions[0].id, { decision: 'accept', expectedRevision: review.revision }, deps);
    expect(after.results.every((x) => x.checks.every((c) => c.status === 'pass'))).toBe(true);
    const doc = await openDocx(await exportReviewDocx(after));
    expect(doc.paragraphs.map((p) => p.text)).toContain('1-ա, 2-ա');
  });

  it('refuses to run outside fixture mode', async () => {
    delete process.env.TEACHFLOW_FIXTURE_MODE;
    await expect(new FixtureModelProvider().generateStructured('x', {} as never, { actionName: 'material:segment' })).rejects.toThrow(/FIXTURE/);
    process.env.TEACHFLOW_FIXTURE_MODE = '1';
  });
});
