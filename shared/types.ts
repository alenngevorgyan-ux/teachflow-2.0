export type SourceRole = 'FACT' | 'METHOD' | 'TEMPLATE';
export type SourceStatus = 'active' | 'superseded' | 'draft';
export type DocType = 'standard' | 'subject_program' | 'textbook' | 'methodological_guide' | 'assessment_template' | 'other';
export type UserRole = 'methodologist' | 'teacher' | 'evaluator';
export type Language = 'hy' | 'ru' | 'en';

export interface SourceChunk {
  id: string; // stable: `${sourceId}#p${page}#c${n}`
  sourceId: string;
  page?: number;
  text: string;
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
}

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
}

export interface ItemTrace {
  itemId: string;
  factSources: { sourceId: string; version: string; chunkId: string; page?: number }[];
  methodRulesApplied: string[];
  templateId?: string;
  providerId: string;
  modelId: string;
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
  unsupportedClaimsCount: number;
  correctRefusal: boolean;
  methodUsedAsFactCount: number;
  itemsWithoutVerifiableQuote: number;
  variantEquivalencePassed: boolean;
  machineReadableTrace: boolean;
  internalViolationsCaught: number;
  validatorViolationsCaught: number;
  latencyMs: number;
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
  baselineRuns: ScorecardMetric[];
  teachflowRuns: ScorecardMetric[];
  aggregated: {
    baseline: {
      avgUnsupportedClaims: number;
      refusalCorrectnessRate: number;
      methodAsFactRate: number;
      unverifiableQuoteRate: number;
      equivalencePassRate: number;
      stabilityAcrossRuns: number; // 0-1
      avgLatencyMs: number;
    };
    teachflow: {
      avgUnsupportedClaims: number;
      refusalCorrectnessRate: number;
      methodAsFactRate: number;
      unverifiableQuoteRate: number;
      equivalencePassRate: number;
      stabilityAcrossRuns: number; // 0-1
      avgLatencyMs: number;
    };
  };
}
