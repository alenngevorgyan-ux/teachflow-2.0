import crypto from 'crypto';
import type {
  MaterialCheckStatus,
  MaterialItem,
  MaterialParagraph,
  MaterialReview,
  MaterialSuggestion,
  PatchGroup,
  TextPatch,
} from '../../shared/types.js';
import { openDocx } from '../docx/docxModel.js';
import { UserInputError } from '../pipeline/errors.js';
import { isSourceConfirmed, sourceContentHash } from '../pipeline/sourceConfirmation.js';
import { IJudgeProvider } from '../providers/judgeProvider.js';
import { IModelProvider } from '../providers/modelProvider.js';
import { repository } from '../store/repository.js';
import { CheckDeps, checkItem, resolveSelectedSources } from './checks.js';
import { proposeSegmentation } from './segmentation.js';
import { itemsNeedingFixes, keyEntryMatches, proposeSuggestions } from './suggestions.js';
import { currentParagraphs, mapSpan, workingCopyFactory } from './workingCopy.js';

export interface ReviewDeps {
  provider: IModelProvider;
  judge: IJudgeProvider;
  modelId?: string;
  retrieve?: CheckDeps['retrieve'];
}

function now(): string {
  return new Date().toISOString();
}

function log(review: MaterialReview, action: string, detail: string): void {
  review.log.push({ at: now(), action, detail });
}

function requireReview(id: string): MaterialReview {
  const r = repository.getMaterialReview(id);
  if (!r) throw new UserInputError(`Անհայտ նյութ՝ «${id}»:`);
  return structuredClone(r);
}

function requireConfirmedSegmentation(review: MaterialReview): void {
  if (review.segmentation?.status !== 'confirmed') {
    throw new UserInputError('Սկզբում հաստատեք փաստաթղթի բաժանումը հարցերի:');
  }
}

function markStale(review: MaterialReview, itemIds: Iterable<string>): void {
  const set = new Set(itemIds);
  for (const r of review.results) if (set.has(r.itemId)) r.stale = true;
  // Proposals made for findings that are being re-evaluated no longer apply.
  for (const s of review.suggestions) if (s.status === 'proposed' && set.has(s.itemId)) s.status = 'stale';
}

function allItemIds(review: MaterialReview): string[] {
  return review.segmentation?.items.map((i) => i.id) ?? [];
}

// ------------------------------------------------------------------ create

export async function createReview(input: { fileName: unknown; subject: unknown; grade: unknown; bytes: Uint8Array }): Promise<MaterialReview> {
  const fileName = typeof input.fileName === 'string' ? input.fileName.trim() : '';
  const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
  if (!fileName || !subject) throw new UserInputError('Պարտադիր դաշտերը բացակայում են՝ fileName, subject:');
  if (!/\.docx$/i.test(fileName)) throw new UserInputError('Աջակցվում է միայն .docx ֆայլ:');
  const gradeStr = typeof input.grade === 'string' ? input.grade.trim() : typeof input.grade === 'number' ? String(input.grade) : '';
  if (!/^\d+$/.test(gradeStr) || Number(gradeStr) < 1) throw new UserInputError('«grade» դաշտը պարտադիր է և պետք է լինի դասարանի համար:');

  // Safety, structure and the privacy check all happen here, before anything is stored.
  const doc = await openDocx(input.bytes);
  repository.saveMaterialFile(doc.sha256, input.bytes);

  const review: MaterialReview = {
    id: `mat-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
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
  };
  log(review, 'uploaded', `${fileName} (${doc.paragraphs.length} պարբերություն)`);
  return repository.saveMaterialReview(review);
}

// ----------------------------------------------------------------- sources

export function selectSources(id: string, programSourceIds: unknown, factSourceIds: unknown): MaterialReview {
  const review = requireReview(id);
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
    selected.push({ sourceId: s.id, purpose, version: s.version, contentHash: sourceContentHash(s) });
  };
  program.forEach((sid) => add(sid, 'program'));
  fact.forEach((sid) => add(sid, 'fact'));
  if (problems.length) throw new UserInputError(problems.join(' '));

  review.selectedSources = selected;
  markStale(review, allItemIds(review));
  log(review, 'sources_selected', selected.map((s) => `${s.purpose}:${s.sourceId}@${s.version}`).join(', ') || '—');
  return repository.saveMaterialReview(review);
}

// ------------------------------------------------------------ segmentation

export async function segment(id: string, deps: ReviewDeps): Promise<MaterialReview> {
  const review = requireReview(id);
  const w = (await workingCopyFactory(review))();
  const { segmentation, answerKey } = await proposeSegmentation(currentParagraphs(w), review.revision, deps.provider, deps.modelId);
  review.segmentation = segmentation;
  // Teacher-set keys survive only for items that still exist under the same id; they are re-validated on confirm.
  review.answerKey = [...answerKey, ...review.answerKey.filter((k) => k.origin === 'teacher' && !answerKey.some((a) => a.itemId === k.itemId))];
  review.results = [];
  for (const s of review.suggestions) if (s.status === 'proposed') s.status = 'stale';
  log(review, 'segmentation_proposed', `${segmentation.items.length} հարց, ${segmentation.problems.length} խնդիր (${segmentation.model.modelId})`);
  return repository.saveMaterialReview(review);
}

export function confirmSegmentation(id: string, expectedRevision: unknown): MaterialReview {
  const review = requireReview(id);
  if (!review.segmentation) throw new UserInputError('Բաժանումը դեռ առաջարկված չէ:');
  if (expectedRevision !== review.revision) throw new UserInputError('Փաստաթուղթը փոխվել է. թարմացրեք էջը և ստուգեք բաժանումը նորից:');
  const items = new Map(review.segmentation.items.map((i) => [i.id, i]));
  review.answerKey = review.answerKey.filter((k) => {
    const item = items.get(k.itemId);
    return item && k.optionLabels.every((l) => item.options.some((o) => o.label === l) || k.origin === 'document');
  });
  review.segmentation.status = 'confirmed';
  review.segmentation.confirmedAt = now();
  markStale(review, allItemIds(review));
  log(review, 'segmentation_confirmed', `${review.segmentation.items.length} հարց`);
  return repository.saveMaterialReview(review);
}

export function setTeacherKey(id: string, itemId: string, optionLabels: unknown): MaterialReview {
  const review = requireReview(id);
  requireConfirmedSegmentation(review);
  const item = review.segmentation!.items.find((i) => i.id === itemId);
  if (!item) throw new UserInputError(`Անհայտ հարց՝ «${itemId}»:`);
  if (!Array.isArray(optionLabels) || optionLabels.length === 0 || optionLabels.some((l) => typeof l !== 'string')) {
    throw new UserInputError('«optionLabels» պետք է լինի տարբերակների նշանների ոչ դատարկ ցուցակ:');
  }
  const labels = [...new Set(optionLabels as string[])];
  const unknown = labels.filter((l) => !item.options.some((o) => o.label === l));
  if (unknown.length) throw new UserInputError(`«${item.number}» հարցը չունի «${unknown.join(', ')}» տարբերակ:`);
  const existing = review.answerKey.find((k) => k.itemId === itemId);
  if (existing?.origin === 'document') {
    throw new UserInputError('Այս հարցի բանալին գրված է փաստաթղթում: Փոխեք այն փաստաթղթում կամ ընդունեք ուղղում:');
  }
  review.answerKey = [...review.answerKey.filter((k) => k.itemId !== itemId), { itemId, optionLabels: labels, origin: 'teacher' }];
  markStale(review, [itemId]);
  log(review, 'teacher_key_set', `${item.number}: ${labels.join(', ')}`);
  return repository.saveMaterialReview(review);
}

// ------------------------------------------------------------------ checks

async function runChecksOn(review: MaterialReview, paragraphs: MaterialParagraph[], itemIds: string[], deps: ReviewDeps): Promise<void> {
  const sources = resolveSelectedSources(review);
  const checkDeps: CheckDeps = { provider: deps.provider, judge: deps.judge, modelId: deps.modelId, retrieve: deps.retrieve };
  for (const itemId of itemIds) {
    const item = review.segmentation!.items.find((i) => i.id === itemId);
    if (!item) continue;
    const result = await checkItem(item, review, paragraphs, sources, checkDeps);
    review.results = [...review.results.filter((r) => r.itemId !== itemId), result];
  }
  if (sources.problems.length) log(review, 'source_problems', sources.problems.join(' '));
  // An accepted fix counts as re-checked once its item has fresh results at this revision.
  for (const s of review.suggestions) {
    if (s.status !== 'accepted' || s.recheck !== 'pending') continue;
    const r = review.results.find((x) => x.itemId === s.itemId);
    if (r && !r.stale && r.revision === review.revision) s.recheck = 'done';
  }
}

/** Checks every item that has no result yet or whose result is stale (or all with `all`). */
export async function runChecks(id: string, deps: ReviewDeps, opts: { all?: boolean } = {}): Promise<MaterialReview> {
  const review = requireReview(id);
  requireConfirmedSegmentation(review);
  const w = (await workingCopyFactory(review))();
  const fresh = new Set(review.results.filter((r) => !r.stale && r.revision === review.revision).map((r) => r.itemId));
  const todo = allItemIds(review).filter((iid) => opts.all || !fresh.has(iid));
  await runChecksOn(review, currentParagraphs(w), todo, deps);
  log(review, 'checked', `${todo.length} հարց, ${review.revision}`);
  return repository.saveMaterialReview(review);
}

// ------------------------------------------------------------- suggestions

export async function suggest(id: string, deps: ReviewDeps): Promise<{ review: MaterialReview; problems: Record<string, string[]> }> {
  const review = requireReview(id);
  requireConfirmedSegmentation(review);
  const factory = await workingCopyFactory(review);
  const paragraphs = currentParagraphs(factory());
  const problems: Record<string, string[]> = {};
  for (const result of itemsNeedingFixes(review)) {
    if (review.suggestions.some((s) => s.itemId === result.itemId && s.status === 'proposed')) continue;
    try {
      const out = await proposeSuggestions(review, result.itemId, paragraphs, result, factory, deps.provider, deps.modelId);
      review.suggestions.push(...out.accepted);
      if (out.problems.length) problems[result.itemId] = out.problems;
      if (out.accepted.length === 0) {
        problems[result.itemId] = [...(problems[result.itemId] ?? []), 'Վավեր ուղղում չի առաջարկվել. որոշումը ձերն է:'];
      }
    } catch (err) {
      problems[result.itemId] = [`Մոդելի կանչը ձախողվեց. ${err instanceof Error ? err.message : String(err)}`];
    }
  }
  log(review, 'suggested', `${review.suggestions.filter((s) => s.status === 'proposed').length} առաջարկ`);
  return { review: repository.saveMaterialReview(review), problems };
}

// --------------------------------------------------------------- decisions

/** Items whose checks depend on text the group changed. */
function affectedItems(review: MaterialReview, group: PatchGroup): Set<string> {
  const touched = new Set(group.patches.map((p) => p.paragraphId));
  const itemIds = new Set<string>();
  for (const item of review.segmentation!.items) {
    const paras = [...item.stemParagraphIds, ...item.options.map((o) => o.paragraphId)];
    if (paras.some((p) => touched.has(p))) itemIds.add(item.id);
  }
  // A shared key line or table cell: every item keyed in a touched paragraph.
  for (const k of review.answerKey) if (k.span && touched.has(k.span.paragraphId)) itemIds.add(k.itemId);
  return itemIds;
}

/**
 * A patch over a typed question number ("3." at the start of the stem) can
 * shift which key entry belongs to which question: everything depends on it.
 */
function touchesTypedNumber(item: MaterialItem, paragraphTextBefore: (id: string) => string, patches: TextPatch[]): boolean {
  const first = item.stemParagraphIds[0];
  const m = /^\s*\d+\s*[.)]/.exec(paragraphTextBefore(first));
  if (!m) return false;
  return patches.some((p) => p.paragraphId === first && p.start < m[0].length);
}

export async function decide(
  id: string,
  suggestionId: string,
  input: { decision?: unknown; replacements?: unknown; expectedRevision?: unknown },
  deps: ReviewDeps
): Promise<MaterialReview> {
  const review = requireReview(id);
  requireConfirmedSegmentation(review);
  const s = review.suggestions.find((x) => x.id === suggestionId);
  if (!s) throw new UserInputError(`Անհայտ առաջարկ՝ «${suggestionId}»:`);
  if (s.status !== 'proposed') throw new UserInputError(`Առաջարկն արդեն ${s.status} է:`);
  if (input.expectedRevision !== review.revision) throw new UserInputError('Փաստաթուղթը փոխվել է. թարմացրեք էջը:');

  if (input.decision === 'reject') {
    // Rejecting a fix changes nothing about the finding: a failed check stays failed.
    s.status = 'rejected';
    s.decidedAt = now();
    log(review, 'rejected', s.id);
    return repository.saveMaterialReview(review);
  }
  if (input.decision !== 'accept') throw new UserInputError('«decision» պետք է լինի accept կամ reject:');

  // Teacher edits of the proposed text: same range, new replacement.
  let group = s.group;
  let edited = false;
  if (input.replacements !== undefined) {
    if (!input.replacements || typeof input.replacements !== 'object') throw new UserInputError('«replacements» պետք է լինի օբյեկտ:');
    const repl = input.replacements as Record<string, unknown>;
    for (const pid of Object.keys(repl)) {
      if (!group.patches.some((p) => p.id === pid)) throw new UserInputError(`Անհայտ փոփոխություն՝ «${pid}»:`);
      if (typeof repl[pid] !== 'string') throw new UserInputError(`«${pid}» փոփոխության տեքստը պետք է լինի տող:`);
    }
    group = {
      id: `${group.id}-edited`,
      patches: group.patches.map((p) => {
        if (repl[p.id] === undefined || repl[p.id] === p.replacement) return p;
        edited = true;
        return { ...p, replacement: repl[p.id] as string };
      }),
    };
  }

  const factory = await workingCopyFactory(review);
  const w = factory();
  const before = (pid: string) => w.paragraphText(pid) ?? '';

  // A key change must still match the (possibly edited) key text.
  const key = review.answerKey.find((k) => k.itemId === s.itemId);
  if (s.keyChange && key?.origin === 'document' && key.span) {
    const probe = factory();
    const dry = probe.applyGroup(group);
    if (dry.ok && !keyEntryMatches(probe, key.span, group, s.keyChange)) {
      throw new UserInputError('Խմբագրված բանալու տեքստն այլևս չի համապատասխանում առաջարկված ճիշտ պատասխանին:');
    }
  }

  const numberingTouched = review.segmentation!.items.some((it) => touchesTypedNumber(it, before, group.patches));
  const itemIds = affectedItems(review, group);

  const result = w.applyGroup(group);
  if (!result.ok) {
    if (result.errors.some((e) => e.code === 'stale' || e.code === 'expected_mismatch')) s.status = 'stale';
    repository.saveMaterialReview(review);
    throw new UserInputError(`Ուղղումը չի կիրառվել. ${result.errors.map((e) => `${e.code}: ${e.detail}`).join('; ')}`);
  }

  // Commit: new revision, spans moved to the new text.
  review.acceptedGroups.push(group);
  review.revision = result.revision;
  for (const item of review.segmentation!.items) {
    item.options = item.options.map((o) => ({ ...o, ...mapSpan(o, group).span }));
  }
  for (const k of review.answerKey) if (k.span) k.span = mapSpan(k.span, group).span;
  if (s.keyChange && key) key.optionLabels = [...s.keyChange];

  s.status = 'accepted';
  s.decidedAt = now();
  s.editedByTeacher = edited || undefined;
  s.group = group;
  s.recheck = 'pending';

  const staleIds = numberingTouched ? allItemIds(review) : [...itemIds];
  markStale(review, staleIds);
  if (numberingTouched) {
    review.segmentation!.status = 'needs_reconfirmation';
    log(review, 'numbering_touched', 'Հարցի համարը փոխվել է. բաժանումը պետք է նորից հաստատել:');
  }
  // Other proposals whose patches no longer apply at the new revision.
  for (const other of review.suggestions) {
    if (other.status !== 'proposed') continue;
    if (other.group.patches.some((p) => w.checkPatch(p) !== null)) other.status = 'stale';
  }
  log(review, 'accepted', `${s.id}${edited ? ' (խմբագրված)' : ''} -> ${review.revision}`);
  repository.saveMaterialReview(review);

  // The accepted text is not considered checked until the affected items are re-checked.
  if (!numberingTouched) {
    await runChecksOn(review, currentParagraphs(w), staleIds, deps);
    log(review, 'rechecked', staleIds.join(', '));
  }
  return repository.saveMaterialReview(review);
}

// ------------------------------------------------------------------ status

export interface ReviewStatus {
  final: boolean;
  counts: Record<MaterialCheckStatus, number> & { staleItems: number; uncheckedItems: number; pendingSuggestions: number; pendingRechecks: number };
  reasons: string[];
}

/** "Final" only when every item has fresh checks that all passed and nothing is pending. */
export function reviewStatus(review: MaterialReview): ReviewStatus {
  const counts = { pass: 0, fail: 0, needs_review: 0, not_evaluated: 0, staleItems: 0, uncheckedItems: 0, pendingSuggestions: 0, pendingRechecks: 0 };
  const reasons: string[] = [];
  const items = review.segmentation?.items ?? [];
  if (review.segmentation?.status !== 'confirmed') reasons.push('Հարցերի բաժանումը հաստատված չէ:');
  for (const item of items) {
    const r = review.results.find((x) => x.itemId === item.id);
    if (!r) { counts.uncheckedItems++; continue; }
    if (r.stale || r.revision !== review.revision) counts.staleItems++;
    for (const c of r.checks) counts[c.status]++;
  }
  counts.pendingSuggestions = review.suggestions.filter((s) => s.status === 'proposed').length;
  counts.pendingRechecks = review.suggestions.filter((s) => s.status === 'accepted' && s.recheck === 'pending').length;
  if (items.length === 0) reasons.push('Հարցեր չեն գտնվել:');
  if (counts.uncheckedItems) reasons.push(`${counts.uncheckedItems} հարց չի ստուգվել:`);
  if (counts.staleItems) reasons.push(`${counts.staleItems} հարցի ստուգումը հնացել է և պետք է կրկնել:`);
  if (counts.fail) reasons.push(`${counts.fail} ստուգում ձախողվել է:`);
  if (counts.needs_review) reasons.push(`${counts.needs_review} ստուգում պահանջում է որոշում:`);
  if (counts.not_evaluated) reasons.push(`${counts.not_evaluated} ստուգում չի կատարվել:`);
  if (counts.pendingSuggestions) reasons.push(`${counts.pendingSuggestions} առաջարկ սպասում է որոշման:`);
  if (counts.pendingRechecks) reasons.push(`${counts.pendingRechecks} ընդունված ուղղում դեռ չի վերստուգվել:`);
  return { final: reasons.length === 0, counts, reasons };
}

export function getReview(id: string): MaterialReview {
  return requireReview(id);
}

export type { MaterialSuggestion };
