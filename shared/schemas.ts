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
      code: z.string().describe('Official outcome or standard code, e.g., ԲՆ-5-1'),
      text: z.string().describe('The textual standard/outcome description'),
      grade: z.number(),
    })
  ),
});

export type ExtractedOutcomesOutput = z.infer<typeof ExtractedOutcomesSchema>;
