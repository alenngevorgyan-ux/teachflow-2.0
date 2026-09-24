import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type {
  MaterialAnswerKeyEntry,
  MaterialItem,
  MaterialItemOption,
  MaterialParagraph,
  MaterialSegmentation,
  TextSpan,
} from '../../shared/types.js';
import { IModelProvider } from '../providers/modelProvider.js';

export const SEGMENT_PROMPT_VERSION = 'segment_material.v1';

const SegmentationSchema = z.object({
  items: z.array(
    z.object({
      number: z.string(),
      type: z.enum(['single_choice', 'multiple_choice', 'open', 'other']),
      stemParagraphIds: z.array(z.string()),
      stemQuotes: z.array(z.object({ paragraphId: z.string(), text: z.string() })).default([]),
      options: z.array(z.object({ label: z.string(), paragraphId: z.string(), text: z.string() })).default([]),
    })
  ),
  answerKey: z
    .object({
      paragraphIds: z.array(z.string()),
      entries: z.array(
        z.object({
          itemNumber: z.string(),
          optionLabels: z.array(z.string()),
          paragraphId: z.string(),
          quote: z.string(),
        })
      ),
    })
    .nullable(),
});

export type SegmentationOutput = z.infer<typeof SegmentationSchema>;

/** "ա)", "(Ա)", "բ." -> "ա", "ա", "բ". Labels are compared in this form. */
export function normalizeLabel(label: string): string {
  return label
    .trim()
    .replace(/^[([]+/, '')
    .replace(/[)\].:\-–—\s]+$/, '')
    .toLocaleLowerCase('hy');
}

/** "3.", "3)", "№3" -> "3". */
export function normalizeNumber(n: string): string {
  return n.trim().replace(/^[№#]\s*/, '').replace(/[.)\s]+$/, '');
}

function fromPrompt(s: string): string {
  return s.replace(/→/g, '\t');
}

/** The only occurrence of `quote` in `text`, or why there is none. */
export function locateUnique(text: string, quote: string): { start: number; end: number } | { error: string } {
  if (!quote) return { error: 'մեջբերումը դատարկ է' };
  const first = text.indexOf(quote);
  if (first < 0) return { error: `«${quote}» չկա պարբերությունում` };
  if (text.indexOf(quote, first + 1) >= 0) return { error: `«${quote}» պարբերությունում մեկից ավելի անգամ է հանդիպում` };
  return { start: first, end: first + quote.length };
}

const LEADING_OPTION_LABEL = /^\s*[([]?([ա-ֆԱ-Ֆa-zA-Z0-9]{1,2})[)\].]\s/u;
const INLINE_OPTION_LABEL = /\s[([]?[ա-ֆԱ-Ֆa-zA-Z0-9]{1,2}[)\]]\s/u;

/**
 * A paragraph that is exactly one option carrying `label` (typed at its start,
 * or Word's list label), with no second option inside it: its trimmed text is
 * the option. Used when the model's copy of the option does not match: models
 * miscopy Armenian text («Կարդան» for «Վարդան», doubled spaces), and the
 * document itself is the source of truth. Several inline options in one
 * paragraph still need an exact copy.
 */
export function wholeParagraphOption(paragraph: MaterialParagraph, label: string): { start: number; end: number } | null {
  const want = normalizeLabel(label);
  if (!want) return null;
  const text = paragraph.text;
  const lead = LEADING_OPTION_LABEL.exec(text);
  const typed = lead ? normalizeLabel(lead[1]) : null;
  const listed = paragraph.label ? normalizeLabel(paragraph.label) : null;
  if (typed !== want && !(typed === null && listed === want)) return null;
  const rest = lead ? text.slice(lead[0].length) : text;
  if (INLINE_OPTION_LABEL.test(` ${rest}`)) return null;
  const start = text.length - text.trimStart().length;
  const end = text.trimEnd().length;
  return end > start ? { start, end } : null;
}

export function buildSegmentPrompt(paragraphs: MaterialParagraph[]): string {
  const template = fs.readFileSync(path.resolve(process.cwd(), `server/prompts/${SEGMENT_PROMPT_VERSION}.txt`), 'utf-8');
  const lines = paragraphs
    .filter((p) => p.text.trim() !== '')
    .map((p) => `[${p.id}]${p.label ? ` (${p.label})` : ''} ${p.text.replace(/\t/g, '→').replace(/\n/g, ' ')}`);
  return template.replace('{{paragraphs}}', lines.join('\n'));
}

/** A claim of (part of) a paragraph by one item: a span, or the whole paragraph. */
interface Claim {
  item: number;
  paragraphId: string;
  span?: { start: number; end: number };
}

/**
 * Paragraphs claimed by more than one item are allowed only when every
 * claimant names a span and no two spans overlap. Returns the paragraph ids
 * whose claims conflict.
 */
export function conflictingParagraphs(claims: Claim[]): Set<string> {
  const byPara = new Map<string, Claim[]>();
  for (const c of claims) byPara.set(c.paragraphId, [...(byPara.get(c.paragraphId) ?? []), c]);
  const bad = new Set<string>();
  for (const [pid, list] of byPara) {
    const items = new Set(list.map((c) => c.item));
    if (items.size < 2) continue;
    if (list.some((c) => !c.span)) { bad.add(pid); continue; }
    const spans = list.map((c) => ({ ...c.span!, item: c.item })).sort((a, b) => a.start - b.start);
    for (let i = 1; i < spans.length; i++) {
      if (spans[i].item !== spans[i - 1].item && spans[i].start < spans[i - 1].end) bad.add(pid);
    }
  }
  return bad;
}

/**
 * Turns the model's proposal into items with exact spans. Everything the
 * model says is checked against the document: ids must exist, quoted text
 * must occur exactly once in its paragraph, key paragraphs are not question
 * paragraphs, and a paragraph shared by several questions must be split into
 * non-overlapping spans. Whatever fails is dropped and listed in `problems` —
 * nothing is repaired by guessing.
 */
export function validateSegmentation(
  out: SegmentationOutput,
  paragraphs: MaterialParagraph[]
): { items: MaterialItem[]; answerKey: MaterialAnswerKeyEntry[]; answerKeyParagraphIds: string[]; problems: string[] } {
  const byId = new Map(paragraphs.map((p) => [p.id, p]));
  const problems: string[] = [];
  const keyIds = new Set((out.answerKey?.paragraphIds ?? []).filter((id) => byId.has(id)));
  for (const id of out.answerKey?.paragraphIds ?? []) if (!byId.has(id)) problems.push(`Բանալու ${id} պարբերությունը գոյություն չունի:`);

  // Resolve quotes to spans first, then detect conflicting claims.
  const resolved = out.items.map((it, i) => {
    const label = `«${it.number}» հարց`;
    const stemSpans: TextSpan[] = [];
    for (const q of it.stemQuotes ?? []) {
      const p = byId.get(q.paragraphId);
      if (!p) { problems.push(`${label}. ${q.paragraphId} պարբերությունը գոյություն չունի:`); continue; }
      const loc = locateUnique(p.text, fromPrompt(q.text));
      if ('error' in loc) { problems.push(`${label}. ${loc.error}:`); continue; }
      stemSpans.push({ paragraphId: p.id, start: loc.start, end: loc.end });
    }
    const options: MaterialItemOption[] = [];
    const seen = new Set<string>();
    for (const o of it.options) {
      const p = byId.get(o.paragraphId);
      if (!p) { problems.push(`${label}. «${o.label}» տարբերակի պարբերությունը գոյություն չունի:`); continue; }
      if (keyIds.has(o.paragraphId)) { problems.push(`${label}. «${o.label}» տարբերակը բանալու պարբերությունում է:`); continue; }
      let loc = locateUnique(p.text, fromPrompt(o.text));
      if ('error' in loc) loc = wholeParagraphOption(p, o.label) ?? loc;
      if ('error' in loc) { problems.push(`${label}. «${o.label}» տարբերակ. ${loc.error}:`); continue; }
      const norm = normalizeLabel(o.label);
      if (!norm || seen.has(norm)) { problems.push(`${label}. «${o.label}» նշանը դատարկ է կամ կրկնվում է:`); continue; }
      seen.add(norm);
      options.push({ label: norm, paragraphId: p.id, start: loc.start, end: loc.end });
    }
    return { it, i, label, stemSpans, options };
  });

  const claims: Claim[] = [];
  for (const r of resolved) {
    for (const pid of r.it.stemParagraphIds) {
      if (!byId.has(pid) || keyIds.has(pid)) continue;
      const span = r.stemSpans.find((s) => s.paragraphId === pid);
      claims.push({ item: r.i, paragraphId: pid, span: span ? { start: span.start, end: span.end } : undefined });
    }
    for (const o of r.options) {
      // An option inside the item's own whole-paragraph stem does not add a claim.
      const ownWhole = r.it.stemParagraphIds.includes(o.paragraphId) && !r.stemSpans.some((s) => s.paragraphId === o.paragraphId);
      if (!ownWhole) claims.push({ item: r.i, paragraphId: o.paragraphId, span: { start: o.start, end: o.end } });
    }
  }
  const conflicts = conflictingParagraphs(claims);

  const items: MaterialItem[] = [];
  for (const r of resolved) {
    const stems = r.it.stemParagraphIds.filter((id) => {
      if (!byId.has(id)) { problems.push(`${r.label}. ${id} պարբերությունը գոյություն չունի:`); return false; }
      if (keyIds.has(id)) { problems.push(`${r.label}. ${id} պարբերությունը բանալու մաս է:`); return false; }
      if (conflicts.has(id)) { problems.push(`${r.label}. ${id} պարբերությունը վերագրված է մի քանի հարցի՝ առանց չհատվող հատվածների:`); return false; }
      return true;
    });
    if (stems.length === 0) {
      problems.push(`${r.label}. հարցի վավեր պարբերություն չկա, հարցը չի ներառվել:`);
      continue;
    }
    const options = r.options.filter((o) => {
      if (conflicts.has(o.paragraphId)) { problems.push(`${r.label}. «${o.label}» տարբերակի պարբերությունը վերագրված է այլ հարցի:`); return false; }
      return true;
    });
    const stemSpans = r.stemSpans.filter((sp) => stems.includes(sp.paragraphId));
    items.push({
      id: `item-${r.i + 1}`,
      number: normalizeNumber(r.it.number) || String(r.i + 1),
      type: r.it.type,
      stemParagraphIds: [...stems].sort((a, b) => byId.get(a)!.index - byId.get(b)!.index),
      stemSpans: stemSpans.length ? stemSpans : undefined,
      options,
    });
  }
  const firstPos = (it: MaterialItem) => byId.get(it.stemParagraphIds[0])!.index * 1e6 + (it.stemSpans?.find((s) => s.paragraphId === it.stemParagraphIds[0])?.start ?? 0);
  items.sort((a, b) => firstPos(a) - firstPos(b));

  const answerKey: MaterialAnswerKeyEntry[] = [];
  const conflicted = new Set<string>();
  for (const e of out.answerKey?.entries ?? []) {
    const label = `Բանալու «${e.quote}» գրառում`;
    const matches = items.filter((it) => it.number === normalizeNumber(e.itemNumber));
    if (matches.length !== 1) {
      problems.push(`${label}. «${e.itemNumber}» հարցը ${matches.length ? 'միանշանակ չէ' : 'չի գտնվել'}:`);
      continue;
    }
    const p = byId.get(e.paragraphId);
    if (!p || !keyIds.has(p.id)) { problems.push(`${label}. բանալու պարբերությունում չէ:`); continue; }
    const loc = locateUnique(p.text, fromPrompt(e.quote));
    if ('error' in loc) { problems.push(`${label}. ${loc.error}:`); continue; }
    if (conflicted.has(matches[0].id)) continue;
    if (answerKey.some((k) => k.itemId === matches[0].id)) {
      problems.push(`${label}. «${e.itemNumber}» հարցն ունի մեկից ավելի բանալի, ոչ մեկը չի պահպանվել:`);
      conflicted.add(matches[0].id);
      answerKey.splice(answerKey.findIndex((k) => k.itemId === matches[0].id), 1);
      continue;
    }
    // Labels are kept as written: a key that names a non-existent option is a
    // real finding for key_valid_option, not something to fix here.
    answerKey.push({ itemId: matches[0].id, optionLabels: e.optionLabels.map(normalizeLabel), origin: 'document', span: { paragraphId: p.id, start: loc.start, end: loc.end } });
  }

  return { items, answerKey, answerKeyParagraphIds: [...keyIds], problems };
}

/**
 * A split edited by the teacher. Unlike the model's proposal nothing is
 * dropped silently: any invalid part rejects the whole edit with the reasons.
 */
export function validateTeacherItems(
  items: unknown,
  answerKeyParagraphIds: unknown,
  paragraphs: MaterialParagraph[]
): { items: MaterialItem[]; answerKeyParagraphIds: string[] } | { errors: string[] } {
  const byId = new Map(paragraphs.map((p) => [p.id, p]));
  const errors: string[] = [];
  const TeacherItems = z.array(
    z.object({
      id: z.string().trim().min(1),
      number: z.string().trim().min(1),
      type: z.enum(['single_choice', 'multiple_choice', 'open', 'other']),
      stemParagraphIds: z.array(z.string()).min(1),
      stemSpans: z.array(z.object({ paragraphId: z.string(), start: z.number().int(), end: z.number().int() })).optional(),
      options: z.array(z.object({ label: z.string().trim().min(1), paragraphId: z.string(), start: z.number().int(), end: z.number().int() })),
    })
  );
  const parsed = TeacherItems.safeParse(items);
  const keyParsed = z.array(z.string()).safeParse(answerKeyParagraphIds ?? []);
  if (!parsed.success) return { errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  if (!keyParsed.success) return { errors: ['answerKeyParagraphIds: պետք է լինի պարբերությունների id-ների ցուցակ'] };
  const keyIds = new Set(keyParsed.data);
  for (const id of keyIds) if (!byId.has(id)) errors.push(`Բանալու ${id} պարբերությունը գոյություն չունի:`);

  const ids = new Set<string>();
  const claims: Claim[] = [];
  const inBounds = (pid: string, a: number, b: number) => {
    const p = byId.get(pid);
    return !!p && Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b > a && b <= p.text.length;
  };
  parsed.data.forEach((it, i) => {
    const label = `«${it.number}» հարց`;
    if (ids.has(it.id)) errors.push(`${label}. կրկնվող id՝ ${it.id}:`);
    ids.add(it.id);
    for (const pid of it.stemParagraphIds) {
      if (!byId.has(pid)) errors.push(`${label}. ${pid} պարբերությունը գոյություն չունի:`);
      else if (keyIds.has(pid)) errors.push(`${label}. ${pid} պարբերությունը բանալու մաս է:`);
    }
    for (const sp of it.stemSpans ?? []) {
      if (!it.stemParagraphIds.includes(sp.paragraphId) || !inBounds(sp.paragraphId, sp.start, sp.end)) errors.push(`${label}. հարցի հատվածը սխալ է:`);
    }
    const labels = new Set<string>();
    for (const o of it.options) {
      const norm = normalizeLabel(o.label);
      if (!norm || labels.has(norm)) errors.push(`${label}. «${o.label}» նշանը դատարկ է կամ կրկնվում է:`);
      labels.add(norm);
      if (!inBounds(o.paragraphId, o.start, o.end)) errors.push(`${label}. «${o.label}» տարբերակի հատվածը սխալ է:`);
      if (keyIds.has(o.paragraphId)) errors.push(`${label}. «${o.label}» տարբերակը բանալու պարբերությունում է:`);
    }
    const sorted = [...it.options].sort((a, b) => (a.paragraphId === b.paragraphId ? a.start - b.start : a.paragraphId < b.paragraphId ? -1 : 1));
    for (let k = 1; k < sorted.length; k++) {
      if (sorted[k].paragraphId === sorted[k - 1].paragraphId && sorted[k].start < sorted[k - 1].end) errors.push(`${label}. տարբերակները հատվում են:`);
    }
    for (const pid of it.stemParagraphIds) {
      const span = it.stemSpans?.find((s) => s.paragraphId === pid);
      claims.push({ item: i, paragraphId: pid, span: span ? { start: span.start, end: span.end } : undefined });
    }
    for (const o of it.options) {
      const ownWhole = it.stemParagraphIds.includes(o.paragraphId) && !it.stemSpans?.some((s) => s.paragraphId === o.paragraphId);
      if (!ownWhole) claims.push({ item: i, paragraphId: o.paragraphId, span: { start: o.start, end: o.end } });
    }
  });
  for (const pid of conflictingParagraphs(claims)) errors.push(`${pid} պարբերությունը վերագրված է մի քանի հարցի՝ առանց չհատվող հատվածների:`);
  if (errors.length) return { errors };

  const out: MaterialItem[] = parsed.data.map((it) => ({
    id: it.id,
    number: normalizeNumber(it.number),
    type: it.type,
    stemParagraphIds: [...it.stemParagraphIds].sort((a, b) => byId.get(a)!.index - byId.get(b)!.index),
    stemSpans: it.stemSpans?.length ? it.stemSpans : undefined,
    options: it.options.map((o) => ({ label: normalizeLabel(o.label), paragraphId: o.paragraphId, start: o.start, end: o.end })),
  }));
  return { items: out, answerKeyParagraphIds: [...keyIds] };
}

export async function proposeSegmentation(
  paragraphs: MaterialParagraph[],
  revision: string,
  atGroupCount: number,
  provider: IModelProvider,
  modelId?: string
): Promise<{ segmentation: MaterialSegmentation; answerKey: MaterialAnswerKeyEntry[] }> {
  const prompt = buildSegmentPrompt(paragraphs);
  const res = await provider.generateStructured(prompt, SegmentationSchema, {
    modelId,
    temperature: 0,
    actionName: 'material:segment',
  });
  const v = validateSegmentation(res.output, paragraphs);
  return {
    segmentation: {
      status: 'proposed',
      items: v.items,
      answerKeyParagraphIds: v.answerKeyParagraphIds,
      problems: v.problems,
      model: {
        providerId: res.providerId,
        modelId: res.modelId,
        promptVersion: SEGMENT_PROMPT_VERSION,
        requestId: res.requestId,
        latencyMs: res.latencyMs,
        inputHash: crypto.createHash('sha256').update(prompt).digest('hex'),
        ...(res.reasoningEffort ? { reasoningEffort: res.reasoningEffort } : {}),
      },
      proposedAtRevision: revision,
      atGroupCount,
    },
    answerKey: v.answerKey,
  };
}
