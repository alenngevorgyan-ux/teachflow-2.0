import { RegressionRun } from '../../shared/types.js';
import { IModelProvider } from '../providers/modelProvider.js';
import { repository } from '../store/repository.js';
import { runFullGenerationPipeline } from './orchestrator.js';

export async function runRegressionSuite(
  provider: IModelProvider,
  modelId?: string
): Promise<RegressionRun> {
  const frozenTasks = repository.getFrozenTasks();
  const policyVersion = repository.computePolicyVersion();

  const results: RegressionRun['results'] = [];
  let correctCount = 0;
  let totalLatency = 0;
  let totalFailCount = 0;

  for (const task of frozenTasks) {
    const start = Date.now();
    let actualOutcome: 'generate' | 'refuse' = 'generate';
    let unsupportedCount = 0;
    let failRate = 0;
    let ruleViolations = 0;
    let equivalenceFailures = 0;

    try {
      const assessment = await runFullGenerationPipeline({
        subject: task.subject,
        grade: task.grade,
        topic: task.topic,
        selectedSourceIds: task.sourceIds,
        provider,
        modelId,
      });

      if (assessment.status === 'refused') {
        actualOutcome = 'refuse';
      } else {
        actualOutcome = 'generate';
        const totalItems = assessment.items.length;
        let failItems = 0;

        for (const t of assessment.traces) {
          if (t.status === 'FAIL') failItems++;
          for (const chk of t.checks) {
            if (chk.checkId === 'claim_supported' && chk.result === 'fail') unsupportedCount++;
            if (chk.kind === 'deterministic' && chk.result === 'fail') ruleViolations++;
          }
        }
        failRate = totalItems > 0 ? failItems / totalItems : 0;
        if (assessment.variantEquivalence.some((c) => c.result === 'fail')) {
          equivalenceFailures++;
        }
      }
    } catch (err: unknown) {
      console.warn(`Regression task ${task.id} encountered error:`, err);
      actualOutcome = 'refuse';
    }

    const latencyMs = Date.now() - start;
    totalLatency += latencyMs;
    totalFailCount += failRate;

    const isCorrect = actualOutcome === task.expectedOutcome;
    if (isCorrect) correctCount++;

    results.push({
      taskId: task.id,
      topic: task.topic,
      actualOutcome,
      expectedOutcome: task.expectedOutcome,
      correct: isCorrect,
      unsupportedClaimsCount: unsupportedCount,
      failRate,
      ruleViolations,
      equivalenceFailures,
      latencyMs,
    });
  }

  const run: RegressionRun = {
    id: `reg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    runDate: new Date().toISOString(),
    providerId: provider.providerId,
    modelId: modelId || provider.defaultModelId || 'n/a',
    policyVersion,
    results,
    summary: {
      totalTasks: frozenTasks.length,
      correctCount,
      accuracy: frozenTasks.length > 0 ? correctCount / frozenTasks.length : 1,
      avgLatencyMs: frozenTasks.length > 0 ? Math.round(totalLatency / frozenTasks.length) : 0,
      avgFailRate: frozenTasks.length > 0 ? Number((totalFailCount / frozenTasks.length).toFixed(3)) : 0,
    },
  };

  return repository.saveRegressionRun(run);
}

export interface RegressionDiff {
  runA: RegressionRun;
  runB: RegressionRun;
  summaryText: string;
  accuracyChange: number; // positive = improvement
  latencyChange: number;
  failRateChange: number;
  tasksWithChanges: {
    taskId: string;
    topic: string;
    statusChange: 'improved' | 'degraded' | 'unchanged';
    detail: string;
  }[];
}

export function computeRegressionDiff(
  olderRun: RegressionRun,
  newerRun: RegressionRun
): RegressionDiff {
  let improvedCount = 0;
  let degradedCount = 0;
  let unchangedCount = 0;

  const tasksWithChanges: RegressionDiff['tasksWithChanges'] = [];

  for (const newRes of newerRun.results) {
    const oldRes = olderRun.results.find((r) => r.taskId === newRes.taskId);
    if (!oldRes) continue;

    let statusChange: 'improved' | 'degraded' | 'unchanged' = 'unchanged';
    let detail = 'Արդյունքները նույնական են:';

    if (!oldRes.correct && newRes.correct) {
      statusChange = 'improved';
      detail = `Շտկում. նախկինում ${oldRes.actualOutcome}, այժմ ակնկալվող ${newRes.expectedOutcome}:`;
      improvedCount++;
    } else if (oldRes.correct && !newRes.correct) {
      statusChange = 'degraded';
      detail = `Ռեգրես. ակնկալվում էր ${newRes.expectedOutcome}, սակայն գրանցվեց ${newRes.actualOutcome}:`;
      degradedCount++;
    } else if (newRes.unsupportedClaimsCount < oldRes.unsupportedClaimsCount) {
      statusChange = 'improved';
      detail = `Անհիմն պնդումների նվազում (${oldRes.unsupportedClaimsCount} -> ${newRes.unsupportedClaimsCount}):`;
      improvedCount++;
    } else if (newRes.unsupportedClaimsCount > oldRes.unsupportedClaimsCount) {
      statusChange = 'degraded';
      detail = `Անհիմն պնդումների աճ (${oldRes.unsupportedClaimsCount} -> ${newRes.unsupportedClaimsCount}):`;
      degradedCount++;
    } else {
      unchangedCount++;
    }

    tasksWithChanges.push({
      taskId: newRes.taskId,
      topic: newRes.topic,
      statusChange,
      detail,
    });
  }

  let summaryText = '';
  if (improvedCount > degradedCount) {
    summaryText = `Համեմատած ${olderRun.modelId} (${olderRun.runDate.substring(0, 10)}) փորձարկման հետ, որակը բարելավվել է ${improvedCount}/${newerRun.results.length} առաջադրանքներում:`;
  } else if (degradedCount > improvedCount) {
    summaryText = `Համեմատած ${olderRun.modelId} (${olderRun.runDate.substring(0, 10)}) փորձարկման հետ, արձանագրվել է որակի նվազում ${degradedCount}/${newerRun.results.length} առաջադրանքներում:`;
  } else {
    summaryText = `Համեմատած ${olderRun.modelId} (${olderRun.runDate.substring(0, 10)}) փորձարկման հետ, որակը մնացել է անփոփոխ:`;
  }

  return {
    runA: olderRun,
    runB: newerRun,
    summaryText,
    accuracyChange: newerRun.summary.accuracy - olderRun.summary.accuracy,
    latencyChange: newerRun.summary.avgLatencyMs - olderRun.summary.avgLatencyMs,
    failRateChange: newerRun.summary.avgFailRate - olderRun.summary.avgFailRate,
    tasksWithChanges,
  };
}
