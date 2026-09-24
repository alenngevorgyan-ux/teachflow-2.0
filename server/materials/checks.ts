import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type {
  CurriculumOutcome,
  MaterialAnswerKeyEntry,
  MaterialCheck,
  MaterialEvidence,
  MaterialItem,
  MaterialItemResult,
  MaterialParagraph,
  MaterialReview,
  Source,
} from '../../shared/types.js';
import { COVERAGE_SIMILARITY_THRESHOLD } from '../pipeline/coverage.js';
import { RetrievedChunk, retrieveChunks } from '../pipeline/retrieval.js';
import { isSourceConfirmed, sourceContentHash } from '../pipeline/sourceConfirmation.js';
import { IJudgeProvider } from '../providers/judgeProvider.js';
import { IModelProvider } from '../providers/modelProvider.js';
import { repository } from '../store/repository.js';

export const PROGRAM_SCOPE_PROMPT_VERSION = 'program_scope.v1';
export const UNAMBIGUOUS_PROMPT_VERSION = 'answer_unambiguous.v1';
export const JUDGE_CONFIDENCE_THRESHOLD = 0.8;
const EVIDENCE_CHUNKS = 3;

export interface CheckDeps {
  provider: IModelProvider;
  judge: IJudgeProvider;
  modelId?: string;
  retrieve?: typeof retrieveChunks;
}

// ------------------------------------------------------------------ sources

export interface ResolvedSources {
  program: Source[];
  fact: Source[];
  problems: string[];
}

/**
 * Only the sources the user selected, and only while each is still confirmed
 * at the version and content it had when selected. Nothing else of the same
 * subject is added.
 */
export function resolveSelectedSources(review: MaterialReview): ResolvedSources {
  const out: ResolvedSources = { program: [], fact: [], problems: [] };
  for (const sel of review.selectedSources) {
    const s = repository.getSource(sel.sourceId);
    if (!s) { out.problems.push(`«${sel.sourceId}» աղբյուրն այլևս գոյություն չունի:`); continue; }
    if (!isSourceConfirmed(s)) { out.problems.push(`«${s.title}» աղբյուրն այլևս հաստատված չէ:`); continue; }
    if (s.version !== sel.version || sourceContentHash(s) !== sel.contentHash) {
      out.problems.push(`«${s.title}» աղբյուրը փոխվել է ընտրվելուց հետո. ընտրեք այն նորից:`);
      continue;
    }
    (sel.purpose === 'program' ? out.program : out.fact).push(s);
  }
  return out;
}

// ------------------------------------------------------------------- texts

export interface ItemText {
  item: MaterialItem;
  stem: string;
  options: { label: string; text: string }[];
  key?: MaterialAnswerKeyEntry;
}

export function itemText(item: MaterialItem, paragraphs: MaterialParagraph[], key?: MaterialAnswerKeyEntry): ItemText {
  const byId = new Map(paragraphs.map((p) => [p.id, p]));
  const stemPart = (id: string) => {
    const text = byId.get(id)?.text ?? '';
    const sp = item.stemSpans?.find((s) => s.paragraphId === id);
    return sp ? text.slice(sp.start, sp.end) : text;
  };
  return {
    item,
    stem: item.stemParagraphIds.map(stemPart).join('\n'),
    options: item.options.map((o) => ({ label: o.label, text: (byId.get(o.paragraphId)?.text ?? '').slice(o.start, o.end) })),
    key,
  };
}

function describeItem(t: ItemText): string {
  const opts = t.options.map((o) => `  ${o.text}`).join('\n');
  // The stem may already contain inline options; list them separately only when they are elsewhere.
  return `${t.item.number}. ${t.stem}${opts && !t.options.every((o) => t.stem.includes(o.text)) ? `\n${opts}` : ''}`;
}

function describeKey(t: ItemText): string {
  if (!t.key) return 'չկա';
  return t.key.optionLabels
    .map((l) => t.options.find((o) => o.label === l)?.text ?? `${l} (նման տարբերակ չկա)`)
    .join('; ');
}

// ----------------------------------------------------------- deterministic

function deterministicChecks(t: ItemText): MaterialCheck[] {
  const checks: MaterialCheck[] = [];
  const type = t.item.type;

  // An unrecognised or ambiguous type is not judged: the teacher corrects the split.
  if (type === 'other') {
    checks.push({
      checkId: 'question_type',
      kind: 'deterministic',
      status: 'not_evaluated',
      detail: 'Հարցի տեսակը որոշված չէ կամ V1-ում չի աջակցվում: Ուղղեք բաժանումը՝ տեսակ ընտրելով:',
    });
    return checks;
  }
  // Open questions have no option key: key checks do not apply to them.
  if (type === 'open') return checks;

  if (!t.key) {
    checks.push({
      checkId: 'key_present',
      kind: 'deterministic',
      status: 'not_evaluated',
      detail: 'Բանալին չի գտնվել. փաստաթղթում այս հարցի համար բացահայտ պատասխան չկա: Նշեք այն ձեռքով՝ բանալու ստուգումները միացնելու համար:',
    });
  } else {
    checks.push({
      checkId: 'key_present',
      kind: 'deterministic',
      status: 'pass',
      detail: t.key.origin === 'teacher' ? 'Բանալին նշել է ուսուցիչը:' : 'Բանալին գտնվել է փաստաթղթում:',
    });
    const labels = new Set(t.options.map((o) => o.label));
    const missing = t.key.optionLabels.filter((l) => !labels.has(l));
    if (t.key.optionLabels.length === 0 || missing.length) {
      checks.push({
        checkId: 'key_valid_option',
        kind: 'deterministic',
        status: 'fail',
        detail: missing.length ? `Բանալին նշում է «${missing.join(', ')}» տարբերակ(ներ), որոնք հարցում չկան:` : 'Բանալին ոչ մի տարբերակ չի նշում:',
      });
    } else if (type === 'single_choice' && t.key.optionLabels.length > 1) {
      checks.push({
        checkId: 'key_valid_option',
        kind: 'deterministic',
        status: 'fail',
        detail: `Մեկ ճիշտ պատասխանով հարց է, բայց բանալին նշում է ${t.key.optionLabels.length} պատասխան:`,
      });
    } else {
      checks.push({ checkId: 'key_valid_option', kind: 'deterministic', status: 'pass', detail: 'Բանալին նշում է հարցում առկա տարբերակ(ներ):' });
    }
  }

  // The option-count rule is defined for single-choice questions only.
  if (type === 'single_choice') {
    const bounds = optionBoundsRule();
    if (bounds === 'inactive') {
      checks.push({ checkId: 'option_count', kind: 'deterministic', status: 'not_evaluated', detail: 'Տարբերակների քանակի կանոնն (rule-single-correct-answer) ակտիվ չէ:' });
    } else if (bounds === 'invalid') {
      checks.push({ checkId: 'option_count', kind: 'deterministic', status: 'not_evaluated', detail: 'Տարբերակների քանակի կանոնում minOptions արժեքը բացակայում է կամ սխալ է:' });
    } else {
      const n = t.options.length;
      const ok = n >= bounds.min && (bounds.max === undefined || n <= bounds.max);
      checks.push({
        checkId: 'option_count',
        kind: 'deterministic',
        status: ok ? 'pass' : 'fail',
        detail: bounds.max === undefined ? `${n} տարբերակ. կանոնը պահանջում է առնվազն ${bounds.min}:` : `${n} տարբերակ. կանոնը պահանջում է ${bounds.min}–${bounds.max}:`,
      });
    }
  }
  return checks;
}

/**
 * The seeded method rule for single-choice items (rule-single-correct-answer,
 * params minOptions / maxOptions). Nothing is assumed when it is inactive or
 * has no valid minimum.
 */
function optionBoundsRule(): { min: number; max?: number } | 'inactive' | 'invalid' {
  const rule = repository.getActiveRules().find((r) => r.id === 'rule-single-correct-answer' && r.kind === 'deterministic');
  if (!rule) return 'inactive';
  const min = rule.params?.minOptions;
  const max = rule.params?.maxOptions;
  const isPos = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;
  if (!isPos(min) || (max !== undefined && (!isPos(max) || max < min))) return 'invalid';
  return { min, max: max as number | undefined };
}

// -------------------------------------------------------------- model-based

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function loadPrompt(version: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), `server/prompts/${version}.txt`), 'utf-8');
}

const ScopeSchema = z.object({
  verdict: z.enum(['in_scope', 'out_of_scope', 'unclear']),
  outcomeCodes: z.array(z.string()),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});

async function programScope(t: ItemText, review: MaterialReview, sources: ResolvedSources, deps: CheckDeps): Promise<MaterialCheck> {
  const base = { checkId: 'program_scope' as const, kind: 'llm_judged' as const };
  if (sources.program.length === 0) {
    return { ...base, status: 'not_evaluated', detail: 'Ընտրված չէ հաստատված չափորոշիչ կամ առարկայական ծրագիր:' };
  }
  const programIds = new Set(sources.program.map((s) => s.id));
  const outcomes: CurriculumOutcome[] = repository
    .getOutcomes()
    .filter((o) => o.confirmed && programIds.has(o.sourceId) && o.grade === review.grade && o.subject === review.subject);
  if (outcomes.length === 0) {
    return { ...base, status: 'not_evaluated', detail: 'Ընտրված ծրագրում այս առարկայի և դասարանի համար հաստատված վերջնարդյունքներ չկան:' };
  }
  const prompt = loadPrompt(PROGRAM_SCOPE_PROMPT_VERSION)
    .replace('{{subject}}', review.subject)
    .replace('{{grade}}', String(review.grade))
    .replace('{{outcomes}}', outcomes.map((o) => `${o.code}: ${o.text}`).join('\n'))
    .replace('{{item}}', describeItem(t));
  let res;
  try {
    res = await deps.provider.generateStructured(prompt, ScopeSchema, { modelId: deps.modelId, temperature: 0, actionName: 'material:program_scope' });
  } catch (err) {
    return { ...base, status: 'not_evaluated', executionError: true, detail: `Մոդելի կանչը ձախողվեց. ${errorText(err)}` };
  }
  const model = { providerId: res.providerId, modelId: res.modelId, promptVersion: PROGRAM_SCOPE_PROMPT_VERSION, requestId: res.requestId, latencyMs: res.latencyMs, inputHash: hashText(prompt) };
  const known = new Set(outcomes.map((o) => o.code));
  const codes = res.output.outcomeCodes.filter((c) => known.has(c));
  const invented = res.output.outcomeCodes.filter((c) => !known.has(c));
  const common = { ...base, model, confidence: res.output.confidence, outcomeCodes: codes };
  if (invented.length) {
    return { ...common, status: 'needs_review', detail: `Մոդելը նշել է ծրագրում չեղած կոդեր (${invented.join(', ')}): ${res.output.reason}` };
  }
  if (res.output.confidence < JUDGE_CONFIDENCE_THRESHOLD || res.output.verdict === 'unclear') {
    return { ...common, status: 'needs_review', detail: res.output.reason };
  }
  if (res.output.verdict === 'in_scope') {
    return codes.length
      ? { ...common, status: 'pass', detail: res.output.reason }
      : { ...common, status: 'needs_review', detail: `Համապատասխանում է ծրագրին, բայց վերջնարդյունքի կոդ նշված չէ: ${res.output.reason}` };
  }
  return { ...common, status: 'fail', detail: res.output.reason };
}

async function findEvidence(t: ItemText, review: MaterialReview, sources: ResolvedSources, deps: CheckDeps): Promise<RetrievedChunk[]> {
  // Never call retrieval with an empty selection: it would search every source of the subject.
  if (sources.fact.length === 0) return [];
  const retrieve = deps.retrieve ?? retrieveChunks;
  const query = `${t.stem}\n${describeKey(t)}`;
  const { factChunks } = await retrieve(review.subject, review.grade, query, sources.fact.map((s) => s.id));
  const allowed = new Set(sources.fact.map((s) => s.id));
  return factChunks
    .filter((c) => allowed.has(c.sourceId) && c.score >= COVERAGE_SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, EVIDENCE_CHUNKS);
}

function toEvidence(chunks: RetrievedChunk[]): MaterialEvidence[] {
  return chunks.map((c) => ({ sourceId: c.sourceId, sourceVersion: c.version, chunkId: c.chunk.id, page: c.chunk.page, text: c.chunk.text }));
}

async function factSupport(t: ItemText, chunks: RetrievedChunk[] | Error, sources: ResolvedSources, deps: CheckDeps): Promise<MaterialCheck> {
  const base = { checkId: 'fact_support' as const, kind: 'llm_judged' as const };
  if (sources.fact.length === 0) return { ...base, status: 'not_evaluated', detail: 'Ընտրված չէ հաստատված ՓԱՍՏԱՑԻ աղբյուր:' };
  if (chunks instanceof Error) return { ...base, status: 'not_evaluated', executionError: true, detail: `Ընտրված աղբյուրներում որոնումը ձախողվեց. ${chunks.message}` };
  if (chunks.length === 0) {
    return { ...base, status: 'needs_review', detail: 'Ընտրված աղբյուրներում համապատասխան հատված չի գտնվել: Սա չի նշանակում, որ հարցը սխալ է:' };
  }
  const evidence = toEvidence(chunks);
  const model = { providerId: deps.judge.providerId, modelId: deps.judge.modelId, promptVersion: 'judge:verifyClaim' };
  try {
    const v = await deps.judge.verifyClaim(
      `${describeItem(t)}\nAnswer key: ${describeKey(t)}`,
      chunks.map((c) => `[${c.chunk.id}] ${c.chunk.text}`).join('\n\n'),
      { stem: t.stem, options: t.options.map((o) => o.text), answerKey: t.key ? describeKey(t) : undefined }
    );
    const common = { ...base, evidence, model, confidence: v.confidence };
    if (v.confidence < JUDGE_CONFIDENCE_THRESHOLD) return { ...common, status: 'needs_review', detail: v.reason };
    if (v.verdict === 'supported') return { ...common, status: 'pass', detail: v.reason };
    if (v.verdict === 'partially_supported') return { ...common, status: 'needs_review', detail: v.reason };
    return { ...common, status: 'fail', detail: v.reason };
  } catch (err) {
    return { ...base, evidence, model, status: 'not_evaluated', executionError: true, detail: `Դատավորի կանչը ձախողվեց. ${errorText(err)}` };
  }
}

const UnambiguousSchema = z.object({
  verdict: z.enum(['single_correct', 'multiple_defensible', 'no_correct', 'unclear']),
  defensibleLabels: z.array(z.string()),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});

async function answerUnambiguous(t: ItemText, chunks: RetrievedChunk[] | Error, sources: ResolvedSources, deps: CheckDeps): Promise<MaterialCheck | null> {
  const base = { checkId: 'answer_unambiguous' as const, kind: 'llm_judged' as const };
  if (t.item.type === 'multiple_choice') {
    return { ...base, status: 'not_evaluated', detail: 'V1-ում բազմակի ընտրությամբ հարցերի պատասխանների միանշանակությունը չի ստուգվում:' };
  }
  if (t.item.type !== 'single_choice') return null;
  if (!t.key) return { ...base, status: 'not_evaluated', detail: 'Բանալին չի գտնվել. հնարավոր չէ ստուգել՝ արդյոք նշված պատասխանը միակ ճիշտն է:' };
  if (sources.fact.length === 0) return { ...base, status: 'not_evaluated', detail: 'Ընտրված չէ հաստատված ՓԱՍՏԱՑԻ աղբյուր:' };
  if (chunks instanceof Error) return { ...base, status: 'not_evaluated', executionError: true, detail: `Ընտրված աղբյուրներում որոնումը ձախողվեց. ${chunks.message}` };
  if (chunks.length === 0) return { ...base, status: 'not_evaluated', detail: 'Ընտրված աղբյուրներում համապատասխան հատված չի գտնվել:' };
  const evidence = toEvidence(chunks);
  const prompt = loadPrompt(UNAMBIGUOUS_PROMPT_VERSION)
    .replace('{{evidence}}', chunks.map((c) => `[${c.chunk.id}] ${c.chunk.text}`).join('\n\n'))
    .replace('{{item}}', describeItem(t))
    .replace('{{key}}', describeKey(t));
  let res;
  try {
    res = await deps.provider.generateStructured(prompt, UnambiguousSchema, { modelId: deps.modelId, temperature: 0, actionName: 'material:answer_unambiguous' });
  } catch (err) {
    return { ...base, evidence, status: 'not_evaluated', executionError: true, detail: `Մոդելի կանչը ձախողվեց. ${errorText(err)}` };
  }
  const model = { providerId: res.providerId, modelId: res.modelId, promptVersion: UNAMBIGUOUS_PROMPT_VERSION, requestId: res.requestId, latencyMs: res.latencyMs, inputHash: hashText(prompt) };
  const common = { ...base, evidence, model, confidence: res.output.confidence };
  const labels = new Set(t.options.map((o) => o.label));
  const named = res.output.defensibleLabels.map((l) => l.trim().replace(/[).]+$/, '').toLocaleLowerCase('hy'));
  if (named.some((l) => !labels.has(l))) {
    return { ...common, status: 'needs_review', detail: `Մոդելը նշել է գոյություն չունեցող տարբերակներ: ${res.output.reason}` };
  }
  if (res.output.confidence < JUDGE_CONFIDENCE_THRESHOLD || res.output.verdict === 'unclear') {
    return { ...common, status: 'needs_review', detail: res.output.reason };
  }
  if (res.output.verdict === 'single_correct') {
    const keyed = [...t.key.optionLabels].sort().join(',');
    if (named.sort().join(',') !== keyed) {
      return { ...common, status: 'fail', detail: `Միակ հիմնավորված պատասխանը (${named.join(', ') || '—'}) բանալիում նշվածը չէ (${keyed}): ${res.output.reason}` };
    }
    return { ...common, status: 'pass', detail: res.output.reason };
  }
  return { ...common, status: 'fail', detail: res.output.reason };
}

// --------------------------------------------------------------------- run

function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Everything the checks of one item read. Two runs with the same hash would
 * send the same prompts to the same models over the same passages, so a
 * result without execution errors can be reused instead of paying again.
 */
export function itemInputHash(item: MaterialItem, key: MaterialAnswerKeyEntry | undefined, review: MaterialReview, paragraphs: MaterialParagraph[], deps: CheckDeps): string {
  const t = itemText(item, paragraphs, key);
  const programIds = new Set(review.selectedSources.filter((s) => s.purpose === 'program').map((s) => s.sourceId));
  const outcomes = repository
    .getOutcomes()
    .filter((o) => o.confirmed && programIds.has(o.sourceId) && o.grade === review.grade && o.subject === review.subject)
    .map((o) => [o.sourceId, o.code, o.text]);
  return hashText(
    JSON.stringify({
      subject: review.subject,
      grade: review.grade,
      type: item.type,
      number: item.number,
      stem: t.stem,
      options: t.options,
      key: key ? [key.origin, key.optionLabels] : null,
      sources: review.selectedSources.map((s) => [s.purpose, s.sourceId, s.version, s.contentHash]),
      outcomes,
      optionBounds: optionBoundsRule(),
      prompts: [PROGRAM_SCOPE_PROMPT_VERSION, UNAMBIGUOUS_PROMPT_VERSION, 'judge:verifyClaim'],
      model: [deps.provider.providerId, deps.modelId ?? deps.provider.defaultModelId ?? null],
      judge: [deps.judge.providerId, deps.judge.modelId],
    })
  );
}

export async function checkItem(
  item: MaterialItem,
  key: MaterialAnswerKeyEntry | undefined,
  review: MaterialReview,
  paragraphs: MaterialParagraph[],
  sources: ResolvedSources,
  deps: CheckDeps
): Promise<MaterialItemResult> {
  const t = itemText(item, paragraphs, key);
  const checks = deterministicChecks(t);
  if (item.type !== 'other') {
    let chunks: RetrievedChunk[] | Error;
    try {
      chunks = await findEvidence(t, review, sources, deps);
    } catch (err) {
      chunks = err instanceof Error ? err : new Error(String(err));
    }
    checks.push(await programScope(t, review, sources, deps));
    checks.push(await factSupport(t, chunks, sources, deps));
    const u = await answerUnambiguous(t, chunks, sources, deps);
    if (u) checks.push(u);
  }
  return {
    itemId: item.id,
    revision: review.revision,
    stale: false,
    checks,
    inputHash: itemInputHash(item, key, review, paragraphs, deps),
    checkedAt: new Date().toISOString(),
  };
}
