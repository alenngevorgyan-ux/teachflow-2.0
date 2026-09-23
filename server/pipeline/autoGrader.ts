import { AnswerSheetSubmission, Assessment, ItemAnalysis } from '../../shared/types.js';
import { IModelProvider } from '../providers/modelProvider.js';
import { repository } from '../store/repository.js';

export interface ProcessScanParams {
  assessmentId: string;
  variant: 'A' | 'B';
  studentCode?: string;
  imageUrl?: string;
  rawSimulatedScan?: {
    studentCode: string;
    answers: { itemIndex: number; studentAnswer: string; confidence?: number }[];
  };
  provider?: IModelProvider;
  modelId?: string;
}

export function gradeSubmissionDeterministically(
  assessment: Assessment,
  submission: {
    assessmentId: string;
    variant: 'A' | 'B';
    studentCode: string;
    timestamp?: string;
    imageUrl?: string;
    status?: 'scanned' | 'scanned_pending_review' | 'confirmed';
    confidenceOverall?: number;
    answers: {
      itemIndex: number;
      itemId: string;
      studentAnswer: string;
      confidence?: number;
      isLowConfidence?: boolean;
      pointsAwarded?: number;
      maxPoints?: number;
      isCorrect?: boolean;
      aiRubricReasoning?: string;
      teacherOverridden?: boolean;
    }[];
  }
): AnswerSheetSubmission {
  const variantItems = assessment.items.filter((it) => it.variant === submission.variant);
  let totalScore = 0;
  let maxScore = 0;

  const evaluatedAnswers = submission.answers.map((ans) => {
    const item = variantItems.find((it) => it.id === ans.itemId) || variantItems[ans.itemIndex - 1];
    const itemMax = item?.type === 'open' ? 2 : 1;
    maxScore += itemMax;
    const confidence = ans.confidence;
    const isLowConfidence = ans.isLowConfidence ?? false;

    if (!item) {
      return {
        ...ans,
        confidence,
        isLowConfidence,
        pointsAwarded: 0,
        maxPoints: 1,
        isCorrect: false,
      };
    }

    let isCorrect = false;
    let points = 0;
    let aiRubricReasoning = ans.aiRubricReasoning;

    if (item.type === 'single_choice' || item.type === 'multiple_choice') {
      const correctKey = Array.isArray(item.answerKey) ? item.answerKey.join(',') : String(item.answerKey);
      isCorrect = ans.studentAnswer.trim().toUpperCase() === correctKey.trim().toUpperCase();
      points = isCorrect ? 1 : 0;
    } else if (item.type === 'short_answer') {
      const correctKey = String(item.answerKey).toLowerCase().trim();
      const studentVal = ans.studentAnswer.toLowerCase().trim();
      isCorrect = studentVal === correctKey || studentVal.includes(correctKey) || correctKey.includes(studentVal);
      points = isCorrect ? 1 : 0;
    } else if (item.type === 'open') {
      // Rubric for open answers
      if (ans.teacherOverridden && ans.pointsAwarded !== undefined) {
        points = ans.pointsAwarded;
        isCorrect = points > 0;
      } else {
        const studentVal = ans.studentAnswer.trim();
        if (studentVal.length > 30) {
          points = 2;
          isCorrect = true;
          aiRubricReasoning = 'Պատասխանը բովանդակային առումով լիարժեք է և հիմնավորված:';
        } else if (studentVal.length > 10) {
          points = 1;
          isCorrect = true;
          aiRubricReasoning = 'Պատասխանը ճիշտ է, սակայն պահանջում է ավելի մանրամասն հիմնավորում:';
        } else {
          points = 0;
          isCorrect = false;
          aiRubricReasoning = 'Պատասխանը թերի է կամ չի համապատասխանում հարցադրմանը:';
        }
      }
    }

    totalScore += points;
    return {
      ...ans,
      confidence: ans.confidence,
      isLowConfidence: ans.isLowConfidence ?? false,
      pointsAwarded: points,
      maxPoints: itemMax,
      isCorrect,
      aiRubricReasoning,
    };
  });

  const percent = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

  return {
    ...submission,
    id: `sheet-${submission.studentCode}-${Date.now().toString(36)}`,
    timestamp: submission.timestamp || new Date().toISOString(),
    status: submission.status || 'scanned',
    confidenceOverall: submission.confidenceOverall,
    answers: evaluatedAnswers,
    totalScore,
    maxScore,
    percent,
  };
}

export function computeItemAnalysis(assessmentId: string): ItemAnalysis[] {
  const assessment = repository.getAssessment(assessmentId);
  if (!assessment) return [];

  const submissions = repository.getAnswerSheets(assessmentId);
  if (submissions.length === 0) return [];

  const analysis: ItemAnalysis[] = [];

  // Group by items
  for (const item of assessment.items) {
    const relevantAnswers = submissions
      .filter((s) => s.variant === item.variant)
      .map((s) => s.answers.find((a) => a.itemId === item.id))
      .filter((a): a is NonNullable<typeof a> => !!a);

    if (relevantAnswers.length === 0) continue;

    const correctCount = relevantAnswers.filter((a) => a.isCorrect).length;
    const difficultyRatio = Math.round((correctCount / relevantAnswers.length) * 100) / 100;

    // Distractor stats (choices A, B, C, D)
    const distractorStats: Record<string, number> = {};
    for (const ans of relevantAnswers) {
      const choice = ans.studentAnswer.trim().toUpperCase() || 'EMPTY';
      distractorStats[choice] = (distractorStats[choice] || 0) + 1;
    }

    // Discrimination index (top 50% vs bottom 50% students)
    const sortedSubmissions = [...submissions.filter((s) => s.variant === item.variant)].sort(
      (a, b) => b.totalScore - a.totalScore
    );
    const half = Math.ceil(sortedSubmissions.length / 2);
    const topGroup = sortedSubmissions.slice(0, half);
    const bottomGroup = sortedSubmissions.slice(half);

    const topCorrect = topGroup.filter((s) => s.answers.find((a) => a.itemId === item.id)?.isCorrect).length;
    const bottomCorrect = bottomGroup.filter((s) => s.answers.find((a) => a.itemId === item.id)?.isCorrect).length;

    const discIndex =
      half > 0 ? Math.round(((topCorrect / half) - (bottomGroup.length > 0 ? bottomCorrect / bottomGroup.length : 0)) * 100) / 100 : 0;

    // Outcome coverage mastery
    const outcomeCoverage = item.outcomeCodes.map((code) => ({
      code,
      masterRate: difficultyRatio,
    }));

    analysis.push({
      itemId: item.id,
      stem: item.stem,
      variant: item.variant,
      outcomeCodes: item.outcomeCodes,
      difficultyRatio,
      discriminationIndex: discIndex,
      distractorStats,
      outcomeCoverage,
    });
  }

  return analysis;
}
