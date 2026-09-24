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

export function buildSegmentPrompt(paragraphs: MaterialParagraph[]): string {
  const template = fs.readFileSync(path.resolve(process.cwd(), `server/prompts/${SEGMENT_PROMPT_VERSION}.txt`), 'utf-8');
  const lines = paragraphs
    .filter((p) => p.text.trim() !== '')
    .map((p) => `[${p.id}]${p.label ? ` (${p.label})` : ''} ${p.text.replace(/\t/g, '→').replace(/\n/g, ' ')}`);
  return template.replace('{{paragraphs}}', lines.join('\n'));
}

/**
 * Turns the model's proposal into items with exact spans. Everything the
 * model says is checked against the document: ids must exist, quoted text
 * must occur exactly once in its paragraph, a paragraph belongs to at most
 * one question, and key paragraphs are not question paragraphs. Whatever
 * fails is dropped and listed in `problems` — nothing is repaired by guessing.
 */
export function validateSegmentation(
  out: SegmentationOutput,
  paragraphs: MaterialParagraph[]
): { items: MaterialItem[]; answerKey: MaterialAnswerKeyEntry[]; answerKeyParagraphIds: string[]; problems: string[] } {
  const byId = new Map(paragraphs.map((p) => [p.id, p]));
  const problems: string[] = [];
  const owner = new Map<string, number>(); // paragraph id -> proposal index
  const keyIds = new Set((out.answerKey?.paragraphIds ?? []).filter((id) => byId.has(id)));
  for (const id of out.answerKey?.paragraphIds ?? []) if (!byId.has(id)) problems.push(`Բանալու ${id} պարբերությունը գոյություն չունի:`);

  // First pass: which paragraphs each proposal claims.
  out.items.forEach((it, i) => {
    const ids = new Set([...it.stemParagraphIds, ...it.options.map((o) => o.paragraphId)]);
    for (const id of ids) {
      if (!byId.has(id) || keyIds.has(id)) continue;
      if (owner.has(id) && owner.get(id) !== i) owner.set(id, -1); // claimed twice
      else owner.set(id, i);
    }
  });

  const items: MaterialItem[] = [];
  out.items.forEach((it, i) => {
    const label = `«${it.number}» հարց`;
    const stems = it.stemParagraphIds.filter((id) => {
      if (!byId.has(id)) { problems.push(`${label}. ${id} պարբերությունը գոյություն չունի:`); return false; }
      if (keyIds.has(id)) { problems.push(`${label}. ${id} պարբերությունը բանալու մաս է:`); return false; }
      if (owner.get(id) === -1) { problems.push(`${label}. ${id} պարբերությունը վերագրված է երկու հարցի:`); return false; }
      return true;
    });
    if (stems.length === 0) {
      problems.push(`${label}. հարցի վավեր պարբերություն չկա, հարցը չի ներառվել:`);
      return;
    }

    const options: MaterialItemOption[] = [];
    const seen = new Set<string>();
    for (const o of it.options) {
      const p = byId.get(o.paragraphId);
      if (!p) { problems.push(`${label}. «${o.label}» տարբերակի պարբերությունը գոյություն չունի:`); continue; }
      if (owner.get(o.paragraphId) === -1 || keyIds.has(o.paragraphId)) {
        problems.push(`${label}. «${o.label}» տարբերակը այլ հարցի կամ բանալու պարբերությունում է:`);
        continue;
      }
      const loc = locateUnique(p.text, fromPrompt(o.text));
      if ('error' in loc) { problems.push(`${label}. «${o.label}» տարբերակ. ${loc.error}:`); continue; }
      const norm = normalizeLabel(o.label);
      if (!norm || seen.has(norm)) { problems.push(`${label}. «${o.label}» նշանը դատարկ է կամ կրկնվում է:`); continue; }
      seen.add(norm);
      options.push({ label: norm, paragraphId: p.id, start: loc.start, end: loc.end });
    }

    items.push({
      id: `item-${i + 1}`,
      number: normalizeNumber(it.number) || String(i + 1),
      type: it.type,
      stemParagraphIds: [...stems].sort((a, b) => byId.get(a)!.index - byId.get(b)!.index),
      options,
    });
  });
  items.sort((a, b) => byId.get(a.stemParagraphIds[0])!.index - byId.get(b.stemParagraphIds[0])!.index);

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
    const span: TextSpan = { paragraphId: p.id, start: loc.start, end: loc.end };
    // Labels are kept as written: a key that names a non-existent option is a
    // real finding for key_valid_option, not something to fix here.
    answerKey.push({ itemId: matches[0].id, optionLabels: e.optionLabels.map(normalizeLabel), origin: 'document', span });
  }

  return { items, answerKey, answerKeyParagraphIds: [...keyIds], problems };
}

export async function proposeSegmentation(
  paragraphs: MaterialParagraph[],
  revision: string,
  provider: IModelProvider,
  modelId?: string
): Promise<{ segmentation: MaterialSegmentation; answerKey: MaterialAnswerKeyEntry[] }> {
  const res = await provider.generateStructured(buildSegmentPrompt(paragraphs), SegmentationSchema, {
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
      model: { providerId: res.providerId, modelId: res.modelId, promptVersion: SEGMENT_PROMPT_VERSION, requestId: res.requestId },
      proposedAtRevision: revision,
    },
    answerKey: v.answerKey,
  };
}
