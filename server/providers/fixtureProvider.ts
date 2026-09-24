// FIXTURE provider: deterministic, rule-based stand-in for the model and the
// judge, used ONLY in the separate, labelled fixture environment to exercise
// the full material-review flow without a paid model. It is not a model and
// its judgements are string heuristics. It refuses to run unless fixture mode
// is explicitly enabled with a separate data directory, outside production.
import type { z } from 'zod';
import type { ClaimVerificationResult, ClassificationResult, IJudgeProvider } from './judgeProvider.js';
import type { IModelProvider, ProviderOptions, ProviderResponse } from './modelProvider.js';

export const FIXTURE_MODEL_ID = 'fixture-deterministic-v1';

export function isFixtureMode(): boolean {
  return (
    process.env.TEACHFLOW_FIXTURE_MODE === '1' &&
    !!process.env.TEACHFLOW_DATA_DIR &&
    !process.env.VERCEL &&
    process.env.NODE_ENV !== 'production'
  );
}

function assertFixtureMode(): void {
  if (!isFixtureMode()) {
    throw new Error('The fixture provider is only available in the separate FIXTURE environment (TEACHFLOW_FIXTURE_MODE=1 with TEACHFLOW_DATA_DIR).');
  }
}

// ------------------------------------------------------------ text helpers

const LINE = /^\[(p\d{4}-[0-9a-f]{8})\](?: \((.*?)\))? (.*)$/;
const OPTION = /^\s*([ա-ֆa-z])\)\s*(.+)$/iu;

function lower(s: string): string {
  return s.toLocaleLowerCase('hy');
}

/** Significant tokens: words / numbers of 3+ characters, without trailing punctuation. */
function tokens(s: string): string[] {
  return lower(s)
    .split(/[\s,.:;՝«»()"'?՞!-]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && t !== 'թ.');
}

function supportedBy(optionText: string, evidence: string): boolean {
  const content = optionText.replace(OPTION, '$2');
  const ts = tokens(content);
  const ev = lower(evidence);
  // Armenian case endings: compare on the first 5 letters of longer words.
  return ts.length > 0 && ts.every((t) => ev.includes(t.length > 6 ? t.slice(0, t.length - 1) : t));
}

function section(prompt: string, start: string, end: string | null): string {
  const a = prompt.indexOf(start);
  if (a < 0) return '';
  const from = a + start.length;
  const b = end ? prompt.indexOf(end, from) : -1;
  return prompt.slice(from, b < 0 ? undefined : b);
}

// ------------------------------------------------------------ segmentation

function segment(prompt: string) {
  const lines = section(prompt, 'Paragraphs:\n', null).split('\n').map((l) => LINE.exec(l)).filter(Boolean) as RegExpExecArray[];
  type Item = { number: string; type: string; stemParagraphIds: string[]; stemQuotes: never[]; options: { label: string; paragraphId: string; text: string }[] };
  const items: Item[] = [];
  let current: Item | null = null;
  let inKey = false;
  const key = { paragraphIds: [] as string[], entries: [] as { itemNumber: string; optionLabels: string[]; paragraphId: string; quote: string }[] };

  for (const m of lines) {
    const [, id, label, rawText] = m;
    const text = rawText;
    if (/պատասխան/iu.test(text) && text.length < 40 && !/[ա-ֆ]\)/u.test(text)) {
      inKey = true;
      current = null;
      continue;
    }
    if (inKey) {
      const re = /(\d+)\s*[-–—.)]\s*([ա-ֆa-z])(?![ա-ֆa-z])/giu;
      let e: RegExpExecArray | null;
      let found = false;
      while ((e = re.exec(text))) {
        found = true;
        key.entries.push({ itemNumber: e[1], optionLabels: [e[2]], paragraphId: id, quote: e[0] });
      }
      if (found) key.paragraphIds.push(id);
      continue;
    }
    const typed = /^\s*(\d+)[.)]\s+/.exec(text);
    const isQuestion = (label && /^\d+[.)]?$/.test(label)) || (typed && /[՞?:]/u.test(text));
    if (isQuestion) {
      current = { number: (label || typed![1]).replace(/[.)]$/, ''), type: 'open', stemParagraphIds: [id], stemQuotes: [], options: [] };
      items.push(current);
      continue;
    }
    if (current && OPTION.test(text.split('→')[0])) {
      for (const part of text.split('→')) {
        const o = OPTION.exec(part.trim());
        if (o) current.options.push({ label: o[1], paragraphId: id, text: part.trim() });
      }
      current.type = 'single_choice';
      continue;
    }
    if (current && current.options.length === 0) current.stemParagraphIds.push(id);
  }
  return { items, answerKey: key.entries.length ? key : null };
}

// ------------------------------------------------------------------ checks

function programScope(prompt: string) {
  const outcomes = section(prompt, 'Confirmed learning outcomes of the selected program (code: text):\n', '\n\nQuestion:')
    .split('\n')
    .map((l) => /^(\S+): (.*)$/.exec(l))
    .filter(Boolean) as RegExpExecArray[];
  const item = tokens(section(prompt, 'Question:\n', '\n\nReturn JSON'));
  const hit = outcomes.find((o) => tokens(o[2]).some((t) => item.some((i) => i.slice(0, 5) === t.slice(0, 5))));
  return hit
    ? { verdict: 'in_scope', outcomeCodes: [hit[1]], reason: `FIXTURE. Բառային համընկնում «${hit[1]}» վերջնարդյունքի հետ:`, confidence: 0.9 }
    : { verdict: 'out_of_scope', outcomeCodes: [], reason: 'FIXTURE. Ընտրված վերջնարդյունքների հետ բառային համընկնում չկա:', confidence: 0.9 };
}

function optionLines(itemText: string): string[] {
  return itemText
    .split(/\n|\t/)
    .map((l) => l.trim())
    .filter((l) => OPTION.test(l));
}

function unambiguous(prompt: string) {
  const evidence = section(prompt, 'Evidence passages from the selected sources:\n', '\n\nQuestion:');
  const item = section(prompt, 'Question:\n', '\n\nAnswer key given by the teacher:');
  const defensible = optionLines(item).filter((o) => supportedBy(o, evidence)).map((o) => OPTION.exec(o)![1]);
  if (defensible.length === 1) {
    return { verdict: 'single_correct', defensibleLabels: defensible, reason: 'FIXTURE. Միայն այս տարբերակի բառերն են առկա աղբյուրի հատվածում:', confidence: 0.9 };
  }
  if (defensible.length > 1) {
    return { verdict: 'multiple_defensible', defensibleLabels: defensible, reason: 'FIXTURE. Մեկից ավելի տարբերակի բառեր կան աղբյուրի հատվածում:', confidence: 0.9 };
  }
  return { verdict: 'unclear', defensibleLabels: [], reason: 'FIXTURE. Ոչ մի տարբերակի բառերը չկան աղբյուրի հատվածում:', confidence: 0.9 };
}

// ------------------------------------------------------------- suggestions

function suggestFix(prompt: string) {
  const evidenceBlock = section(prompt, 'Evidence passages from the selected sources (chunk id: text):\n', '\n\nReturn JSON');
  const chunks = [...evidenceBlock.matchAll(/^(\S+#\S+): (.*)$/gmu)].map((m) => ({ id: m[1], text: m[2] }));
  const options = section(prompt, 'Options (label: text):\n', null)
    .split('\n')
    .map((l) => /^([ա-ֆa-z]): (.*)$/iu.exec(l.trim()))
    .filter(Boolean) as RegExpExecArray[];
  const number = /Question number: (\S+)/.exec(prompt)?.[1];
  const keyLabels = /Answer key: ([^(\n]+)\(/.exec(prompt)?.[1].split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const keyPara = /Key paragraph: \[(p\d{4}-[0-9a-f]{8})\] (.*)$/m.exec(prompt);

  const all = chunks.map((c) => c.text).join('\n');
  const defensible = options.filter((o) => supportedBy(o[2], all));
  if (defensible.length !== 1 || keyLabels.length === 0) return { suggestions: [] };
  const right = defensible[0];
  if (keyLabels.length === 1 && keyLabels[0] === right[1]) return { suggestions: [] };

  // Evidence: the sentence of a passage that names the right option.
  const content = right[2].replace(OPTION, '$2');
  const firstToken = tokens(content)[0];
  let evidence: { chunkId: string; quote: string } | null = null;
  for (const c of chunks) {
    const sentence = c.text.split(/(?<=[:։.])\s+/u).find((s) => lower(s).includes(firstToken?.slice(0, 5) ?? '\u0000'));
    if (sentence) { evidence = { chunkId: c.id, quote: sentence.trim() }; break; }
  }
  if (!evidence) return { suggestions: [] };

  const edits: { paragraphId: string; find: string; replacement: string }[] = [];
  if (keyPara && number) {
    const m = new RegExp(`${number}\\s*[-–—.)]\\s*${keyLabels[0]}(?![ա-ֆa-z])`, 'iu').exec(keyPara[2].replace(/→/g, '\t'));
    if (!m) return { suggestions: [] };
    edits.push({ paragraphId: keyPara[1], find: m[0], replacement: m[0].replace(new RegExp(`${keyLabels[0]}$`, 'u'), right[1]) });
  }
  return {
    suggestions: [
      {
        addresses: ['answer_unambiguous', 'fact_support'],
        edits,
        keyChange: { optionLabels: [right[1]] },
        rationale: `FIXTURE. Աղբյուրի հատվածը հաստատում է «${content}» տարբերակը, իսկ բանալին նշում է «${keyLabels.join(', ')}»:`,
        evidence: [evidence],
      },
    ],
  };
}

// --------------------------------------------------------------- providers

export class FixtureModelProvider implements IModelProvider {
  public providerId = 'fixture';
  public defaultModelId = FIXTURE_MODEL_ID;

  async generateStructured<T>(prompt: string, schema: z.ZodType<T>, options?: ProviderOptions): Promise<ProviderResponse<T>> {
    assertFixtureMode();
    const start = Date.now();
    let output: unknown;
    switch (options?.actionName) {
      case 'material:segment':
        output = segment(prompt);
        break;
      case 'material:program_scope':
        output = programScope(prompt);
        break;
      case 'material:answer_unambiguous':
        output = unambiguous(prompt);
        break;
      case 'material:suggest_fix':
        output = suggestFix(prompt);
        break;
      default:
        throw new Error(`FIXTURE provider does not implement «${options?.actionName ?? 'unknown'}»; only the material review flow is covered.`);
    }
    return { output: schema.parse(output), providerId: this.providerId, modelId: FIXTURE_MODEL_ID, latencyMs: Date.now() - start, requestId: `fixture-${Date.now()}` };
  }

  async generateText(): Promise<ProviderResponse<string>> {
    assertFixtureMode();
    throw new Error('FIXTURE provider does not generate free text.');
  }
}

export class FixtureJudgeProvider implements IJudgeProvider {
  public providerId = 'fixture';
  public modelId = FIXTURE_MODEL_ID;

  async verifyClaim(claim: string, evidenceText: string, context?: { stem?: string; options?: string[]; answerKey?: string }): Promise<ClaimVerificationResult> {
    assertFixtureMode();
    if (context?.answerKey) {
      const ok = context.answerKey.split(';').every((k) => supportedBy(k.trim(), evidenceText));
      return ok
        ? { verdict: 'supported', probability: 0.9, confidence: 0.9, reason: 'FIXTURE. Բանալու տարբերակի բառերն առկա են աղբյուրի հատվածում:' }
        : { verdict: 'not_supported', probability: 0.1, confidence: 0.9, reason: 'FIXTURE. Բանալու տարբերակի բառերը չկան աղբյուրի հատվածում:' };
    }
    const ts = tokens(context?.stem ?? claim);
    const hits = ts.filter((t) => lower(evidenceText).includes(t.slice(0, 5))).length;
    return hits >= Math.ceil(ts.length / 2)
      ? { verdict: 'supported', probability: 0.8, confidence: 0.9, reason: 'FIXTURE. Հարցի բառերի կեսից ավելին առկա են աղբյուրում:' }
      : { verdict: 'partially_supported', probability: 0.5, confidence: 0.9, reason: 'FIXTURE. Հարցի բառերի մեծ մասը չկա աղբյուրում:' };
  }

  async classify(_text: string, labels: string[]): Promise<ClassificationResult> {
    assertFixtureMode();
    throw new Error(`FIXTURE judge does not classify (${labels.join(', ')}).`);
  }
}
