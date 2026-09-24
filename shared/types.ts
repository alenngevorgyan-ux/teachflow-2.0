export type SourceRole = 'FACT' | 'METHOD' | 'TEMPLATE';
export type SourceStatus = 'active' | 'superseded' | 'draft';
export type DocType = 'standard' | 'subject_program' | 'textbook' | 'methodological_guide' | 'assessment_template' | 'other';
export type UserRole = 'teacher' | 'director' | 'methodologist' | 'reviewer' | 'admin' | 'evaluator';
export type Role = UserRole;
export type Language = 'hy' | 'ru' | 'en';

export interface SourceChunk {
  id: string; // stable: `${sourceId}#p${page}#c${n}`
  sourceId: string;
  page?: number;
  text: string;
  // Gemini embedding vector (gemini-embedding-001), computed at upload time.
  // Absent when GEMINI_API_KEY was not configured or the embedding call
  // failed — retrieval falls back to keyword-only scoring for that chunk.
  embedding?: number[];
  // true if this chunk's text came from Gemini OCR of a scanned PDF page
  // rather than the file's own text layer.
  ocr?: boolean;
}

export interface Source {
  id: string;
  title: string;
  authority: string; // who issued/approved it, as entered by methodologist
  docType: DocType;
  subject: string;
  grades: number[];
  role: SourceRole;
  version: string;
  effectiveFrom: string; // ISO date
  effectiveTo?: string;
  status: SourceStatus;
  sha256: string; // hash of original uploaded file
  isDemo: boolean; // true for seeded sample data
  uploadedAt: string;
  ocr?: boolean;
  chunks: SourceChunk[];
  /**
   * Set when a person confirmed this source for use in content checks.
   * Absent on every source stored before confirmation existed: those stay
   * unconfirmed. Valid only while the version and content hash still match
   * (see server/pipeline/sourceConfirmation.ts).
   */
  confirmation?: SourceConfirmation;
}

export interface SourceConfirmation {
  /**
   * The name the person typed when confirming. There is no authentication
   * yet, so this is a stated name, not a verified identity.
   */
  confirmedByName: string;
  confirmedAt: string;
  /** Source version that was confirmed. */
  version: string;
  /** sourceContentHash() at confirmation: text and significant metadata. */
  contentHash: string;
}

export type SourceConfirmationState = 'unconfirmed' | 'confirmed' | 'invalidated' | 'not_confirmable';

export interface CurriculumOutcome {
  code: string; // outcome/standard code as written in the official document
  text: string;
  subject: string;
  grade: number;
  standardVersion: string;
  sourceId: string; // the standard/program it came from
  confirmed: boolean; // true if approved by methodologist
}

export interface MethodRule {
  id: string;
  title: string;
  description: string;
  kind: 'deterministic' | 'llm_judged';
  params: Record<string, unknown>;
  severity: 'error' | 'warning';
  sourceId?: string; // METHOD source this rule was derived from
  active: boolean;
}

export interface AssessmentItem {
  id: string;
  variant: 'A' | 'B';
  type: 'single_choice' | 'multiple_choice' | 'short_answer' | 'open';
  stem: string;
  options?: string[];
  answerKey: string | string[];
  outcomeCodes: string[];
  difficulty: 'basic' | 'medium' | 'advanced';
  citations: { chunkId: string; quote: string }[]; // quote must be verbatim from the chunk
}

export interface CheckResult {
  checkId: string;
  label: string;
  kind: 'deterministic' | 'llm_judged';
  result: 'pass' | 'warn' | 'fail';
  detail: string;
  judgeProviderId?: string;
  judgeModelId?: string;
  confidence?: number;
}

export interface ItemTrace {
  itemId: string;
  factSources: { sourceId: string; version: string; chunkId: string; page?: number }[];
  methodRulesApplied: string[];
  templateId?: string;
  providerId: string;
  modelId: string;
  judgeProviderId?: string;
  judgeModelId?: string;
  confidence?: number;
  policyVersion: string;
  generatedAt: string;
  checks: CheckResult[];
  status: 'PASS' | 'WARN' | 'FAIL';
  rawPrompt?: string;
  rawOutput?: string;
}

export interface Assessment {
  id: string;
  subject: string;
  grade: number;
  topic: string;
  selectedSourceIds: string[];
  status: 'refused' | 'draft' | 'validated' | 'ready_for_classroom';
  refusalReason?: string;
  coverage: {
    topicCovered: boolean;
    coveredOutcomeCodes: string[];
    missingAspects: string[];
  };
  items: AssessmentItem[];
  traces: ItemTrace[];
  variantEquivalence: CheckResult[];
  createdAt: string;
  policyVersion: string;
  // Item ids with WARN status that a teacher has explicitly reviewed and accepted
  // before moving the assessment to ready_for_classroom. Set only by the server,
  // once every WARN item is covered — see POST /assessments/:id/status.
  acceptedWarnings?: string[];
}

export interface MaterialValidationReport {
  id: string;
  subject: string;
  grade: number;
  analyzedAt: string;
  policyVersion: string;
  totalClaims: number;
  unsupportedClaimsCount: number;
  outOfScopeClaimsCount: number;
  ruleViolationsCount: number;
  claims: {
    id: string;
    originalText: string;
    matchedChunkId?: string;
    matchedSourceTitle?: string;
    supportStatus: 'supported' | 'partially_supported' | 'not_supported';
    reason: string;
    gradeAppropriate: boolean;
    checks: CheckResult[];
  }[];
}

export interface FrozenTask {
  id: string;
  subject: string;
  grade: number;
  topic: string;
  sourceIds: string[];
  expectedOutcome: 'generate' | 'refuse';
  description: string;
}

export interface RegressionRun {
  id: string;
  runDate: string;
  providerId: string;
  modelId: string;
  policyVersion: string;
  results: {
    taskId: string;
    topic: string;
    actualOutcome: 'generate' | 'refuse';
    expectedOutcome: 'generate' | 'refuse';
    correct: boolean;
    unsupportedClaimsCount: number;
    failRate: number;
    ruleViolations: number;
    equivalenceFailures: number;
    latencyMs: number;
  }[];
  summary: {
    totalTasks: number;
    correctCount: number;
    accuracy: number;
    avgLatencyMs: number;
    avgFailRate: number;
  };
}

export interface ScorecardMetric {
  runIndex: number;
  // Set when a model call failed; such a run is excluded from the aggregates.
  error?: string;
  refused?: boolean;
  refusalReason?: string;
  itemsCount?: number;
  unsupportedClaimsCount: number;
  correctRefusal: boolean;
  methodUsedAsFactCount: number;
  itemsWithoutVerifiableQuote: number;
  variantEquivalencePassed: boolean;
  // null when the run produced no items (nothing to trace)
  machineReadableTrace: boolean | null;
  internalViolationsCaught: number;
  validatorViolationsCaught: number;
  latencyMs: number;
  // Baseline only: how each quote was located in the retrieved chunks
  citationResolution?: { verbatim: number; overlap: number; bestFact: number; unresolved: number };
  // Baseline only: quotes the parser returned that are not in the raw output (dropped)
  parserDroppedQuotes?: number;
  rawOutput?: string;
}

// null = no successful run to compute from
export interface CompareAggregate {
  validRuns: number;
  errorRuns: number;
  avgUnsupportedClaims: number | null;
  refusalCorrectnessRate: number | null;
  methodAsFactRate: number | null;
  unverifiableQuoteRate: number | null;
  equivalencePassRate: number | null;
  stabilityAcrossRuns: number | null; // 0-1, share of runs agreeing with the majority refusal decision
  machineReadableTraceRate: number | null;
  avgLatencyMs: number | null;
}

export interface SideBySideReport {
  id: string;
  subject: string;
  grade: number;
  topic: string;
  isUncoveredTopicPreset: boolean;
  numberOfRuns: number;
  executedAt: string;
  modelId: string;
  judgeProviderId?: string;
  judgeModelId?: string;
  judgeAgreementRate?: number; // e.g. 0.92 for 92% agreement between Gemini and Jev
  baselineRuns: ScorecardMetric[];
  teachflowRuns: ScorecardMetric[];
  aggregated: {
    baseline: CompareAggregate;
    teachflow: CompareAggregate;
  };
}

export interface PinnedContext {
  subject: string;
  grade: number;
  programVersion: string;
  academicYear: string;
  schoolId: string;
  schoolName?: string;
  term?: number;
}

export interface SchoolInfo {
  id: string;
  name: string;
  region: string;
  teachersCount: number;
  studentsCount: number;
  isDemo: boolean;
}

export interface ThematicPlanRow {
  id: string;
  topic: string;
  outcomeCodes: string[];
  plannedHours: number;
  weekNumber: number;
  plannedDates: string; // e.g. "08.09 - 12.09"
  hasAssessment: boolean;
  assessmentType?: 'diagnostic' | 'formative' | 'summative';
  taught?: boolean;
  actualHours?: number;
  taughtDate?: string;
  teacherNote?: string;
}

export interface ThematicPlan {
  id: string;
  title: string;
  subject: string;
  grade: number;
  programVersion: string;
  academicYear: string;
  schoolId: string;
  schoolName: string;
  teacherName: string;
  weeklyHours: number;
  totalAnnualHours: number;
  programTargetHours: number;
  status: 'draft' | 'approved' | 'submitted';
  rows: ThematicPlanRow[];
  calendar: {
    term1Weeks: number;
    term2Weeks: number;
    holidays: { name: string; dates: string }[];
  };
  validationErrors: string[];
  createdAt: string;
  updatedAt: string;
}

export interface LessonPlan {
  id: string;
  thematicPlanId: string;
  rowId: string;
  subject: string;
  grade: number;
  topic: string;
  durationMinutes: number;
  outcomeCodes: string[];
  objectives: string[];
  requiredMaterials: string[];
  stages: {
    title: string;
    durationMinutes: number;
    teacherActivity: string;
    studentActivity: string;
    formativeCheck: string;
  }[];
  factCitations: { chunkId: string; quote: string; sourceTitle: string }[];
  homework: string;
  createdAt: string;
  trace: LessonPlanTrace;
}

export interface LessonPlanCheck {
  checkId: string;
  label: string;
  kind: 'deterministic' | 'llm_judged';
  result: 'pass' | 'warn' | 'fail';
  detail: string;
  confidence?: number;
}

export interface LessonPlanTrace {
  factSources: { sourceId: string; version: string; chunkId: string; page?: number }[];
  providerId: string;
  modelId: string;
  judgeProviderId?: string;
  judgeModelId?: string;
  policyVersion: string;
  generatedAt: string;
  checks: LessonPlanCheck[];
  status: 'PASS' | 'WARN' | 'FAIL';
}

export interface AnswerSheetSubmission {
  id: string;
  assessmentId: string;
  variant: 'A' | 'B';
  studentCode: string; // anonymous code e.g. "7B-14"
  timestamp: string;
  imageUrl?: string;
  status: 'scanned' | 'scanned_pending_review' | 'confirmed';
  confidenceOverall?: number;
  answers: {
    itemIndex: number;
    itemId: string;
    studentAnswer: string;
    confidence?: number;
    isLowConfidence: boolean;
    pointsAwarded?: number;
    maxPoints?: number;
    isCorrect?: boolean;
    aiRubricReasoning?: string;
    teacherOverridden?: boolean;
    teacherOverrideScore?: number;
    scoreAwarded?: number;
    rubricFeedback?: string;
  }[];
  totalScore: number;
  maxScore: number;
  percent: number;
}

export interface ItemAnalysis {
  itemId: string;
  stem: string;
  variant: 'A' | 'B';
  outcomeCodes: string[];
  difficultyRatio: number; // % correct (0.0 to 1.0)
  discriminationIndex: number;
  distractorStats: Record<string, number>;
  outcomeCoverage: { code: string; masterRate: number }[];
}

export interface LayoutSection {
  id: string;
  title: string;
  fieldKeys: string[];
}

export interface ReportField {
  key: string;
  label: { hy: string; ru: string };
  type: 'text' | 'number' | 'table' | 'date' | 'list';
  source: 'registry' | 'thematic_plan' | 'progress' | 'assessment_aggregate' | 'child_reports' | 'manual';
  binding?: string;
  required: boolean;
  description?: string;
}

export interface ReportRule {
  id: string;
  description: string;
  kind: 'deterministic' | 'llm_judged';
  expression?: string;
  severity: 'error' | 'warning';
}

export interface ReportTemplate {
  id: string;
  name: { hy: string; ru: string; en: string };
  status: 'draft_unconfirmed' | 'confirmed';
  authority?: string;
  legalBasis?: string;
  period: 'term' | 'half_year' | 'year' | 'on_demand';
  authorRole: 'teacher' | 'methodological_unit_head' | 'director';
  recipientRole: 'director' | 'reviewer';
  aggregatesFrom?: string;
  fields: ReportField[];
  validationRules: ReportRule[];
  layout: { docxTemplateId?: string; sections: LayoutSection[] };
  version: string;
}

export interface ReportInstance {
  id: string;
  templateId: string;
  templateVersion: string;
  title: string;
  schoolId: string;
  schoolName: string;
  authorRole: 'teacher' | 'methodological_unit_head' | 'director';
  authorName: string;
  subject: string;
  grade: number | null; // null for school-level reports spanning several grades
  period: 'term' | 'half_year' | 'year' | 'on_demand';
  academicYear: string | null; // null when an imported document does not state it
  status:
    | 'draft'
    | 'submitted_to_director'
    | 'returned_with_comments'
    | 'returned_for_correction'
    | 'accepted_by_director'
    | 'included_in_school_report'
    | 'submitted_to_reviewer'
    | 'reviewed_with_flags'
    | 'accepted_by_reviewer';
  data: Record<string, any>;
  fieldConfidences?: Record<string, number>;
  fieldProvenance?: Record<string, string>;
  comments: { id: string; fieldKey?: string; author?: string; authorName?: string; role?: string; text: string; date?: string; createdAt?: string }[];
  timeline: { action: string; actor: string; timestamp: string; note?: string }[];
  isStale?: boolean;
  parentReportId?: string;
  childReportIds?: string[];
  isLegacyImported?: boolean;
  importedFromLegacy?: boolean;
  legacySourceFile?: string;
  dataSnapshotHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportReviewResult {
  reportId: string;
  status: 'ready' | 'has_errors' | 'has_warnings';
  checks: {
    id: string;
    name: string;
    category: 'completeness' | 'deterministic' | 'registry' | 'source_data' | 'cross_report' | 'anomaly';
    passed: boolean;
    severity: 'error' | 'warning' | 'info';
    detail: string;
    confidence?: number;
    fieldKey?: string;
  }[];
  summaryArmenian: string;
  recommendation: 'accept' | 'return_for_correction';
}

export interface TerminologyGlossaryItem {
  id: string;
  subject: string;
  grades: number[];
  preferredTerm: string;
  forbiddenVariants: string[];
  definition: string;
  sourceReference: string;
  termArmenian?: string;
  termEnglish?: string;
  termRussian?: string;
  preferredStandardVariant?: string;
}

export interface ArmenianEvalTask {
  id: string;
  category: 'orthography' | 'grammar' | 'terminology' | 'ocr_noise' | 'faithful_quoting' | 'answer_key' | 'missing_source_refusal';
  title: string;
  prompt: string;
  contextText?: string;
  expectedBehavior: string;
  goldenReference?: string;
  groundTruthKeywords: string[];
  forbiddenOutputs: string[];
}

export interface ArmenianEvalResult {
  runId: string;
  timestamp: string;
  providerId: string;
  modelId: string;
  categoryScores: Record<string, number>; // 0 - 100
  scoresByCategory?: Record<string, number>; // 0 - 100 alias
  overallScore: number; // 0 - 100
  taskResults: {
    taskId: string;
    category: string;
    passed: boolean;
    score: number;
    modelOutput: string;
    notes: string;
  }[];
}
