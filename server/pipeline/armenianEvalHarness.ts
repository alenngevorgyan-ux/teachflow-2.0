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

      if (hasForbidden) {
        passed = false;
        score = 20;
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
        score = 30;
        notes = `Պատասխանը բավարար չափով չի համապատասխանում ակնկալվող վերջնարդյունքին:`;
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
