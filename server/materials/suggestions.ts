import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type {
  MaterialCheckId,
  MaterialEvidence,
  MaterialItemResult,
  MaterialParagraph,
  MaterialReview,
  MaterialSuggestion,
  PatchGroup,
  TextSpan,
} from '../../shared/types.js';
import { DocxWorkingCopy } from '../docx/patch.js';
import { IModelProvider } from '../providers/modelProvider.js';
import { itemText } from './checks.js';
import { locateUnique, normalizeLabel } from './segmentation.js';
import { ResolvedStructure } from './spans.js';
import { mapSpan } from './workingCopy.js';

export const SUGGEST_PROMPT_VERSION = 'suggest_fix.v1';

/** Checks a text edit can address. key_present is missing input, not a text problem. */
const FIXABLE: MaterialCheckId[] = ['key_valid_option', 'option_count', 'program_scope', 'fact_support', 'answer_unambiguous'];

const SuggestSchema = z.object({
  suggestions: z.array(
    z.object({
      addresses: z.array(z.string()),
      edits: z.array(z.object({ paragraphId: z.string(), find: z.string(), replacement: z.string() })),
      keyChange: z.object({ optionLabels: z.array(z.string()) }).nullable().optional(),
      rationale: z.string(),
      evidence: z.array(z.object({ chunkId: z.string(), quote: z.string() })).default([]),
    })
  ),
});

export type SuggestOutput = z.infer<typeof SuggestSchema>;

/** Items with a fresh fail / needs_review on a check an edit could address. */
export function itemsNeedingFixes(review: MaterialReview): MaterialItemResult[] {
  return review.results.filter(
    (r) => !r.stale && r.revision === review.revision && r.checks.some((c) => FIXABLE.includes(c.checkId) && (c.status === 'fail' || c.status === 'needs_review'))
  );
}

function fromPrompt(s: string): string {
  return s.replace(/→/g, '\t');
}

/** A label written as a separate token in `text` ("1-բ", "1. բ", "բ)"). */
function containsLabel(text: string, label: string): boolean {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
}

/**
 * After `group` is applied to `probe`, does this question's own key entry
 * (not the whole key paragraph, which may hold other questions' entries)
 * name exactly the new labels?
 */
export function keyEntryMatches(probe: DocxWorkingCopy, keySpan: TextSpan, group: PatchGroup, labels: string[]): boolean {
  const moved = mapSpan(keySpan, group).span;
  const text = (probe.paragraphText(keySpan.paragraphId) ?? '').slice(moved.start, moved.end);
  return labels.length > 0 && labels.every((l) => containsLabel(text, l));
}

export interface ValidatedSuggestion {
  suggestion: MaterialSuggestion;
  keyChange?: string[];
}

/**
 * Checks each proposal against the document and the evidence and turns it
 * into an atomic patch group. `probe` must be a working copy at the review's
 * current revision that the caller discards (it is used for a dry run).
 */
export function validateSuggestions(
  out: SuggestOutput,
  itemId: string,
  structure: ResolvedStructure,
  paragraphs: MaterialParagraph[],
  result: MaterialItemResult,
  makeProbe: () => DocxWorkingCopy,
  model: MaterialSuggestion['model']
): { accepted: MaterialSuggestion[]; problems: string[] } {
  const item = structure.items.find((i) => i.id === itemId)!;
  const key = structure.answerKey.find((k) => k.itemId === itemId);
  const byId = new Map(paragraphs.map((p) => [p.id, p]));
  const allowedParas = new Set([...item.stemParagraphIds, ...item.options.map((o) => o.paragraphId)]);
  if (key?.span) allowedParas.add(key.span.paragraphId);
  const evidenceById = new Map<string, MaterialEvidence>();
  for (const c of result.checks) for (const e of c.evidence ?? []) evidenceById.set(e.chunkId, e);
  const failing = new Set(result.checks.filter((c) => c.status === 'fail' || c.status === 'needs_review').map((c) => c.checkId));
  const optionLabels = new Set(item.options.map((o) => o.label));

  const accepted: MaterialSuggestion[] = [];
  const problems: string[] = [];

  out.suggestions.forEach((s, n) => {
    const tag = `Առաջարկ ${n + 1}`;
    const addresses = s.addresses.filter((a): a is MaterialCheckId => FIXABLE.includes(a as MaterialCheckId) && failing.has(a as MaterialCheckId));
    if (addresses.length === 0) { problems.push(`${tag}. չի վերաբերում գտնված խնդիրներից որևէ մեկին:`); return; }
    if (s.edits.length === 0 && !s.keyChange) { problems.push(`${tag}. փոփոխություն չի պարունակում:`); return; }

    // Evidence: every quote verbatim in a passage the checks actually used.
    const evidence: MaterialEvidence[] = [];
    for (const ev of s.evidence) {
      const chunk = evidenceById.get(ev.chunkId);
      if (!chunk || !ev.quote || !chunk.text.includes(ev.quote)) {
        problems.push(`${tag}. մեջբերումը «${ev.quote}» չկա «${ev.chunkId}» հատվածում:`);
        return;
      }
      evidence.push({ ...chunk, text: ev.quote });
    }
    const factual = addresses.some((a) => a === 'fact_support' || a === 'answer_unambiguous');
    if (factual && evidence.length === 0) { problems.push(`${tag}. փաստական ուղղումն առանց աղբյուրից մեջբերման չի ընդունվում:`); return; }

    // Edits: allowed paragraph, unique exact text.
    const probe = makeProbe();
    const patches = [];
    for (const [k, e] of s.edits.entries()) {
      if (!allowedParas.has(e.paragraphId) || !byId.has(e.paragraphId)) {
        problems.push(`${tag}. ${e.paragraphId} պարբերությունը այս հարցին չի պատկանում:`);
        return;
      }
      const loc = locateUnique(byId.get(e.paragraphId)!.text, fromPrompt(e.find));
      if ('error' in loc) { problems.push(`${tag}. ${loc.error}:`); return; }
      patches.push(probe.makePatch(`${itemId}-s${n + 1}-e${k + 1}`, e.paragraphId, loc.start, loc.end, e.replacement));
    }

    // Key change: labels must exist; a key written in the document must be edited too.
    let keyChange: string[] | undefined;
    if (s.keyChange) {
      keyChange = s.keyChange.optionLabels.map(normalizeLabel);
      if (keyChange.length === 0 || keyChange.some((l) => !optionLabels.has(l))) {
        problems.push(`${tag}. նոր բանալին նշում է գոյություն չունեցող տարբերակ:`);
        return;
      }
    }
    const touchesKey = key?.span ? patches.some((p) => p.paragraphId === key.span!.paragraphId && p.start < key.span!.end && p.end > key.span!.start) : false;
    if (key?.origin === 'document' && touchesKey && !keyChange) {
      problems.push(`${tag}. փոխում է բանալին, բայց նոր ճիշտ պատասխանը նշված չէ:`);
      return;
    }
    if (key?.origin === 'document' && keyChange && !touchesKey) {
      problems.push(`${tag}. փոխում է ճիշտ պատասխանը, բայց փաստաթղթի բանալին չի ուղղում:`);
      return;
    }

    const group: PatchGroup = { id: `grp-${itemId}-${Date.now().toString(36)}-${n + 1}`, patches };
    if (patches.length) {
      const dry = probe.applyGroup(group);
      if (!dry.ok) { problems.push(`${tag}. չի կիրառվում (${dry.errors.map((e) => e.code).join(', ')}):`); return; }
      if (keyChange && key?.span && key.origin === 'document') {
        if (!keyEntryMatches(probe, key.span, group, keyChange)) {
          problems.push(`${tag}. ուղղված բանալու տեքստը չի համապատասխանում նոր ճիշտ պատասխանին:`);
          return;
        }
      }
    }

    accepted.push({
      id: `sug-${itemId}-${Date.now().toString(36)}-${n + 1}`,
      itemId,
      addresses,
      group,
      rationale: s.rationale,
      evidence: evidence.length ? evidence : undefined,
      status: 'proposed',
      model,
      keyChange,
    });
  });
  return { accepted, problems };
}

export function buildSuggestPrompt(structure: ResolvedStructure, itemId: string, paragraphs: MaterialParagraph[], result: MaterialItemResult): string {
  const item = structure.items.find((i) => i.id === itemId)!;
  const key = structure.answerKey.find((k) => k.itemId === itemId);
  const byId = new Map(paragraphs.map((p) => [p.id, p]));
  const paraIds = [...new Set([...item.stemParagraphIds, ...item.options.map((o) => o.paragraphId)])];
  const t = itemText(item, paragraphs, key);
  const keyDesc = key ? `${key.optionLabels.join(', ')} (${key.origin === 'teacher' ? 'set by the teacher, not written in the document' : 'written in the document'})` : 'none';
  const keyPara = key?.span ? `Key paragraph: [${key.span.paragraphId}] ${byId.get(key.span.paragraphId)?.text.replace(/\t/g, '→')}` : '';
  const evidence = new Map<string, string>();
  for (const c of result.checks) for (const e of c.evidence ?? []) evidence.set(e.chunkId, e.text);
  const problems = result.checks
    .filter((c) => c.status === 'fail' || c.status === 'needs_review')
    .map((c) => `- ${c.checkId} (${c.status}): ${c.detail}`)
    .join('\n');
  const template = fs.readFileSync(path.resolve(process.cwd(), `server/prompts/${SUGGEST_PROMPT_VERSION}.txt`), 'utf-8');
  return template
    .replace('{{paragraphs}}', paraIds.map((id) => `[${id}] ${(byId.get(id)?.text ?? '').replace(/\t/g, '→')}`).join('\n'))
    .replace('{{key}}', keyDesc)
    .replace('{{keyParagraph}}', keyPara)
    .replace('{{number}}', item.number)
    .replace('{{problems}}', problems || '- none')
    .replace('{{evidence}}', [...evidence].map(([id, text]) => `${id}: ${text}`).join('\n\n') || '(none)')
    .concat(t.options.length ? `\n\nOptions (label: text):\n${t.options.map((o) => `${o.label}: ${o.text}`).join('\n')}` : '');
}

export async function proposeSuggestions(
  structure: ResolvedStructure,
  itemId: string,
  paragraphs: MaterialParagraph[],
  result: MaterialItemResult,
  makeProbe: () => DocxWorkingCopy,
  provider: IModelProvider,
  modelId?: string
) {
  const prompt = buildSuggestPrompt(structure, itemId, paragraphs, result);
  const res = await provider.generateStructured(prompt, SuggestSchema, {
    modelId,
    temperature: 0,
    actionName: 'material:suggest_fix',
  });
  return validateSuggestions(res.output, itemId, structure, paragraphs, result, makeProbe, {
    providerId: res.providerId,
    modelId: res.modelId,
    promptVersion: SUGGEST_PROMPT_VERSION,
    requestId: res.requestId,
    latencyMs: res.latencyMs,
    inputHash: crypto.createHash('sha256').update(prompt).digest('hex'),
  });
}
