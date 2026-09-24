import fs from 'fs';
import path from 'path';
import { ExtractedOutcomesSchema } from '../../shared/schemas.js';
import { CurriculumOutcome } from '../../shared/types.js';
import { IModelProvider } from '../providers/modelProvider.js';
import { repository } from '../store/repository.js';
import { findCodeInText, isQuoteVerbatimInChunk } from './normalization.js';

export const EXTRACT_OUTCOMES_PROMPT = 'extract_outcomes.v2.txt';

export type SkipReason =
  | 'no_code_in_source' // model returned null: the document has no explicit code
  | 'code_not_in_source' // model returned a code that does not appear in the text
  | 'text_not_verbatim' // description is not a verbatim copy of the text under this code
  | 'duplicate_code' // the same code twice in one extraction
  | 'confirmed_exists'; // a confirmed outcome with this code already exists

export interface SkippedOutcome {
  code: string | null;
  text: string;
  reason: SkipReason;
}

export interface OutcomeExtractionResult {
  saved: CurriculumOutcome[];
  skipped: SkippedOutcome[];
  providerId: string;
  modelId: string;
  promptFile: string;
}

/** True if `code` appears in `text` as a whole code (see findCodeInText). */
export function codeAppearsInText(code: string, text: string): boolean {
  return findCodeInText(code, text).length > 0;
}

// How far after its code an outcome description may start.
const DESCRIPTION_WINDOW = 1500;

/**
 * The description must follow its own code: it is searched in the text after
 * each occurrence of the code, up to the next occurrence of another extracted
 * code (or DESCRIPTION_WINDOW characters). A description that only appears
 * under a different code does not count.
 */
export function descriptionFollowsCode(code: string, description: string, text: string, otherCodes: string[]): boolean {
  const t = text.normalize('NFC');
  const others = otherCodes
    .filter((c) => c !== code)
    .flatMap((c) => findCodeInText(c, t).map((p) => p.start));
  return findCodeInText(code, t).some(({ end }) => {
    const next = others.filter((s) => s >= end).sort((x, y) => x - y)[0];
    const segment = t.slice(end, Math.min(next ?? Infinity, end + DESCRIPTION_WINDOW));
    return isQuoteVerbatimInChunk(description, segment);
  });
}

/**
 * Model proposes; deterministic checks decide. Only outcomes whose code and
 * description are both found verbatim in the source are saved, always as
 * unconfirmed. Nothing is numbered or invented, and a confirmed outcome is
 * never overwritten.
 */
export async function extractOutcomes(params: {
  provider: IModelProvider;
  text: string;
  subject: string;
  grade: number;
  sourceId: string;
}): Promise<OutcomeExtractionResult> {
  const { provider, text, subject, grade, sourceId } = params;

  let prompt = fs.readFileSync(path.resolve(process.cwd(), 'server/prompts', EXTRACT_OUTCOMES_PROMPT), 'utf-8');
  for (const [k, v] of Object.entries({ grade: String(grade), subject, text })) prompt = prompt.split(`{{${k}}}`).join(v);

  const res = await provider.generateStructured(prompt, ExtractedOutcomesSchema, {
    temperature: 0.0,
    actionName: 'extractOutcomes',
  });

  // Outcome identity is subject + grade + code: the same code in another
  // subject or grade is a different outcome.
  const existing = new Map(
    repository
      .getOutcomes()
      .filter((o) => o.subject === subject && o.grade === grade)
      .map((o) => [o.code, o])
  );
  const allCodes = res.output.outcomes.map((o) => o.code?.trim()).filter((c): c is string => Boolean(c));
  const seen = new Set<string>();
  const saved: CurriculumOutcome[] = [];
  const skipped: SkippedOutcome[] = [];

  for (const o of res.output.outcomes) {
    const code = o.code?.trim() || null;
    const desc = (o.text || '').trim();
    const skip = (reason: SkipReason) => skipped.push({ code, text: desc, reason });

    if (!code) skip('no_code_in_source');
    else if (!codeAppearsInText(code, text)) skip('code_not_in_source');
    else if (!descriptionFollowsCode(code, desc, text, allCodes)) skip('text_not_verbatim');
    else if (seen.has(code)) skip('duplicate_code');
    else if (existing.get(code)?.confirmed) skip('confirmed_exists');
    else {
      seen.add(code);
      saved.push({
        code,
        text: desc,
        subject,
        grade,
        standardVersion: 'pending-confirmation',
        sourceId,
        confirmed: false, // never used until a methodologist confirms it
      });
    }
  }

  if (saved.length > 0) repository.saveOutcomes(saved);
  return { saved, skipped, providerId: res.providerId, modelId: res.modelId, promptFile: EXTRACT_OUTCOMES_PROMPT };
}
