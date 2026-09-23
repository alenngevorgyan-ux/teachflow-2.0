import fs from 'fs';
import path from 'path';
import { BaselineParseSchema, BaselineRefusalSchema } from '../../shared/schemas.js';
import {
  AssessmentItem,
  CompareAggregate,
  ItemTrace,
  ScorecardMetric,
  SideBySideReport,
} from '../../shared/types.js';
import { IModelProvider } from '../providers/modelProvider.js';
import {
  IJudgeProvider,
  getJudgeProvider,
  isTypeSafeJevConfigured,
  GeminiJudgeProvider,
  TypeSafeJevJudgeProvider,
} from '../providers/judgeProvider.js';
import { repository } from '../store/repository.js';
import { runFullGenerationPipeline } from './orchestrator.js';
import { RetrievedChunk, retrieveChunks } from './retrieval.js';
import { validateAllItems } from './validator.js';
import { isQuoteVerbatimInChunk, normalizeArmenianText } from './normalization.js';

export interface RunCompareOptions {
  subject: string;
  grade: number;
  topic: string;
  isUncoveredTopicPreset?: boolean;
  selectedSourceIds?: string[];
  numberOfRuns?: number;
  modelId?: string;
  judgeProviderId?: string; // 'gemini' | 'typesafe_jev'
  judgeConfidenceThreshold?: number;
}

// Minimum share of quote tokens that must occur in a chunk to locate a
// non-verbatim quote there (the quote still fails quote_verbatim).
export const QUOTE_OVERLAP_THRESHOLD = 0.8;

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

function tokens(text: string): string[] {
  return normalizeArmenianText(text)
    .split(' ')
    .filter((t) => /[\p{L}\p{N}]/u.test(t));
}

/** Share of the quote's word tokens (with multiplicity) that occur in the chunk. */
export function tokenOverlap(quote: string, chunkText: string): number {
  const q = tokens(quote);
  if (q.length === 0) return 0;
  const available = new Map<string, number>();
  for (const t of tokens(chunkText)) available.set(t, (available.get(t) || 0) + 1);
  let hits = 0;
  for (const t of q) {
    const n = available.get(t) || 0;
    if (n > 0) {
      hits++;
      available.set(t, n - 1);
    }
  }
  return hits / q.length;
}

export type CitationMatch = 'verbatim' | 'overlap' | 'best_fact' | 'unresolved';

/**
 * Locates a baseline quote among the chunks the baseline was shown.
 * 1. verbatim match (the chunk id the baseline named first, then FACT, then METHOD);
 * 2. otherwise the chunk with the highest token overlap if >= threshold (any role,
 *    so a METHOD quote is still caught as method-used-as-fact);
 * 3. otherwise the best-overlapping FACT chunk, so claim_supported can still be
 *    judged; quote_verbatim will fail because the quote is not in it.
 */
export function resolveQuoteToChunk(
  quote: string,
  factChunks: RetrievedChunk[],
  methodChunks: RetrievedChunk[],
  namedChunkId?: string
): { chunk: RetrievedChunk | null; match: CitationMatch } {
  const all = [...factChunks, ...methodChunks];
  const named = namedChunkId ? all.find((c) => c.chunk.id === namedChunkId) : undefined;
  if (named && isQuoteVerbatimInChunk(quote, named.chunk.text)) return { chunk: named, match: 'verbatim' };

  const verbatim = all.find((c) => isQuoteVerbatimInChunk(quote, c.chunk.text));
  if (verbatim) return { chunk: verbatim, match: 'verbatim' };

  let best: RetrievedChunk | null = null;
  let bestScore = -1;
  for (const c of all) {
    const score = tokenOverlap(quote, c.chunk.text);
    // strict ">" keeps FACT chunks (listed first) on ties
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  if (best && bestScore >= QUOTE_OVERLAP_THRESHOLD) return { chunk: best, match: 'overlap' };

  let bestFact: RetrievedChunk | null = null;
  let bestFactScore = -1;
  for (const c of factChunks) {
    const score = tokenOverlap(quote, c.chunk.text);
    if (score > bestFactScore) {
      bestFact = c;
      bestFactScore = score;
    }
  }
  if (bestFact) return { chunk: bestFact, match: 'best_fact' };
  return { chunk: null, match: 'unresolved' };
}

/** Every item is traceable to exact source text: all citations exist and are verbatim. */
export function computeMachineReadableTrace(traces: ItemTrace[]): boolean | null {
  if (traces.length === 0) return null;
  return traces.every((t) => {
    const results = (id: string) => t.checks.filter((c) => c.checkId === id).map((c) => c.result);
    const exists = results('citation_exists');
    const verbatim = results('quote_verbatim');
    return exists.length > 0 && exists.every((r) => r === 'pass') && verbatim.length > 0 && verbatim.every((r) => r === 'pass');
  });
}

function countViolations(traces: ItemTrace[]) {
  let unsupported = 0;
  let methodAsFact = 0;
  let unverifiableQuote = 0;
  for (const t of traces) {
    for (const chk of t.checks) {
      if (chk.checkId === 'claim_supported' && chk.result === 'fail') unsupported++;
      if (chk.checkId === 'citation_is_fact_source' && chk.result === 'fail') methodAsFact++;
      if (chk.checkId === 'quote_verbatim' && chk.result === 'fail') unverifiableQuote++;
    }
  }
  return { unsupported, methodAsFact, unverifiableQuote };
}

function errorRun(runIndex: number, error: string, latencyMs: number, rawOutput?: string): ScorecardMetric {
  return {
    runIndex,
    error,
    unsupportedClaimsCount: 0,
    correctRefusal: false,
    methodUsedAsFactCount: 0,
    itemsWithoutVerifiableQuote: 0,
    variantEquivalencePassed: false,
    machineReadableTrace: null,
    internalViolationsCaught: 0,
    validatorViolationsCaught: 0,
    latencyMs,
    rawOutput,
  };
}

function fillPrompt(file: string, vars: Record<string, string>): string {
  let text = fs.readFileSync(path.resolve(process.cwd(), 'server/prompts', file), 'utf-8');
  for (const [k, v] of Object.entries(vars)) text = text.split(`{{${k}}}`).join(v);
  return text;
}

export interface BaselineRunContext {
  subject: string;
  grade: number;
  prompt: string;
  factChunks: RetrievedChunk[];
  methodChunks: RetrievedChunk[];
  isUncoveredTopicPreset: boolean;
  modelId?: string;
  judge: IJudgeProvider;
  judgeConfidenceThreshold: number;
}

/**
 * One plain-AI baseline run, scored by the same validator as TeachFlow.
 * Model failures are reported as an ERROR run, never as a refusal.
 */
export async function runBaselineOnce(
  provider: IModelProvider,
  runIndex: number,
  ctx: BaselineRunContext
): Promise<{ metric: ScorecardMetric; items: AssessmentItem[]; traces: ItemTrace[] }> {
  const start = Date.now();
  let rawOutput: string;
  try {
    const res = await provider.generateText(ctx.prompt, {
      modelId: ctx.modelId,
      temperature: 0.2,
      actionName: `baselineComparisonRun_${runIndex}`,
    });
    rawOutput = res.output;
  } catch (err) {
    return { metric: errorRun(runIndex, `baseline generation: ${errorMessage(err)}`, Date.now() - start), items: [], traces: [] };
  }

  let refused: boolean;
  let refusalReason: string;
  try {
    const res = await provider.generateStructured(
      fillPrompt('baseline_refusal.v1.txt', { output: rawOutput }),
      BaselineRefusalSchema,
      { modelId: ctx.modelId, temperature: 0.0, actionName: `baselineRefusalCheck_${runIndex}` }
    );
    refused = res.output.refused;
    refusalReason = res.output.reason;
  } catch (err) {
    return {
      metric: errorRun(runIndex, `refusal classification: ${errorMessage(err)}`, Date.now() - start, rawOutput),
      items: [],
      traces: [],
    };
  }

  let items: AssessmentItem[] = [];
  let parserDroppedQuotes = 0;
  const citationResolution = { verbatim: 0, overlap: 0, bestFact: 0, unresolved: 0 };

  if (!refused) {
    let parsed;
    try {
      const res = await provider.generateStructured(
        fillPrompt('baseline_parse.v1.txt', { output: rawOutput }),
        BaselineParseSchema,
        { modelId: ctx.modelId, temperature: 0.0, actionName: `parseBaselineRun_${runIndex}` }
      );
      parsed = res.output.items;
    } catch (err) {
      return {
        metric: errorRun(runIndex, `baseline parsing: ${errorMessage(err)}`, Date.now() - start, rawOutput),
        items: [],
        traces: [],
      };
    }

    const normalizedOutput = normalizeArmenianText(rawOutput);
    items = parsed.map((it) => {
      const citations: AssessmentItem['citations'] = [];
      for (const cit of it.citations) {
        // A quote the parser wrote that is not in the baseline output is not the baseline's quote
        const nq = normalizeArmenianText(cit.quote);
        if (!nq || !normalizedOutput.includes(nq)) {
          parserDroppedQuotes++;
          continue;
        }
        const { chunk, match } = resolveQuoteToChunk(cit.quote, ctx.factChunks, ctx.methodChunks, cit.chunkId || undefined);
        if (match === 'verbatim') citationResolution.verbatim++;
        else if (match === 'overlap') citationResolution.overlap++;
        else if (match === 'best_fact') citationResolution.bestFact++;
        else citationResolution.unresolved++;
        citations.push({ chunkId: chunk?.chunk.id ?? '', quote: cit.quote });
      }
      return { ...it, citations };
    });
  }

  const traces = await validateAllItems(items, ctx.subject, ctx.grade, provider, {
    modelId: ctx.modelId,
    judgeProvider: ctx.judge,
    judgeConfidenceThreshold: ctx.judgeConfidenceThreshold,
  });
  const v = countViolations(traces);

  const metric: ScorecardMetric = {
    runIndex,
    refused,
    refusalReason,
    itemsCount: items.length,
    unsupportedClaimsCount: v.unsupported,
    correctRefusal: ctx.isUncoveredTopicPreset ? refused : !refused && items.length > 0,
    methodUsedAsFactCount: v.methodAsFact,
    itemsWithoutVerifiableQuote: v.unverifiableQuote,
    variantEquivalencePassed:
      items.length > 0 &&
      items.filter((i) => i.variant === 'A').length === items.filter((i) => i.variant === 'B').length,
    machineReadableTrace: computeMachineReadableTrace(traces),
    internalViolationsCaught: 0,
    validatorViolationsCaught: v.unsupported + v.methodAsFact + v.unverifiableQuote,
    latencyMs: Date.now() - start,
    citationResolution,
    parserDroppedQuotes,
    rawOutput,
  };
  return { metric, items, traces };
}

/** Share of successful runs that agree with the majority refusal decision; null below 2 runs. */
export function refusalStability(runs: ScorecardMetric[]): number | null {
  const valid = runs.filter((r) => !r.error && r.refused !== undefined);
  if (valid.length < 2) return null;
  const refusedCount = valid.filter((r) => r.refused).length;
  return Math.max(refusedCount, valid.length - refusedCount) / valid.length;
}

export function aggregateRuns(runs: ScorecardMetric[]): CompareAggregate {
  const valid = runs.filter((r) => !r.error);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const rate = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : null);
  const traceable = valid.map((r) => r.machineReadableTrace).filter((x): x is boolean => x !== null);
  return {
    validRuns: valid.length,
    errorRuns: runs.length - valid.length,
    avgUnsupportedClaims: avg(valid.map((r) => r.unsupportedClaimsCount)),
    refusalCorrectnessRate: rate(valid.map((r) => r.correctRefusal)),
    methodAsFactRate: avg(valid.map((r) => r.methodUsedAsFactCount)),
    unverifiableQuoteRate: avg(valid.map((r) => r.itemsWithoutVerifiableQuote)),
    equivalencePassRate: rate(valid.map((r) => r.variantEquivalencePassed)),
    stabilityAcrossRuns: refusalStability(runs),
    machineReadableTraceRate: rate(traceable),
    avgLatencyMs: avg(valid.map((r) => r.latencyMs)),
  };
}

export async function runSideBySideComparison(
  provider: IModelProvider,
  options: RunCompareOptions
): Promise<SideBySideReport> {
  const {
    subject,
    grade,
    topic,
    isUncoveredTopicPreset = false,
    selectedSourceIds,
    numberOfRuns = 3,
    modelId = 'gemini-3.8-flash',
    judgeProviderId = 'gemini',
    judgeConfidenceThreshold = 0.8,
  } = options;

  // Selected judge provider: Never silently switch judge!
  const selectedJudge: IJudgeProvider = getJudgeProvider(judgeProviderId);

  const baselineRuns: ScorecardMetric[] = [];
  const teachflowRuns: ScorecardMetric[] = [];
  const collectedItemsForAgreement: { claim: string; evidenceText: string }[] = [];

  const { factChunks, methodChunks } = retrieveChunks(subject, grade, topic, selectedSourceIds);

  const factSourceText = factChunks.map((c) => `[CHUNK: ${c.chunk.id}]\n${c.chunk.text}`).join('\n\n');
  const methodSourceText = methodChunks.map((c) => `[CHUNK: ${c.chunk.id}]\n${c.chunk.text}`).join('\n\n');

  const basePrompt = fillPrompt('baseline_generation.v1.txt', {
    subject,
    grade: String(grade),
    topic,
    factSource: factSourceText || '(NO FACT SOURCE)',
    methodSource: methodSourceText || '(NO METHOD SOURCE)',
  });

  for (let r = 1; r <= numberOfRuns; r++) {
    // --- 1. Baseline ---
    const baseline = await runBaselineOnce(provider, r, {
      subject,
      grade,
      prompt: basePrompt,
      factChunks,
      methodChunks,
      isUncoveredTopicPreset,
      modelId,
      judge: selectedJudge,
      judgeConfidenceThreshold,
    });
    baselineRuns.push(baseline.metric);

    // --- 2. TeachFlow pipeline ---
    const startTf = Date.now();
    try {
      const tfAssessment = await runFullGenerationPipeline({
        subject,
        grade,
        topic,
        selectedSourceIds,
        provider,
        modelId,
        judgeProvider: selectedJudge,
        judgeConfidenceThreshold,
      });
      const v = countViolations(tfAssessment.traces);
      const refused = tfAssessment.status === 'refused';

      for (const item of tfAssessment.items) {
        if (item.citations && item.citations[0]) {
          const chunk = factChunks.find((c) => c.chunk.id === item.citations[0].chunkId);
          if (chunk) {
            collectedItemsForAgreement.push({
              claim: `${item.stem} (Ans: ${item.answerKey})`,
              evidenceText: chunk.chunk.text,
            });
          }
        }
      }

      teachflowRuns.push({
        runIndex: r,
        refused,
        refusalReason: tfAssessment.refusalReason,
        itemsCount: tfAssessment.items.length,
        unsupportedClaimsCount: v.unsupported,
        correctRefusal: isUncoveredTopicPreset ? refused : !refused && tfAssessment.items.length > 0,
        methodUsedAsFactCount: v.methodAsFact,
        itemsWithoutVerifiableQuote: v.unverifiableQuote,
        variantEquivalencePassed:
          tfAssessment.items.length > 0 && !tfAssessment.variantEquivalence.some((c) => c.result === 'fail'),
        machineReadableTrace: computeMachineReadableTrace(tfAssessment.traces),
        internalViolationsCaught: tfAssessment.traces.filter((t) => t.status === 'FAIL').length,
        validatorViolationsCaught: v.unsupported + v.methodAsFact + v.unverifiableQuote,
        latencyMs: Date.now() - startTf,
      });
    } catch (err) {
      teachflowRuns.push(errorRun(r, `TeachFlow pipeline: ${errorMessage(err)}`, Date.now() - startTf));
    }
  }

  // Judge agreement rate calculation between Gemini-judge and Jev-judge
  let judgeAgreementRate: number | undefined = undefined;
  if (isTypeSafeJevConfigured() && collectedItemsForAgreement.length > 0) {
    try {
      const geminiJudge = new GeminiJudgeProvider();
      const jevJudge = new TypeSafeJevJudgeProvider();
      const sample = collectedItemsForAgreement.slice(0, 5);
      let matches = 0;
      for (const s of sample) {
        const [gRes, jRes] = await Promise.all([
          geminiJudge.verifyClaim(s.claim, s.evidenceText),
          jevJudge.verifyClaim(s.claim, s.evidenceText),
        ]);
        if (gRes.verdict === jRes.verdict) {
          matches++;
        }
      }
      judgeAgreementRate = matches / sample.length;
    } catch (err) {
      console.warn('Could not compute Jev agreement rate:', err);
    }
  }

  const report: SideBySideReport = {
    id: `comp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    subject,
    grade,
    topic,
    isUncoveredTopicPreset,
    numberOfRuns,
    executedAt: new Date().toISOString(),
    modelId,
    judgeProviderId,
    judgeAgreementRate,
    baselineRuns,
    teachflowRuns,
    aggregated: {
      baseline: aggregateRuns(baselineRuns),
      teachflow: aggregateRuns(teachflowRuns),
    },
  };

  return repository.saveSideBySideReport(report);
}
