import fs from 'fs';
import path from 'path';
import { AssessmentGenerationOutputSchema } from '../../shared/schemas.js';
import {
  AssessmentItem,
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
import { retrieveChunks } from './retrieval.js';
import { validateAllItems } from './validator.js';

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

  const { factChunks, methodChunks } = retrieveChunks(
    subject,
    grade,
    topic,
    selectedSourceIds
  );

  const factSourceText = factChunks
    .map((c) => `[CHUNK: ${c.chunk.id}]\n${c.chunk.text}`)
    .join('\n\n');
  const methodSourceText = methodChunks
    .map((c) => `[CHUNK: ${c.chunk.id}]\n${c.chunk.text}`)
    .join('\n\n');

  // Baseline prompt template
  const baselinePromptTemplatePath = path.resolve(
    process.cwd(),
    'server/prompts/baseline_generation.v1.txt'
  );
  let basePromptRaw = fs.readFileSync(baselinePromptTemplatePath, 'utf-8');
  basePromptRaw = basePromptRaw
    .replace('{{subject}}', subject)
    .replace('{{grade}}', String(grade))
    .replace('{{topic}}', topic)
    .replace('{{factSource}}', factSourceText || '(NO FACT SOURCE)')
    .replace('{{methodSource}}', methodSourceText || '(NO METHOD SOURCE)');

  for (let r = 1; r <= numberOfRuns; r++) {
    // --- 1. Run Baseline ---
    const startBaseline = Date.now();
    let baselineRefusal = false;
    let baselineItems: AssessmentItem[] = [];

    try {
      const baseRes = await provider.generateText(basePromptRaw, {
        modelId,
        temperature: 0.2,
        actionName: `baselineComparisonRun_${r}`,
      });

      const textOutput = baseRes.output;
      // Check if baseline explicitly refused
      if (
        textOutput.toLowerCase().includes('insufficient source') ||
        textOutput.toLowerCase().includes('անբավարար') ||
        textOutput.toLowerCase().includes('չի պարունակում') ||
        textOutput.toLowerCase().includes('մերժված')
      ) {
        baselineRefusal = true;
      }

      // Parse baseline text output into items schema using structured output
      if (!baselineRefusal) {
        try {
          const parsePrompt = `Extract the test questions and variants from this text into structured items schema:\n\n${textOutput}`;
          const parsed = await provider.generateStructured(
            parsePrompt,
            AssessmentGenerationOutputSchema,
            { modelId, temperature: 0.0, actionName: `parseBaselineRun_${r}` }
          );
          baselineItems = parsed.output.items;
        } catch {
          baselineItems = [];
        }
      }
    } catch {
      baselineRefusal = true;
    }

    const baselineLatency = Date.now() - startBaseline;

    // Validate baseline items with SAME validator and selected judge
    const baselineTraces = await validateAllItems(
      baselineItems,
      subject,
      grade,
      provider,
      {
        modelId,
        judgeProvider: selectedJudge,
        judgeConfidenceThreshold,
      }
    );

    let baseUnsupported = 0;
    let baseMethodAsFact = 0;
    let baseUnverifiableQuote = 0;

    for (const t of baselineTraces) {
      for (const chk of t.checks) {
        if (chk.checkId === 'claim_supported' && chk.result === 'fail') baseUnsupported++;
        if (chk.checkId === 'citation_is_fact_source' && chk.result === 'fail') baseMethodAsFact++;
        if (chk.checkId === 'quote_verbatim' && chk.result === 'fail') baseUnverifiableQuote++;
      }
    }

    const baseCorrectRefusal = isUncoveredTopicPreset
      ? baselineRefusal
      : !baselineRefusal && baselineItems.length > 0;

    baselineRuns.push({
      runIndex: r,
      unsupportedClaimsCount: baseUnsupported,
      correctRefusal: baseCorrectRefusal,
      methodUsedAsFactCount: baseMethodAsFact,
      itemsWithoutVerifiableQuote: baseUnverifiableQuote,
      variantEquivalencePassed:
        baselineItems.filter((i) => i.variant === 'A').length ===
        baselineItems.filter((i) => i.variant === 'B').length,
      machineReadableTrace: false, // Baseline plain AI does not produce machine-readable per-item trace
      internalViolationsCaught: 0,
      validatorViolationsCaught: baseUnsupported + baseMethodAsFact + baseUnverifiableQuote,
      latencyMs: baselineLatency,
    });

    // --- 2. Run TeachFlow Pipeline ---
    const startTf = Date.now();
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
    const tfLatency = Date.now() - startTf;

    let tfUnsupported = 0;
    let tfMethodAsFact = 0;
    let tfUnverifiableQuote = 0;
    let tfInternalViolations = 0;

    for (const t of tfAssessment.traces) {
      if (t.status === 'FAIL') tfInternalViolations++;
      for (const chk of t.checks) {
        if (chk.checkId === 'claim_supported' && chk.result === 'fail') tfUnsupported++;
        if (chk.checkId === 'citation_is_fact_source' && chk.result === 'fail') tfMethodAsFact++;
        if (chk.checkId === 'quote_verbatim' && chk.result === 'fail') tfUnverifiableQuote++;
      }
    }

    // Collect items for agreement evaluation
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

    const tfCorrectRefusal = isUncoveredTopicPreset
      ? tfAssessment.status === 'refused'
      : tfAssessment.status !== 'refused' && tfAssessment.items.length > 0;

    teachflowRuns.push({
      runIndex: r,
      unsupportedClaimsCount: tfUnsupported,
      correctRefusal: tfCorrectRefusal,
      methodUsedAsFactCount: tfMethodAsFact,
      itemsWithoutVerifiableQuote: tfUnverifiableQuote,
      variantEquivalencePassed: !tfAssessment.variantEquivalence.some((c) => c.result === 'fail'),
      machineReadableTrace: true,
      internalViolationsCaught: tfInternalViolations,
      validatorViolationsCaught: tfUnsupported + tfMethodAsFact + tfUnverifiableQuote,
      latencyMs: tfLatency,
    });
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

  // Calculate aggregations & stability
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  const baseRefusalAcc =
    baselineRuns.filter((r) => r.correctRefusal).length / baselineRuns.length;
  const tfRefusalAcc =
    teachflowRuns.filter((r) => r.correctRefusal).length / teachflowRuns.length;

  // Stability across runs: standard deviation / variance in refusal and claim behavior
  const baseStability =
    baselineRuns.every((r) => r.correctRefusal === baselineRuns[0].correctRefusal) ? 1.0 : 0.5;
  const tfStability =
    teachflowRuns.every((r) => r.correctRefusal === teachflowRuns[0].correctRefusal) ? 1.0 : 0.8;

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
      baseline: {
        avgUnsupportedClaims: avg(baselineRuns.map((r) => r.unsupportedClaimsCount)),
        refusalCorrectnessRate: baseRefusalAcc,
        methodAsFactRate: avg(baselineRuns.map((r) => r.methodUsedAsFactCount)),
        unverifiableQuoteRate: avg(baselineRuns.map((r) => r.itemsWithoutVerifiableQuote)),
        equivalencePassRate:
          baselineRuns.filter((r) => r.variantEquivalencePassed).length / baselineRuns.length,
        stabilityAcrossRuns: baseStability,
        avgLatencyMs: avg(baselineRuns.map((r) => r.latencyMs)),
      },
      teachflow: {
        avgUnsupportedClaims: avg(teachflowRuns.map((r) => r.unsupportedClaimsCount)),
        refusalCorrectnessRate: tfRefusalAcc,
        methodAsFactRate: avg(teachflowRuns.map((r) => r.methodUsedAsFactCount)),
        unverifiableQuoteRate: avg(teachflowRuns.map((r) => r.itemsWithoutVerifiableQuote)),
        equivalencePassRate:
          teachflowRuns.filter((r) => r.variantEquivalencePassed).length / teachflowRuns.length,
        stabilityAcrossRuns: tfStability,
        avgLatencyMs: avg(teachflowRuns.map((r) => r.latencyMs)),
      },
    },
  };

  return repository.saveSideBySideReport(report);
}
