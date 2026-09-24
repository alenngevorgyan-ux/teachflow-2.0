import crypto from 'crypto';
import type {
  MaterialCheckStatus,
  MaterialItem,
  MaterialItemResult,
  MaterialParagraph,
  MaterialReview,
  MaterialRun,
  MaterialRunKind,
  MaterialSuggestion,
  PatchGroup,
  TextPatch,
} from '../../shared/types.js';
import { openDocx } from '../docx/docxModel.js';
import { DocxWorkingCopy } from '../docx/patch.js';
import { ConflictError, DeclarationRequiredError, UserInputError } from '../pipeline/errors.js';
import { isSourceConfirmed, sourceContentHash } from '../pipeline/sourceConfirmation.js';
import { withRedactedAudit } from '../providers/auditContext.js';
import { IJudgeProvider } from '../providers/judgeProvider.js';
import { IModelProvider } from '../providers/modelProvider.js';
import { repository } from '../store/repository.js';
import { CheckDeps, checkItem, dependencyFingerprint, itemInputHash, resolveSelectedSources } from './checks.js';
import { proposeSegmentation, validateTeacherItems } from './segmentation.js';
import { ResolvedStructure, resolveStructure } from './spans.js';
import { itemsNeedingFixes, keyEntryMatches, proposeSuggestions } from './suggestions.js';
import { currentParagraphs, workingCopyFactory } from './workingCopy.js';

// Concurrency model (single server process, JSON store):
// - Every mutation of a review runs under a per-review lock and bumps
//   review.version. Decisions carry the revision they were made against;
//   a mismatch or a decision already taken is a ConflictError (HTTP 409),
//   so double clicks and a second tab cannot apply anything twice.
// - Model-backed runs (segment / check / suggest / recheck) do their slow
//   work outside the lock on a snapshot and commit under the lock only if
//   the inputs they read are unchanged; otherwise the run is marked
//   'obsolete' and its results are discarded, never written over newer state.
// - Only one run of a kind may be 'running' per review. A run left 'running'
//   by a restarted server is reported as failed (interrupted), not restarted.

export interface ReviewDeps {
  provider: IModelProvider;
  judge: IJudgeProvider;
  modelId?: string;
  retrieve?: CheckDeps['retrieve'];
}

const RUN_INTERRUPTED_AFTER_MS = 30 * 60 * 1000;
const MAX_RUNS_KEPT = 50;

function now(): string {
  return new Date().toISOString();
}

function log(review: MaterialReview, action: string, detail: string): void {
  review.log.push({ at: now(), action, detail });
}

// ------------------------------------------------------------- lock / load

const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(id: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const chained = prev.then(() => mine);
  locks.set(id, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(id) === chained) locks.delete(id);
  }
}

/** Loads a copy and brings records written by earlier versions of this code to the current shape. */
function load(id: string): MaterialReview {
  const stored = repository.getMaterialReview(id);
  if (!stored) throw new UserInputError(`Անհայտ նյութ՝ «${id}»:`);
  const r = structuredClone(stored);
  r.version ??= 0;
  r.runs ??= [];
  if (r.segmentation && r.segmentation.atGroupCount === undefined) {
    // Older records moved spans in place on every accept: they are in current coordinates.
    r.segmentation.atGroupCount = r.acceptedGroups.length;
  }
  for (const s of r.suggestions) if ((s.status as string) === 'stale') s.status = 'superseded';
  invalidateOutdated(r);
  for (const run of r.runs) {
    if (run.status === 'running' && Date.now() - Date.parse(run.startedAt) > RUN_INTERRUPTED_AFTER_MS) {
      run.status = 'failed';
      run.finishedAt = now();
      run.error = 'Ընդհատվել է (սերվերը վերագործարկվել է կամ գործողությունը չի ավարտվել):';
    }
  }
  return r;
}

/**
 * The dependency contract, applied on every load (so before a check run picks
 * what to skip, before status/export, and before any decision): a result whose
 * review-wide dependencies changed since it was computed — a selected source
 * superseded, changed or unconfirmed, confirmed outcomes changed, a method rule
 * changed or switched off — is stale, and every proposal built on it is
 * superseded. Results without a fingerprint (older records) are treated as
 * stale: when in doubt, nothing stays green.
 */
function invalidateOutdated(r: MaterialReview): void {
  if (!r.results.some((x) => !x.stale)) return;
  const current = dependencyFingerprint(r);
  const sourceProblems = r.selectedSources.length > 0 && resolveSelectedSources(r).problems.length > 0;
  const outdated = r.results.filter((x) => !x.stale && (sourceProblems || x.dependencyFingerprint !== current)).map((x) => x.itemId);
  if (outdated.length) markStale(r, outdated);
}

function save(review: MaterialReview): MaterialReview {
  review.version += 1;
  if (review.runs.length > MAX_RUNS_KEPT) review.runs = review.runs.slice(-MAX_RUNS_KEPT);
  return repository.saveMaterialReview(review);
}

function mutate(id: string, fn: (r: MaterialReview) => void | Promise<void>): Promise<MaterialReview> {
  return withLock(id, async () => {
    const r = load(id);
    await fn(r);
    return save(r);
  });
}

function requireConfirmedSegmentation(review: MaterialReview): void {
  if (review.segmentation?.status !== 'confirmed') {
    throw new UserInputError('Սկզբում հաստատեք փաստաթղթի բաժանումը հարցերի:');
  }
}

function requireRevision(review: MaterialReview, expected: unknown): void {
  if (expected !== review.revision) {
    throw new ConflictError('Փաստաթուղթը փոխվել է այլ պատուհանում կամ գործողությամբ: Թարմացրեք էջը և որոշեք նորից:');
  }
}

function markStale(review: MaterialReview, itemIds: Iterable<string>): void {
  const set = new Set(itemIds);
  for (const r of review.results) if (set.has(r.itemId)) r.stale = true;
  // Proposals made for findings that are being re-evaluated no longer apply.
  for (const s of review.suggestions) if (s.status === 'proposed' && set.has(s.itemId)) s.status = 'superseded';
}

function allItemIds(review: MaterialReview): string[] {
  return review.segmentation?.items.map((i) => i.id) ?? [];
}

function hash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** What a run's results depend on besides per-item inputs. */
function runContext(review: MaterialReview): string {
  return hash({
    revision: review.revision,
    sources: review.selectedSources,
    dependencies: dependencyFingerprint(review),
    segmentation: review.segmentation
      ? [review.segmentation.status, review.segmentation.confirmedAt, review.segmentation.atGroupCount, review.segmentation.items]
      : null,
  });
}

// -------------------------------------------------------------------- runs

function startRun(review: MaterialReview, kind: MaterialRunKind, itemIds?: string[]): MaterialRun {
  const conflicting = kind === 'check' || kind === 'recheck' ? ['check', 'recheck'] : [kind];
  const running = review.runs.find((r) => r.status === 'running' && conflicting.includes(r.kind));
  if (running) throw new ConflictError('Նույն գործողությունն արդեն ընթացքի մեջ է: Սպասեք դրա ավարտին:');
  const run: MaterialRun = {
    id: `run-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
    kind,
    status: 'running',
    startedAt: now(),
    baseRevision: review.revision,
    itemIds,
  };
  review.runs.push(run);
  return run;
}

function finishRun(review: MaterialReview, runId: string, status: MaterialRun['status'], error?: string): void {
  const run = review.runs.find((r) => r.id === runId);
  if (!run) return;
  run.status = status;
  run.finishedAt = now();
  if (error) run.error = error;
}

async function failRun(id: string, runId: string, err: unknown): Promise<never> {
  const msg = err instanceof Error ? err.message : String(err);
  await mutate(id, (r) => finishRun(r, runId, 'failed', msg));
  throw err;
}

// ------------------------------------------------------------------ create

export async function createReview(input: {
  fileName: unknown;
  subject: unknown;
  grade: unknown;
  bytes: Uint8Array;
  declaredNoStudentData?: unknown;
}): Promise<MaterialReview> {
  const fileName = typeof input.fileName === 'string' ? input.fileName.trim() : '';
  const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
  if (!fileName || !subject) throw new UserInputError('Պարտադիր դաշտերը բացակայում են՝ ֆայլ, առարկա:');
  if (!/\.docx$/i.test(fileName)) throw new UserInputError('Աջակցվում է միայն .docx ֆայլ:');
  const gradeStr = typeof input.grade === 'string' ? input.grade.trim() : typeof input.grade === 'number' ? String(input.grade) : '';
  if (!/^\d+$/.test(gradeStr) || Number(gradeStr) < 1) throw new UserInputError('Դասարանը պարտադիր է և պետք է լինի դրական ամբողջ թիվ:');

  // Safety, structure and the privacy check all happen here, before anything is stored.
  const doc = await openDocx(input.bytes);
  const uninspected = doc.privacy.uncheckable.map((u) => u.part);
  const declared = input.declaredNoStudentData === true || input.declaredNoStudentData === 'true';
  if (uninspected.length && !declared) throw new DeclarationRequiredError(uninspected);

  repository.saveMaterialFile(doc.sha256, input.bytes);
  const review: MaterialReview = {
    id: `mat-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    version: 0,
    fileName,
    fileSha256: doc.sha256,
    uploadedAt: now(),
    subject,
    grade: Number(gradeStr),
    selectedSources: [],
    preservation: doc.preservation,
    privacy: doc.privacy,
    answerKey: [],
    acceptedGroups: [],
    revision: `r0-${doc.sha256.slice(0, 12)}`,
    results: [],
    suggestions: [],
    log: [],
    runs: [],
    noStudentDataDeclaration: uninspected.length ? { declaredAt: now(), parts: uninspected } : undefined,
  };
  log(review, 'uploaded', `${fileName} (${doc.paragraphs.length} պարբերություն)`);
  return save(review);
}

export function getReview(id: string): MaterialReview {
  return load(id);
}

// ----------------------------------------------------------------- sources

export function selectSources(id: string, programSourceIds: unknown, factSourceIds: unknown): Promise<MaterialReview> {
  return mutate(id, (review) => {
    const asIds = (v: unknown, name: string): string[] => {
      if (v === undefined) return [];
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new UserInputError(`«${name}» պետք է լինի աղբյուրների id-ների ցուցակ:`);
      return [...new Set(v as string[])];
    };
    const program = asIds(programSourceIds, 'programSourceIds');
    const fact = asIds(factSourceIds, 'factSourceIds');

    const problems: string[] = [];
    const selected: MaterialReview['selectedSources'] = [];
    const add = (sid: string, purpose: 'program' | 'fact') => {
      const s = repository.getSource(sid);
      if (!s) return problems.push(`«${sid}» աղբյուրը գոյություն չունի:`);
      if (!isSourceConfirmed(s)) return problems.push(`«${s.title}» աղբյուրը հաստատված չէ:`);
      if (s.subject !== review.subject) return problems.push(`«${s.title}» աղբյուրը այլ առարկայի է (${s.subject}):`);
      if (!s.grades.includes(review.grade)) return problems.push(`«${s.title}» աղբյուրը ${review.grade}-րդ դասարանի համար չէ:`);
      if (purpose === 'program' && s.docType !== 'standard' && s.docType !== 'subject_program') {
        return problems.push(`«${s.title}» աղբյուրը չափորոշիչ կամ առարկայական ծրագիր չէ:`);
      }
      if (purpose === 'fact' && s.role !== 'FACT') return problems.push(`«${s.title}» աղբյուրը ՓԱՍՏԱՑԻ չէ:`);
      // A standard / program defines scope and outcomes; it is not used as factual evidence.
      if (purpose === 'fact' && (s.docType === 'standard' || s.docType === 'subject_program')) {
        return problems.push(`«${s.title}» աղբյուրը չափորոշիչ կամ ծրագիր է. այն ընտրեք որպես ծրագիր, ոչ որպես փաստերի աղբյուր:`);
      }
      selected.push({ sourceId: s.id, purpose, version: s.version, contentHash: sourceContentHash(s) });
    };
    program.forEach((sid) => add(sid, 'program'));
    fact.forEach((sid) => add(sid, 'fact'));
    if (problems.length) throw new UserInputError(problems.join(' '));

    review.selectedSources = selected;
    markStale(review, allItemIds(review));
    log(review, 'sources_selected', selected.map((s) => `${s.purpose}:${s.sourceId}@${s.version}`).join(', ') || '—');
  });
}

// ------------------------------------------------------------ segmentation

export async function segment(id: string, deps: ReviewDeps): Promise<MaterialReview> {
  let runId = '';
  let snapshot!: MaterialReview;
  await mutate(id, (r) => {
    runId = startRun(r, 'segment').id;
    snapshot = structuredClone(r);
  });
  let proposal: Awaited<ReturnType<typeof proposeSegmentation>>;
  try {
    const w = (await workingCopyFactory(snapshot))();
    proposal = await withRedactedAudit('material review', () =>
      proposeSegmentation(currentParagraphs(w), snapshot.revision, snapshot.acceptedGroups.length, deps.provider, deps.modelId)
    );
  } catch (err) {
    return failRun(id, runId, err);
  }
  return mutate(id, (r) => {
    if (r.revision !== snapshot.revision) {
      finishRun(r, runId, 'obsolete', 'Փաստաթուղթը փոխվել է բաժանման ընթացքում. արդյունքը չի պահպանվել:');
      return;
    }
    const { segmentation, answerKey } = proposal;
    r.segmentation = segmentation;
    // Teacher-set keys survive for items that still exist under the same id; they are re-validated on confirm.
    r.answerKey = [...answerKey, ...r.answerKey.filter((k) => k.origin === 'teacher' && !answerKey.some((a) => a.itemId === k.itemId))];
    r.results = [];
    for (const s of r.suggestions) if (s.status === 'proposed') s.status = 'superseded';
    finishRun(r, runId, 'succeeded');
    log(r, 'segmentation_proposed', `${segmentation.items.length} հարց, ${segmentation.problems.length} խնդիր (${segmentation.model.modelId})`);
  });
}

/** The teacher's correction of the split. Invalid edits are rejected whole, with reasons. */
export function editSegmentation(id: string, input: { expectedRevision?: unknown; items?: unknown; answerKeyParagraphIds?: unknown }): Promise<MaterialReview> {
  return withLock(id, async () => {
    const r = load(id);
    requireRevision(r, input.expectedRevision);
    if (!r.segmentation) throw new UserInputError('Բաժանումը դեռ առաջարկված չէ:');
    const paragraphs = currentParagraphs((await workingCopyFactory(r))());
    const v = validateTeacherItems(input.items, input.answerKeyParagraphIds, paragraphs);
    if ('errors' in v) throw new UserInputError(v.errors.join(' '));

    // Keys: current-coordinate spans; document keys must stay inside key paragraphs.
    const current = resolveStructure(r);
    const ids = new Set(v.items.map((i) => i.id));
    const keyParas = new Set(v.answerKeyParagraphIds);
    const dropped: string[] = [];
    const answerKey = current.answerKey.filter((k) => {
      if (!ids.has(k.itemId)) return false;
      if (k.origin === 'document' && (!k.span || !keyParas.has(k.span.paragraphId))) {
        dropped.push(k.itemId);
        return false;
      }
      return true;
    });

    r.segmentation = {
      ...r.segmentation,
      status: 'proposed',
      items: v.items,
      answerKeyParagraphIds: v.answerKeyParagraphIds,
      problems: dropped.length ? [`Բանալու գրառումներ հեռացվել են (${dropped.join(', ')}), քանի որ դրանց պարբերությունն այլևս բանալի չէ:`] : [],
      model: { providerId: 'teacher', modelId: 'manual-edit', promptVersion: 'manual' },
      proposedAtRevision: r.revision,
      atGroupCount: r.acceptedGroups.length,
      confirmedAt: undefined,
    };
    r.answerKey = answerKey;
    // Structure changed: every check depends on it.
    markStale(r, r.results.map((x) => x.itemId));
    r.results = r.results.filter((x) => ids.has(x.itemId));
    log(r, 'segmentation_edited', `${v.items.length} հարց`);
    return save(r);
  });
}

export function confirmSegmentation(id: string, expectedRevision: unknown): Promise<MaterialReview> {
  return mutate(id, (review) => {
    if (!review.segmentation) throw new UserInputError('Բաժանումը դեռ առաջարկված չէ:');
    requireRevision(review, expectedRevision);
    const items = new Map(review.segmentation.items.map((i) => [i.id, i]));
    review.answerKey = review.answerKey.filter((k) => {
      const item = items.get(k.itemId);
      return item && (k.origin === 'document' || k.optionLabels.every((l) => item.options.some((o) => o.label === l)));
    });
    review.segmentation.status = 'confirmed';
    review.segmentation.confirmedAt = now();
    markStale(review, allItemIds(review));
    log(review, 'segmentation_confirmed', `${review.segmentation.items.length} հարց`);
  });
}

/**
 * A key set by the teacher. It replaces a key parsed from the document for
 * this question (the document text itself is not changed; the report says
 * so). Bold or other formatting is never used as a key.
 */
export function setTeacherKey(id: string, itemId: string, optionLabels: unknown): Promise<MaterialReview> {
  return mutate(id, (review) => {
    requireConfirmedSegmentation(review);
    const item = review.segmentation!.items.find((i) => i.id === itemId);
    if (!item) throw new UserInputError(`Անհայտ հարց՝ «${itemId}»:`);
    if (item.type !== 'single_choice' && item.type !== 'multiple_choice') throw new UserInputError('Բանալի կարելի է նշել միայն ընտրովի պատասխանով հարցի համար:');
    if (!Array.isArray(optionLabels) || optionLabels.length === 0 || optionLabels.some((l) => typeof l !== 'string')) {
      throw new UserInputError('Ընտրեք առնվազն մեկ տարբերակ:');
    }
    const labels = [...new Set(optionLabels as string[])];
    if (item.type === 'single_choice' && labels.length > 1) throw new UserInputError('Մեկ ճիշտ պատասխանով հարցի համար ընտրեք մեկ տարբերակ:');
    const unknown = labels.filter((l) => !item.options.some((o) => o.label === l));
    if (unknown.length) throw new UserInputError(`«${item.number}» հարցը չունի «${unknown.join(', ')}» տարբերակ:`);
    const replaced = review.answerKey.find((k) => k.itemId === itemId && k.origin === 'document');
    review.answerKey = [...review.answerKey.filter((k) => k.itemId !== itemId), { itemId, optionLabels: labels, origin: 'teacher' }];
    markStale(review, [itemId]);
    log(review, 'teacher_key_set', `${item.number}: ${labels.join(', ')}${replaced ? ' (փոխարինում է փաստաթղթից ընթերցված բանալուն)' : ''}`);
  });
}

// ------------------------------------------------------------------ checks

export interface CheckOptions {
  /** Check only these items (default: every item without a fresh result). */
  itemIds?: string[];
  /** Also re-run items whose last result had an execution error. */
  retryFailed?: boolean;
  /** Re-run everything, ignoring reusable results. */
  all?: boolean;
  kind?: 'check' | 'recheck';
}

/**
 * A result stays fresh until something it depends on changes. Every change
 * (accepted fix, undo, key, sources, structure) marks exactly the dependent
 * items stale, so a result computed at an earlier revision for a question
 * the later edits did not touch is still current.
 */
function isFresh(r: MaterialItemResult | undefined, _review: MaterialReview): boolean {
  return !!r && !r.stale;
}

export async function runChecks(id: string, deps: ReviewDeps, opts: CheckOptions = {}): Promise<MaterialReview> {
  let runId = '';
  let snapshot!: MaterialReview;
  let todo: string[] = [];
  // Captured once, under the lock, before any await: the dependency state the
  // whole run is computed against. Never recomputed later from the live
  // repository as if it were history.
  let captured!: { context: string; dependencyFingerprint: string };
  await mutate(id, (r) => {
    requireConfirmedSegmentation(r);
    captured = { context: runContext(r), dependencyFingerprint: dependencyFingerprint(r) };
    todo = allItemIds(r).filter((iid) => {
      if (opts.itemIds && !opts.itemIds.includes(iid)) return false;
      const res = r.results.find((x) => x.itemId === iid);
      if (opts.all || opts.itemIds) return true;
      if (!isFresh(res, r)) return true;
      return !!opts.retryFailed && res!.checks.some((c) => c.executionError);
    });
    runId = startRun(r, opts.kind ?? 'check', todo).id;
    snapshot = structuredClone(r);
  });

  const checkDeps: CheckDeps = { provider: deps.provider, judge: deps.judge, modelId: deps.modelId, retrieve: deps.retrieve };
  const computed = new Map<string, MaterialItemResult>();
  let sourceProblems: string[] = [];
  try {
    const paragraphs = currentParagraphs((await workingCopyFactory(snapshot))());
    const structure = resolveStructure(snapshot);
    const sources = resolveSelectedSources(snapshot);
    sourceProblems = sources.problems;
    await withRedactedAudit('material review', async () => {
      for (const itemId of todo) {
        const item = structure.items.find((i) => i.id === itemId)!;
        const key = structure.answerKey.find((k) => k.itemId === itemId);
        const inputHash = itemInputHash(item, key, snapshot, paragraphs, checkDeps);
        const prior = snapshot.results.find((x) => x.itemId === itemId);
        // Identical inputs and no execution error: reuse instead of paying again.
        if (!opts.all && prior && prior.inputHash === inputHash && !prior.checks.some((c) => c.executionError)) {
          computed.set(itemId, { ...prior, stale: false, revision: snapshot.revision, dependencyFingerprint: captured.dependencyFingerprint });
          continue;
        }
        computed.set(itemId, await checkItem(item, key, snapshot, paragraphs, sources, checkDeps, captured));
      }
    });
  } catch (err) {
    return failRun(id, runId, err);
  }

  return withLock(id, async () => {
    // Async preparation first (review mutations cannot happen: we hold its
    // lock; registry/rule changes can, so they are compared only afterwards).
    const prepared = load(id);
    const paragraphs = currentParagraphs((await workingCopyFactory(prepared))());
    // From here to save() everything is synchronous: nothing can change
    // between the comparison and the write in this single-process server.
    const r = load(id);
    if (r.revision !== prepared.revision || runContext(r) !== captured.context || dependencyFingerprint(r) !== captured.dependencyFingerprint) {
      // Something the checks depend on changed while they ran: discard, never publish as current.
      finishRun(r, runId, 'obsolete', 'Մուտքային տվյալները փոխվել են ստուգման ընթացքում. արդյունքները չեն պահպանվել:');
      return save(r);
    }
    const structure = resolveStructure(r);
    let kept = 0;
    for (const [itemId, result] of computed) {
      const item = structure.items.find((i) => i.id === itemId);
      if (!item) continue;
      // Per-item inputs (e.g. a key set by the teacher meanwhile) must still match.
      if (itemInputHash(item, structure.answerKey.find((k) => k.itemId === itemId), r, paragraphs, checkDeps) !== result.inputHash) continue;
      r.results = [...r.results.filter((x) => x.itemId !== itemId), result];
      kept++;
    }
    // An accepted fix counts as re-checked once its item has a fresh result at this revision.
    for (const s of r.suggestions) {
      if (s.status === 'accepted' && s.recheck === 'pending' && isFresh(r.results.find((x) => x.itemId === s.itemId), r)) s.recheck = 'done';
    }
    if (sourceProblems.length) log(r, 'source_problems', sourceProblems.join(' '));
    finishRun(r, runId, 'succeeded');
    log(r, opts.kind ?? 'check', `${kept}/${todo.length} հարց, ${r.revision}`);
    return save(r);
  });
}

// ------------------------------------------------------------- suggestions

export async function suggest(id: string, deps: ReviewDeps): Promise<{ review: MaterialReview; problems: Record<string, string[]> }> {
  let runId = '';
  let snapshot!: MaterialReview;
  await mutate(id, (r) => {
    requireConfirmedSegmentation(r);
    runId = startRun(r, 'suggest').id;
    snapshot = structuredClone(r);
  });
  const problems: Record<string, string[]> = {};
  const proposals: MaterialSuggestion[] = [];
  try {
    const factory = await workingCopyFactory(snapshot);
    const paragraphs = currentParagraphs(factory());
    const structure = resolveStructure(snapshot);
    await withRedactedAudit('material review', async () => {
      for (const result of itemsNeedingFixes(snapshot)) {
        if (snapshot.suggestions.some((s) => s.itemId === result.itemId && s.status === 'proposed')) continue;
        try {
          const out = await proposeSuggestions(structure, result.itemId, paragraphs, result, factory, deps.provider, deps.modelId);
          proposals.push(...out.accepted);
          if (out.problems.length) problems[result.itemId] = out.problems;
          if (out.accepted.length === 0) problems[result.itemId] = [...(problems[result.itemId] ?? []), 'Վավեր ուղղում չի առաջարկվել. որոշումը ձերն է:'];
        } catch (err) {
          problems[result.itemId] = [`Մոդելի կանչը ձախողվեց. ${err instanceof Error ? err.message : String(err)}`];
        }
      }
    });
  } catch (err) {
    return failRun(id, runId, err);
  }
  const review = await mutate(id, (r) => {
    if (r.revision !== snapshot.revision) {
      finishRun(r, runId, 'obsolete', 'Փաստաթուղթը փոխվել է. առաջարկները չեն պահպանվել:');
      return;
    }
    let kept = 0;
    for (const p of proposals) {
      const res = r.results.find((x) => x.itemId === p.itemId);
      const before = snapshot.results.find((x) => x.itemId === p.itemId);
      // The finding it answers must be the same, still-fresh result.
      if (!isFresh(res, r) || res!.inputHash !== before?.inputHash) continue;
      r.suggestions.push({ ...p, basedOnInputHash: res!.inputHash });
      kept++;
    }
    finishRun(r, runId, 'succeeded');
    log(r, 'suggested', `${kept} առաջարկ`);
  });
  return { review, problems };
}

// --------------------------------------------------------------- decisions

/** Items whose checks depend on text the group changed (own paragraphs or a shared key line). */
function affectedItems(structure: ResolvedStructure, group: PatchGroup): Set<string> {
  const touched = new Set(group.patches.map((p) => p.paragraphId));
  const itemIds = new Set<string>();
  for (const item of structure.items) {
    const paras = [...item.stemParagraphIds, ...item.options.map((o) => o.paragraphId)];
    if (paras.some((p) => touched.has(p))) itemIds.add(item.id);
  }
  for (const k of structure.answerKey) if (k.span && touched.has(k.span.paragraphId)) itemIds.add(k.itemId);
  return itemIds;
}

/**
 * A patch over a typed question number ("3." at the start of the stem) can
 * shift which key entry belongs to which question: everything depends on it.
 */
function touchesTypedNumber(item: MaterialItem, textOf: (id: string) => string, patches: TextPatch[]): boolean {
  const first = item.stemParagraphIds[0];
  const m = /^\s*\d+\s*[.)]/.exec(textOf(first));
  if (!m) return false;
  return patches.some((p) => p.paragraphId === first && p.start < m[0].length);
}

async function rebuildWorkingCopy(review: MaterialReview): Promise<DocxWorkingCopy> {
  const bytes = repository.getMaterialFile(review.fileSha256);
  if (!bytes) throw new Error(`Original file for material ${review.id} is missing from storage`);
  const w = new DocxWorkingCopy(await openDocx(bytes));
  for (const g of review.acceptedGroups) {
    const res = w.applyGroup(g);
    if (!res.ok) throw new Error(`Stored accepted group ${g.id} no longer applies`);
  }
  return w;
}

async function recheckAfter(id: string, itemIds: string[], deps: ReviewDeps, committed: MaterialReview): Promise<MaterialReview> {
  if (itemIds.length === 0 || committed.segmentation?.status !== 'confirmed') return committed;
  try {
    return await runChecks(id, deps, { itemIds, kind: 'recheck' });
  } catch {
    // The failure is recorded on the run; the edit stays, marked 'recheck pending', and can be re-checked.
    return load(id);
  }
}

/**
 * Accept or reject a proposal. Bound to the revision the teacher saw; a
 * second click, another tab or a stale proposal gets a ConflictError. An
 * accepted fix is applied atomically, then the affected questions are
 * re-checked; until that finishes the fix is 'accepted' with recheck 'pending'.
 */
export async function decide(
  id: string,
  suggestionId: string,
  input: { decision?: unknown; replacements?: unknown; expectedRevision?: unknown },
  deps: ReviewDeps
): Promise<MaterialReview> {
  let recheckIds: string[] = [];
  const committed = await withLock(id, async () => {
    const review = load(id);
    requireConfirmedSegmentation(review);
    const s = review.suggestions.find((x) => x.id === suggestionId);
    if (!s) throw new UserInputError(`Անհայտ առաջարկ՝ «${suggestionId}»:`);
    if (s.status !== 'proposed') {
      // Persist an invalidation load() may just have made, then refuse.
      save(review);
      throw new ConflictError('Այս առաջարկի վերաբերյալ որոշումն արդեն կայացված է կամ այն այլևս կիրառելի չէ (օրինակ՝ աղբյուրը կամ կանոնը փոխվել է): Կատարեք նոր ստուգում:');
    }
    requireRevision(review, input.expectedRevision);
    // The finding this proposal answers must still be the current, fresh
    // result: evidence from a replaced source or an outdated rule is not a
    // basis for changing the document (server-side, whatever the UI shows).
    const basis = review.results.find((x) => x.itemId === s.itemId);
    if (input.decision === 'accept' && (!basis || basis.stale || (s.basedOnInputHash && basis.inputHash !== s.basedOnInputHash))) {
      s.status = 'superseded';
      save(review);
      throw new ConflictError('Առաջարկի հիմքը (ստուգման արդյունքը կամ աղբյուրը) այլևս արդիական չէ. փաստաթուղթը չի փոխվել: Կատարեք նոր ստուգում և նոր առաջարկ:');
    }

    if (input.decision === 'reject') {
      // Declining a change says nothing about the finding: a failed check stays failed.
      s.status = 'rejected';
      s.decidedAt = now();
      log(review, 'rejected', s.id);
      return save(review);
    }
    if (input.decision !== 'accept') throw new UserInputError('«decision» պետք է լինի accept կամ reject:');

    // A teacher edit of the proposed text is a new proposal revision, validated like the original.
    let target: MaterialSuggestion = s;
    if (input.replacements !== undefined) {
      if (!input.replacements || typeof input.replacements !== 'object') throw new UserInputError('«replacements» պետք է լինի օբյեկտ:');
      const repl = input.replacements as Record<string, unknown>;
      for (const pid of Object.keys(repl)) {
        if (!s.group.patches.some((p) => p.id === pid)) throw new UserInputError(`Անհայտ փոփոխություն՝ «${pid}»:`);
        if (typeof repl[pid] !== 'string') throw new UserInputError(`«${pid}» փոփոխության տեքստը պետք է լինի տող:`);
      }
      if (s.group.patches.some((p) => repl[p.id] !== undefined && repl[p.id] !== p.replacement)) {
        const rev = review.suggestions.filter((x) => x.id.startsWith(`${s.id}-t`)).length + 1;
        target = {
          ...s,
          id: `${s.id}-t${rev}`,
          group: {
            id: `${s.group.id}-t${rev}`,
            patches: s.group.patches.map((p) => (repl[p.id] === undefined ? p : { ...p, id: `${p.id}-t${rev}`, replacement: repl[p.id] as string })),
          },
          editedByTeacher: true,
        };
      }
    }

    const factory = await workingCopyFactory(review);
    const w = factory();
    const structure = resolveStructure(review);
    const key = structure.answerKey.find((k) => k.itemId === target.itemId);

    // A key change without any text edit: only a key the teacher set by hand
    // can change this way. The document gets no new key text.
    if (target.group.patches.length === 0) {
      const entry = review.answerKey.find((k) => k.itemId === target.itemId);
      if (!target.keyChange || !entry || entry.origin !== 'teacher') {
        throw new UserInputError('Ուղղումը չի պարունակում փոփոխություն, որը հնարավոր է կիրառել:');
      }
      target.keyBefore = [...entry.optionLabels];
      entry.optionLabels = [...target.keyChange];
      target.status = 'accepted';
      target.decidedAt = now();
      target.recheck = 'pending';
      if (target !== s) {
        s.status = 'superseded';
        review.suggestions.push(target);
      }
      recheckIds = [target.itemId];
      markStale(review, recheckIds);
      log(review, 'accepted', `${target.id} (միայն ուսուցչի բանալին, փաստաթուղթը չի փոխվել)`);
      return save(review);
    }
    if (target.keyChange && key?.origin === 'document' && key.span) {
      const probe = factory();
      const dry = probe.applyGroup(target.group);
      if (dry.ok && !keyEntryMatches(probe, key.span, target.group, target.keyChange)) {
        throw new UserInputError('Խմբագրված բանալու տեքստն այլևս չի համապատասխանում առաջարկված ճիշտ պատասխանին:');
      }
    }
    const textBefore = (pid: string) => w.paragraphText(pid) ?? '';
    const numberingTouched = structure.items.some((it) => touchesTypedNumber(it, textBefore, target.group.patches));
    const itemIds = affectedItems(structure, target.group);

    const result = w.applyGroup(target.group);
    if (!result.ok) {
      if (result.errors.some((e) => e.code === 'stale' || e.code === 'expected_mismatch')) {
        s.status = 'superseded';
        save(review);
      }
      throw new UserInputError(`Ուղղումը չի կիրառվել. ${result.errors.map((e) => `${e.code}: ${e.detail}`).join('; ')}`);
    }

    review.acceptedGroups.push(target.group);
    review.revision = result.revision;
    const keyEntry = review.answerKey.find((k) => k.itemId === target.itemId);
    if (target.keyChange && keyEntry) {
      target.keyBefore = [...keyEntry.optionLabels];
      keyEntry.optionLabels = [...target.keyChange];
    }
    target.status = 'accepted';
    target.decidedAt = now();
    target.recheck = 'pending';
    if (target !== s) {
      s.status = 'superseded';
      s.decidedAt = now();
      review.suggestions.push(target);
    }

    recheckIds = numberingTouched ? [] : [...itemIds];
    markStale(review, numberingTouched ? allItemIds(review) : itemIds);
    if (numberingTouched) {
      review.segmentation!.status = 'needs_reconfirmation';
      log(review, 'numbering_touched', 'Հարցի համարը փոխվել է. բաժանումը պետք է նորից հաստատել:');
    }
    for (const other of review.suggestions) {
      if (other.status === 'proposed' && other.group.patches.some((p) => w.checkPatch(p) !== null)) other.status = 'superseded';
    }
    log(review, 'accepted', `${target.id}${target.editedByTeacher ? ' (խմբագրված)' : ''} -> ${review.revision}`);
    return save(review);
  });
  return recheckAfter(id, recheckIds, deps, committed);
}

/**
 * Undo the most recently accepted fix by rebuilding the document from the
 * original plus the remaining groups (not by reverse string replacement).
 * The proposal becomes 'proposed' again and the affected questions are
 * re-checked.
 */
export async function undoLast(id: string, expectedRevision: unknown, deps: ReviewDeps): Promise<MaterialReview> {
  let recheckIds: string[] = [];
  const committed = await withLock(id, async () => {
    const review = load(id);
    requireRevision(review, expectedRevision);
    const last = review.acceptedGroups[review.acceptedGroups.length - 1];
    if (!last) throw new UserInputError('Չեղարկելու ընդունված ուղղում չկա:');
    if (review.segmentation && review.acceptedGroups.length <= review.segmentation.atGroupCount) {
      throw new UserInputError('Այս ուղղումն ընդունվել է ընթացիկ բաժանումից առաջ. այն չեղարկելու համար նախ պետք է փաստաթուղթը նորից բաժանել:');
    }
    const itemIds = affectedItems(resolveStructure(review), last);
    review.acceptedGroups.pop();
    const w = await rebuildWorkingCopy(review);
    review.revision = w.revision;

    const s = review.suggestions.find((x) => x.status === 'accepted' && x.group.id === last.id);
    recheckIds = [...itemIds];
    markStale(review, recheckIds);
    if (s) {
      const keyEntry = review.answerKey.find((k) => k.itemId === s.itemId);
      if (s.keyBefore && keyEntry) keyEntry.optionLabels = [...s.keyBefore];
      // Valid again at the restored revision: the teacher can decide anew.
      s.status = 'proposed';
      s.decidedAt = undefined;
      s.recheck = undefined;
      s.keyBefore = undefined;
    }
    for (const other of review.suggestions) {
      if (other !== s && other.status === 'proposed' && other.group.patches.some((p) => w.checkPatch(p) !== null)) other.status = 'superseded';
    }
    log(review, 'undone', `${last.id} -> ${review.revision}`);
    return save(review);
  });
  return recheckAfter(id, recheckIds, deps, committed);
}

// ------------------------------------------------------------------ status

export interface ReviewStatus {
  final: boolean;
  counts: Record<MaterialCheckStatus, number> & {
    staleItems: number;
    uncheckedItems: number;
    pendingSuggestions: number;
    pendingRechecks: number;
    executionErrors: number;
    runningRuns: number;
  };
  reasons: string[];
}

/** "Final" only when every item has fresh checks that all passed and nothing is pending. */
export function reviewStatus(review: MaterialReview): ReviewStatus {
  const counts = {
    pass: 0,
    fail: 0,
    needs_review: 0,
    not_evaluated: 0,
    staleItems: 0,
    uncheckedItems: 0,
    pendingSuggestions: 0,
    pendingRechecks: 0,
    executionErrors: 0,
    runningRuns: 0,
  };
  const reasons: string[] = [];
  const items = review.segmentation?.items ?? [];
  if (review.segmentation?.status !== 'confirmed') reasons.push('Հարցերի բաժանումը հաստատված չէ:');
  for (const item of items) {
    const r = review.results.find((x) => x.itemId === item.id);
    if (!r) { counts.uncheckedItems++; continue; }
    if (r.stale) counts.staleItems++;
    for (const c of r.checks) {
      counts[c.status]++;
      if (c.executionError) counts.executionErrors++;
    }
  }
  counts.pendingSuggestions = review.suggestions.filter((s) => s.status === 'proposed').length;
  counts.pendingRechecks = review.suggestions.filter((s) => s.status === 'accepted' && s.recheck === 'pending').length;
  counts.runningRuns = (review.runs ?? []).filter((r) => r.status === 'running').length;
  if (items.length === 0) reasons.push('Հարցեր չեն գտնվել:');
  if (counts.uncheckedItems) reasons.push(`${counts.uncheckedItems} հարց չի ստուգվել:`);
  if (counts.staleItems) reasons.push(`${counts.staleItems} հարցի ստուգումը հնացել է և պետք է կրկնել:`);
  if (counts.fail) reasons.push(`${counts.fail} ստուգում ձախողվել է:`);
  if (counts.needs_review) reasons.push(`${counts.needs_review} ստուգում պահանջում է որոշում:`);
  if (counts.not_evaluated) reasons.push(`${counts.not_evaluated} ստուգում չի կատարվել:`);
  if (counts.pendingSuggestions) reasons.push(`${counts.pendingSuggestions} առաջարկ սպասում է որոշման:`);
  if (counts.pendingRechecks) reasons.push(`${counts.pendingRechecks} ընդունված ուղղում դեռ չի վերստուգվել:`);
  if (counts.runningRuns) reasons.push('Գործողություն է ընթանում:');
  return { final: reasons.length === 0, counts, reasons };
}

/** Non-empty paragraphs that belong to no question, option or key: shown so nothing is silently skipped. */
export function unassignedParagraphs(review: MaterialReview, paragraphs: MaterialParagraph[]): string[] {
  const seg = review.segmentation;
  if (!seg) return [];
  const used = new Set<string>(seg.answerKeyParagraphIds);
  for (const it of seg.items) {
    it.stemParagraphIds.forEach((p) => used.add(p));
    it.options.forEach((o) => used.add(o.paragraphId));
  }
  return paragraphs.filter((p) => p.text.trim() !== '' && !used.has(p.id)).map((p) => p.id);
}

/** Serialises a read with in-flight writes, so an export never sees half a decision. */
export function readConsistent<T>(id: string, fn: (r: MaterialReview) => Promise<T>): Promise<T> {
  return withLock(id, () => fn(load(id)));
}
