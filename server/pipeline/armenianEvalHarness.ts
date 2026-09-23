import { ArmenianEvalResult, ArmenianEvalTask } from '../../shared/types.js';
import { IModelProvider } from '../providers/modelProvider.js';
import { repository } from '../store/repository.js';

export async function runArmenianEvaluation(
  provider: IModelProvider,
  modelId: string | undefined,
  tasks?: ArmenianEvalTask[]
): Promise<ArmenianEvalResult> {
  const evalTasks = tasks || repository.getArmenianEvalTasks();
  const taskResults: ArmenianEvalResult['taskResults'] = [];
  const categoryMap: Record<string, { total: number; score: number }> = {};

  for (const task of evalTasks) {
    if (!categoryMap[task.category]) {
      categoryMap[task.category] = { total: 0, score: 0 };
    }
    categoryMap[task.category].total += 100;

    let output = '';
    let passed = false;
    let score = 0;
    let notes = '';

    try {
      const fullPrompt = `${task.prompt}\n${task.contextText ? `Համատեքստ/Աղբյուր:\n${task.contextText}\n` : ''}\nՊատասխանեք հստակ և հակիրճ հայերենով:`;
      const res = await provider.generateText(fullPrompt, {
        modelId,
        temperature: 0.1,
      });
      output = (res.output || '').trim();

      // Check forbidden outputs
      const hasForbidden = task.forbiddenOutputs.some((forb) =>
        output.toLowerCase().includes(forb.toLowerCase())
      );

      // Check ground truth keywords
      const matchedKeywords = task.groundTruthKeywords.filter((kw) =>
        output.toLowerCase().includes(kw.toLowerCase())
      );

      // SPEC (T13): a forbidden form or a wrong answer scores 0 — never a
      // consolation score. Partial credit only applies when at least one
      // ground-truth keyword genuinely matched and nothing forbidden appeared.
      if (hasForbidden) {
        passed = false;
        score = 0;
        notes = `Հայտնաբերվել է արգելված արտահայտություն կամ սխալ ուղղագրական/կառուցվածքային ձև:`;
      } else if (matchedKeywords.length === task.groundTruthKeywords.length) {
        passed = true;
        score = 100;
        notes = `Բոլոր հիմնաբառերը ճշգրիտ առկա են, արգելված ձևեր չեն հայտնաբերվել:`;
      } else if (matchedKeywords.length > 0) {
        passed = true;
        score = Math.round((matchedKeywords.length / task.groundTruthKeywords.length) * 100);
        notes = `Մասնակի ճշգրտություն (${matchedKeywords.length}/${task.groundTruthKeywords.length} հիմնաբառ):`;
      } else {
        passed = false;
        score = 0;
        notes = `Սխալ պատասխան. ակնկալվող հիմնաբառերից ոչ մեկը չի հայտնաբերվել:`;
      }
    } catch (err: any) {
      output = `Սխալ գեներացիայի ժամանակ: ${err?.message || err}`;
      passed = false;
      score = 0;
      notes = 'Մոդելը չկարողացավ ավարտել առաջադրանքը:';
    }

    categoryMap[task.category].score += score;
    taskResults.push({
      taskId: task.id,
      category: task.category,
      passed,
      score,
      modelOutput: output,
      notes,
    });
  }

  const categoryScores: Record<string, number> = {};
  let totalPoints = 0;
  let maxPoints = 0;

  for (const [cat, val] of Object.entries(categoryMap)) {
    const catPercent = val.total > 0 ? Math.round((val.score / val.total) * 100) : 0;
    categoryScores[cat] = catPercent;
    totalPoints += val.score;
    maxPoints += val.total;
  }

  const overallScore = maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : 0;

  const result: ArmenianEvalResult = {
    runId: `arm-eval-${Date.now()}`,
    timestamp: new Date().toISOString(),
    providerId: provider.providerId,
    modelId: modelId || provider.defaultModelId || 'n/a',
    categoryScores,
    overallScore,
    taskResults,
  };

  return repository.saveArmenianEvalResult(result);
}

export interface CategoryModelRecommendation {
  category: string;
  providerId: string;
  modelId: string;
  avgScore: number;
  runCount: number;
}

// Aggregates every stored eval run by (category, provider, model) and
// returns, per category, whichever (provider, model) pair scored the
// highest average — this is what "per-task-type default model selection by
// score" is computed from. Never picks a model that was never actually run
// for that category; a category with no runs at all is simply absent from
// the result, not defaulted to anything.
export function computeCategoryModelRecommendations(
  results: ArmenianEvalResult[]
): CategoryModelRecommendation[] {
  // key: `${category}::${providerId}::${modelId}`
  const agg = new Map<string, { category: string; providerId: string; modelId: string; total: number; count: number }>();

  for (const result of results) {
    for (const taskResult of result.taskResults) {
      const key = `${taskResult.category}::${result.providerId}::${result.modelId}`;
      const entry = agg.get(key) || {
        category: taskResult.category,
        providerId: result.providerId,
        modelId: result.modelId,
        total: 0,
        count: 0,
      };
      entry.total += taskResult.score;
      entry.count += 1;
      agg.set(key, entry);
    }
  }

  const byCategory = new Map<string, CategoryModelRecommendation>();
  for (const entry of agg.values()) {
    const avgScore = entry.count > 0 ? entry.total / entry.count : 0;
    const current = byCategory.get(entry.category);
    if (!current || avgScore > current.avgScore) {
      byCategory.set(entry.category, {
        category: entry.category,
        providerId: entry.providerId,
        modelId: entry.modelId,
        avgScore: Math.round(avgScore * 10) / 10,
        runCount: entry.count,
      });
    }
  }

  return Array.from(byCategory.values()).sort((a, b) => a.category.localeCompare(b.category));
}
