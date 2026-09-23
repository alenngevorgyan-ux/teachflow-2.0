import { z } from 'zod';

export const CoverageCheckSchema = z.object({
  topicCovered: z.boolean().describe('Whether the retrieved FACT chunks provide sufficient facts to build an assessment on the topic'),
  coveredOutcomeCodes: z.array(z.string()).describe('List of official outcome codes covered by the facts'),
  missingAspects: z.array(z.string()).describe('Key concepts or subtopics missing from the FACT sources if any'),
  refusalReasonArmenian: z.string().optional().describe('Clear explanation in Armenian why sources are insufficient if topicCovered is false'),
});

export type CoverageCheckResult = z.infer<typeof CoverageCheckSchema>;

export const CitationSchema = z.object({
  chunkId: z.string().describe('The exact chunk id from the FACT sources block'),
  quote: z.string().describe('A verbatim quote extracted directly from that chunk text'),
});

export const AssessmentItemSchema = z.object({
  id: z.string().describe('Item identifier (e.g., item-A-1, item-B-1)'),
  variant: z.enum(['A', 'B']).describe('Variant A or Variant B'),
  type: z.enum(['single_choice', 'multiple_choice', 'short_answer', 'open']),
  stem: z.string().describe('The question stem in clean Armenian'),
  options: z.array(z.string()).optional().describe('Answer choices for multiple or single choice (at least 3 or 4 choices)'),
  answerKey: z.union([z.string(), z.array(z.string())]).describe('The correct answer option or text'),
  outcomeCodes: z.array(z.string()).describe('Outcome codes linked to this question'),
  difficulty: z.enum(['basic', 'medium', 'advanced']),
  citations: z.array(CitationSchema).min(1).describe('At least one citation to a FACT chunk with a verbatim quote'),
});

export const AssessmentGenerationOutputSchema = z.object({
  items: z.array(AssessmentItemSchema),
});

export type AssessmentGenerationOutput = z.infer<typeof AssessmentGenerationOutputSchema>;

// Transcription of a baseline (plain AI) test: quotes are kept as written,
// chunk ids are optional because a plain assistant usually does not give them.
export const BaselineParseSchema = z.object({
  items: z.array(
    AssessmentItemSchema.extend({
      citations: z.array(
        z.object({
          chunkId: z.string().optional().describe('Chunk id only if literally written in the text'),
          quote: z.string().describe('The source quote exactly as written in the text'),
        })
      ),
    })
  ),
});

export type BaselineParseOutput = z.infer<typeof BaselineParseSchema>;

export const BaselineRefusalSchema = z.object({
  refused: z.boolean(),
  reason: z.string(),
});

export type BaselineRefusalOutput = z.infer<typeof BaselineRefusalSchema>;

export const ClaimJudgeSchema = z.object({
  supportStatus: z.enum(['supported', 'partially_supported', 'not_supported']),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().describe('Detailed explanation of why the claim is supported or not by the provided chunk text'),
});

export type ClaimJudgeOutput = z.infer<typeof ClaimJudgeSchema>;

export const LanguageJudgeSchema = z.object({
  hasIssues: z.boolean(),
  severity: z.enum(['none', 'warning', 'error']),
  issues: z.array(
    z.object({
      category: z.enum(['spelling', 'terminology', 'ocr_artifact', 'grammar']),
      flaggedText: z.string(),
      explanation: z.string(),
      suggestion: z.string().optional(),
    })
  ),
});

export type LanguageJudgeOutput = z.infer<typeof LanguageJudgeSchema>;

export const RuleJudgeSchema = z.object({
  result: z.enum(['pass', 'warn', 'fail']),
  detail: z.string().describe('Explanation of how the item conforms or violates the methodological rule'),
});

export type RuleJudgeOutput = z.infer<typeof RuleJudgeSchema>;

export const EquivalenceJudgeSchema = z.object({
  equivalent: z.boolean(),
  result: z.enum(['pass', 'warn', 'fail']),
  difficultyComparison: z.string(),
  contentBalance: z.string(),
  detail: z.string(),
});

export type EquivalenceJudgeOutput = z.infer<typeof EquivalenceJudgeSchema>;

export const WorkspaceIntentSchema = z.object({
  intent: z.enum(['generate_thematic_plan', 'generate_lesson_plan', 'load_report', 'unclear']),
  subject: z.string().optional().describe('Subject name if the teacher named one, else omit (use the pinned/default subject)'),
  grade: z.number().int().optional().describe('Grade number if the teacher named one, else omit'),
  topic: z.string().optional().describe('For generate_lesson_plan: the topic/theme the teacher wants a lesson plan for'),
  sourceHints: z.array(z.string()).optional().describe('Any source titles, textbook names, or keywords the teacher mentioned about which material to use'),
  clarifyingQuestion: z
    .string()
    .optional()
    .describe('Required when intent is "unclear": a short Armenian question asking the teacher what they want'),
});

export type WorkspaceIntentOutput = z.infer<typeof WorkspaceIntentSchema>;

export const LessonPlanStageSchema = z.object({
  title: z.string(),
  durationMinutes: z.number().int().positive(),
  teacherActivity: z.string(),
  studentActivity: z.string(),
  formativeCheck: z.string(),
});

export const LessonPlanCitationSchema = z.object({
  chunkId: z.string().describe('The exact chunk id from the FACT chunks block'),
  quote: z.string().describe('A verbatim quote extracted directly from that chunk text'),
});

export const LessonPlanGenerationOutputSchema = z.object({
  objectives: z.array(z.string()).min(1).describe('Lesson objectives tied to the confirmed outcome codes'),
  requiredMaterials: z.array(z.string()).min(1),
  stages: z
    .array(LessonPlanStageSchema)
    .min(1)
    .describe('The ԽԻԿ (Խթանում/Իմաստի ընկալում/Կշռադատում) stages, durations summing to the lesson duration'),
  homework: z.string(),
  citations: z
    .array(LessonPlanCitationSchema)
    .min(1)
    .describe('At least one citation to a FACT chunk grounding the lesson content, with an exact verbatim quote'),
});

export type LessonPlanGenerationOutput = z.infer<typeof LessonPlanGenerationOutputSchema>;

export const AnswerSheetVisionAnswerSchema = z.object({
  itemIndex: z.number().int().min(1).describe('1-indexed item number as printed on the sheet'),
  mark: z
    .string()
    .describe('The selected option letter, or handwritten response, exactly as marked — empty string if left blank'),
  confidence: z.number().min(0).max(1).describe('How legible/certain this specific reading is'),
});

export const AnswerSheetVisionSchema = z.object({
  studentCode: z
    .string()
    .optional()
    .describe('The anonymous student code handwritten in the code box, if legible — never a real name'),
  answers: z.array(AnswerSheetVisionAnswerSchema),
  unreadableNote: z
    .string()
    .optional()
    .describe('Brief note if the photo quality prevented reading some/all fields'),
});

export type AnswerSheetVisionOutput = z.infer<typeof AnswerSheetVisionSchema>;

export const ThematicPlanTopicSchema = z.object({
  topic: z.string().describe('Topic title in Armenian, grounded in the confirmed outcomes / FACT chunks'),
  outcomeCodes: z
    .array(z.string())
    .min(1)
    .describe('Confirmed outcome codes this topic covers — must exactly match codes from the provided list, never invented'),
  plannedHours: z.number().int().positive().describe('Hours allocated to this topic'),
  hasAssessment: z.boolean(),
  assessmentType: z.enum(['diagnostic', 'formative', 'summative']).optional(),
});

export const ThematicPlanGenerationOutputSchema = z.object({
  topics: z.array(ThematicPlanTopicSchema).min(1),
});

export type ThematicPlanGenerationOutput = z.infer<typeof ThematicPlanGenerationOutputSchema>;

export const ExtractedClaimsSchema = z.object({
  claims: z.array(
    z.object({
      id: z.string(),
      stem: z.string(),
      type: z.string(),
      options: z.array(z.string()).optional(),
      answerKey: z.string().optional(),
      claimFact: z.string().describe('The core factual assertion made by this question or answer'),
    })
  ),
});

export type ExtractedClaimsOutput = z.infer<typeof ExtractedClaimsSchema>;

export const ExtractedOutcomesSchema = z.object({
  outcomes: z.array(
    z.object({
      code: z
        .string()
        .nullable()
        .describe('Outcome code exactly as written in the document; null if the document gives no code. Never invented.'),
      text: z.string().describe('The textual standard/outcome description'),
      grade: z.number(),
    })
  ),
});

export type ExtractedOutcomesOutput = z.infer<typeof ExtractedOutcomesSchema>;

export const ThematicPlanRowSchema = z.object({
  topic: z.string(),
  outcomeCodes: z.array(z.string()),
  plannedHours: z.number().min(1),
  weekNumber: z.number().min(1),
  plannedDates: z.string(),
  hasAssessment: z.boolean(),
  assessmentType: z.enum(['diagnostic', 'formative', 'summative']).optional(),
});

export const ThematicPlanOutputSchema = z.object({
  title: z.string(),
  subject: z.string(),
  grade: z.number(),
  weeklyHours: z.number(),
  totalAnnualHours: z.number(),
  rows: z.array(ThematicPlanRowSchema),
});

export const AnswerSheetScanOutputSchema = z.object({
  testId: z.string(),
  variant: z.enum(['A', 'B']),
  studentCode: z.string(),
  answers: z.array(
    z.object({
      itemIndex: z.number(),
      studentAnswer: z.string(),
      confidence: z.number().min(0).max(1),
      aiRubricReasoning: z.string().optional(),
      pointsProposed: z.number().optional(),
    })
  ),
});

export const LegacyReportExtractionOutputSchema = z.object({
  fields: z.record(
    z.string(),
    z.object({
      value: z.any(),
      confidence: z.number().min(0).max(1),
      sourceLocation: z.string().optional(),
    })
  ),
  summaryArmenian: z.string(),
});
