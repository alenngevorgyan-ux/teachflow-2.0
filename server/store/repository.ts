import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  AnswerSheetSubmission,
  ArmenianEvalResult,
  ArmenianEvalTask,
  Assessment,
  CurriculumOutcome,
  FrozenTask,
  LessonPlan,
  MaterialValidationReport,
  MethodRule,
  RegressionRun,
  ReportInstance,
  ReportTemplate,
  SchoolInfo,
  SideBySideReport,
  Source,
  TerminologyGlossaryItem,
  ThematicPlan,
  ThematicPlanRow,
} from '../../shared/types.js';
import {
  DEMO_SCHOOLS,
  DEMO_TEACHERS,
  getDemoAnswerSheets,
  getDemoArmenianEvalTasks,
  getDemoGlossary,
  getDemoOutcomes,
  getDemoReports,
  getDemoReportTemplates,
  getDemoSources,
  getDemoThematicPlans,
} from './demoData.js';

export interface AuditLog {
  id: string;
  timestamp: string;
  providerId: string;
  modelId: string;
  action: string;
  prompt: string;
  output: string;
  latencyMs: number;
}

export interface IRepository {
  // Sources
  getSources(): Source[];
  getSource(id: string): Source | undefined;
  saveSource(source: Source): Source;
  supersedeSource(oldSourceId: string, newSource: Source): { old: Source; current: Source };
  deleteSource(id: string): boolean;

  // Outcomes
  getOutcomes(): CurriculumOutcome[];
  getConfirmedOutcomes(subject: string, grade: number): CurriculumOutcome[];
  saveOutcomes(outcomes: CurriculumOutcome[]): void;
  confirmOutcome(code: string, confirmed: boolean): boolean;
  deleteOutcome(code: string): boolean;

  // Rules
  getRules(): MethodRule[];
  getActiveRules(): MethodRule[];
  saveRule(rule: MethodRule): MethodRule;
  toggleRule(id: string, active: boolean): boolean;
  deleteRule(id: string): boolean;

  // Assessments
  getAssessments(): Assessment[];
  getAssessment(id: string): Assessment | undefined;
  saveAssessment(assessment: Assessment): Assessment;
  updateAssessmentStatus(id: string, status: Assessment['status'], acceptedWarnings?: string[]): boolean;
  deleteAssessment(id: string): boolean;

  // Material Validation Reports
  getValidationReports(): MaterialValidationReport[];
  saveValidationReport(report: MaterialValidationReport): MaterialValidationReport;
  deleteValidationReport(id: string): boolean;

  // Frozen Tasks & Regression
  getFrozenTasks(): FrozenTask[];
  saveFrozenTask(task: FrozenTask): FrozenTask;
  deleteFrozenTask(id: string): boolean;
  getRegressionRuns(): RegressionRun[];
  saveRegressionRun(run: RegressionRun): RegressionRun;

  // Side-by-Side
  getSideBySideReports(): SideBySideReport[];
  saveSideBySideReport(report: SideBySideReport): SideBySideReport;

  // Thematic Plans
  getThematicPlans(schoolId?: string, subject?: string, grade?: number): ThematicPlan[];
  getThematicPlan(id: string): ThematicPlan | undefined;
  saveThematicPlan(plan: ThematicPlan): ThematicPlan;
  updateThematicPlanRow(planId: string, rowId: string, update: Partial<ThematicPlanRow>): ThematicPlan | undefined;
  deleteThematicPlan(id: string): boolean;

  // Lesson Plans
  getLessonPlans(thematicPlanId?: string): LessonPlan[];
  getLessonPlan(id: string): LessonPlan | undefined;
  saveLessonPlan(plan: LessonPlan): LessonPlan;
  deleteLessonPlan(id: string): boolean;

  // Report Templates
  getReportTemplates(): ReportTemplate[];
  getReportTemplate(id: string): ReportTemplate | undefined;
  saveReportTemplate(template: ReportTemplate): ReportTemplate;
  deleteReportTemplate(id: string): boolean;

  // Reports
  getReports(filters?: {
    schoolId?: string;
    authorRole?: string;
    period?: string;
    status?: string;
    templateId?: string;
    subject?: string;
    grade?: number;
  }): ReportInstance[];
  getReport(id: string): ReportInstance | undefined;
  saveReport(report: ReportInstance): ReportInstance;
  updateReportStatus(
    id: string,
    status: ReportInstance['status'],
    comment?: { fieldKey: string; text: string; author: string; role: string }
  ): ReportInstance | undefined;
  consolidateSchoolReport(
    templateId: string,
    schoolId: string,
    academicYear: string,
    period: string,
    subjectGroup: string
  ): ReportInstance;
  deleteReport(id: string): boolean;

  // Answer Sheets
  getAnswerSheets(assessmentId?: string): AnswerSheetSubmission[];
  getAnswerSheet(id: string): AnswerSheetSubmission | undefined;
  saveAnswerSheet(sheet: AnswerSheetSubmission): AnswerSheetSubmission;
  confirmAnswerSheet(id: string): AnswerSheetSubmission | undefined;
  deleteAnswerSheet(id: string): boolean;

  // Glossary
  getGlossary(subject?: string, grade?: number): TerminologyGlossaryItem[];
  saveGlossaryItem(item: TerminologyGlossaryItem): TerminologyGlossaryItem;
  deleteGlossaryItem(id: string): boolean;

  // Armenian Eval
  getArmenianEvalTasks(): ArmenianEvalTask[];
  saveArmenianEvalTask(task: ArmenianEvalTask): ArmenianEvalTask;
  getArmenianEvalResults(): ArmenianEvalResult[];
  saveArmenianEvalResult(res: ArmenianEvalResult): ArmenianEvalResult;
  // category -> "providerId/modelId" the methodologist has chosen as default
  // for that task type, informed by (not automatically overwritten by) eval scores.
  getEvalModelPreferences(): Record<string, string>;
  setEvalModelPreference(category: string, providerModelKey: string): void;

  // Schools & Teachers
  getSchools(): SchoolInfo[];
  getTeachers(): typeof DEMO_TEACHERS;

  // Audit Logs
  logAIInteraction(log: Omit<AuditLog, 'id' | 'timestamp'>): AuditLog;
  getAuditLogs(): AuditLog[];
  clearAuditLogs(): void;

  // Policy calculation
  computePolicyVersion(): string;

  // Export & Wipe & Reset
  exportAllData(): Record<string, unknown>;
  clearNonDemoData(): void;
  clearDemoData(): void;
  resetDemoData(): void;
}

// Vercel serverless functions only allow writes under /tmp; data there does not
// persist across cold starts or separate instances.
const DATA_DIR = process.env.VERCEL
  ? path.join('/tmp', 'teachflow-data')
  : path.resolve(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'teachflow_store.json');

export class JsonFileRepository implements IRepository {
  private sources: Source[] = [];
  private outcomes: CurriculumOutcome[] = [];
  private rules: MethodRule[] = [];
  private assessments: Assessment[] = [];
  private validationReports: MaterialValidationReport[] = [];
  private frozenTasks: FrozenTask[] = [];
  private regressionRuns: RegressionRun[] = [];
  private sideBySideReports: SideBySideReport[] = [];
  private auditLogs: AuditLog[] = [];

  // TeachFlow 3.0 stores
  private thematicPlans: ThematicPlan[] = [];
  private lessonPlans: LessonPlan[] = [];
  private reportTemplates: ReportTemplate[] = [];
  private reports: ReportInstance[] = [];
  private answerSheets: AnswerSheetSubmission[] = [];
  private glossary: TerminologyGlossaryItem[] = [];
  private armenianEvalTasks: ArmenianEvalTask[] = [];
  private armenianEvalResults: ArmenianEvalResult[] = [];
  private evalModelPreferences: Record<string, string> = {};

  constructor() {
    this.loadFromDisk();
    if (this.sources.length === 0 || this.reportTemplates.length === 0) {
      this.seedInitialData();
      this.saveToDisk();
    }
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(STORE_FILE)) {
        const raw = fs.readFileSync(STORE_FILE, 'utf-8');
        const data = JSON.parse(raw);
        this.sources = data.sources || [];
        this.outcomes = data.outcomes || [];
        this.rules = data.rules || [];
        this.assessments = data.assessments || [];
        this.validationReports = data.validationReports || [];
        this.frozenTasks = data.frozenTasks || [];
        this.regressionRuns = data.regressionRuns || [];
        this.sideBySideReports = data.sideBySideReports || [];
        this.auditLogs = data.auditLogs || [];

        // 3.0 stores
        this.thematicPlans = data.thematicPlans || [];
        this.lessonPlans = data.lessonPlans || [];
        this.reportTemplates = data.reportTemplates || [];
        this.reports = data.reports || [];
        this.answerSheets = data.answerSheets || [];
        this.glossary = data.glossary || [];
        this.armenianEvalTasks = data.armenianEvalTasks || [];
        this.armenianEvalResults = data.armenianEvalResults || [];
        this.evalModelPreferences = data.evalModelPreferences || {};
      }
    } catch (err) {
      console.error('Failed to load store from disk, starting with seeded data:', err);
    }
  }

  private saveToDisk(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const data = {
        sources: this.sources,
        outcomes: this.outcomes,
        rules: this.rules,
        assessments: this.assessments,
        validationReports: this.validationReports,
        frozenTasks: this.frozenTasks,
        regressionRuns: this.regressionRuns,
        sideBySideReports: this.sideBySideReports,
        auditLogs: this.auditLogs,
        thematicPlans: this.thematicPlans,
        lessonPlans: this.lessonPlans,
        reportTemplates: this.reportTemplates,
        reports: this.reports,
        answerSheets: this.answerSheets,
        glossary: this.glossary,
        armenianEvalTasks: this.armenianEvalTasks,
        armenianEvalResults: this.armenianEvalResults,
        evalModelPreferences: this.evalModelPreferences,
      };
      fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to persist store to disk:', err);
    }
  }

  public computePolicyVersion(): string {
    const activeRules = this.rules
      .filter((r) => r.active)
      .map((r) => `${r.id}:${r.kind}:${JSON.stringify(r.params)}`)
      .sort()
      .join('|');
    const activeSourceVersions = this.sources
      .filter((s) => s.status === 'active')
      .map((s) => `${s.id}:${s.version}`)
      .sort()
      .join('|');
    const promptVersions = 'cov:v1|gen:v1|claim:v1|lang:v1|rule:v1|eq:v1';
    const raw = `${activeRules}#${activeSourceVersions}#${promptVersions}`;
    return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 16);
  }

  private seedInitialData(): void {
    this.sources = getDemoSources();
    this.outcomes = getDemoOutcomes();

    // Default pedagogical and methodological rules
    this.rules = [
      {
        id: 'rule-single-correct-answer',
        title: 'Միակ ճշգրիտ պատասխանի պահանջ',
        description: 'Մեկ ընտրությամբ հարցերում ճիշտ պատասխանը պետք է լինի միակը և միանշանակ:',
        kind: 'deterministic',
        params: { minOptions: 3, maxOptions: 5 },
        severity: 'error',
        active: true,
      },
      {
        id: 'rule-no-double-negation',
        title: 'Երկակի ժխտման արգելք',
        description: 'Հարցի ձևակերպման մեջ արգելվում է օգտագործել երկակի ժխտումներ (օրինակ՝ «չի հանդիսանում ոչ...»):',
        kind: 'llm_judged',
        params: { forbidPhrases: ['չի հանդիսանում ոչ', 'չի կարելի չ'] },
        severity: 'error',
        active: true,
      },
      {
        id: 'rule-factual-grounding',
        title: 'Փաստացի մեջբերման պարտադիր պահանջ',
        description: 'Յուրաքանչյուր առաջադրանք պետք է հղում ունենա հաստատված FACT աղբյուրի կոնկրետ հատվածին:',
        kind: 'deterministic',
        params: { minCitations: 1 },
        severity: 'error',
        active: true,
      },
      {
        id: 'rule-balanced-difficulty',
        title: 'Բարդության մակարդակների բաշխվածություն',
        description: 'Տարբերակ A-ի և B-ի առաջադրանքների բարդությունները պետք է լինեն համարժեք:',
        kind: 'llm_judged',
        params: { checkEquivalence: true },
        severity: 'warning',
        active: true,
      },
      {
        id: 'rule-armenian-terminology',
        title: 'Տերմինացանկով հաստատված տերմինաբանության կիրառում',
        description: 'Առաջադրանքներում արգելվում են օտարաբանությունները կամ չհաստատված տերմինները:',
        kind: 'llm_judged',
        params: { dictionary: 'official_armenian' },
        severity: 'warning',
        active: true,
      },
    ];

    // Seeded frozen tasks for regression testing
    this.frozenTasks = [
      {
        id: 'task-photosynthesis-gen',
        subject: 'Բնագիտություն',
        grade: 5,
        topic: 'Լուսասինթեզի ընթացքը և թթվածնի առաջացումը',
        sourceIds: ['demo-source-fact-01'],
        expectedOutcome: 'generate',
        description: 'Լուսասինթեզի թեման առկա է աղբյուրում, պետք է հաջողությամբ գեներացվեն առաջադրանքներ:',
      },
      {
        id: 'task-quantum-refuse',
        subject: 'Բնագիտություն',
        grade: 5,
        topic: 'Քվանտային մեխանիկա և ֆոտոէֆեկտ',
        sourceIds: ['demo-source-fact-01'],
        expectedOutcome: 'refuse',
        description: 'Քվանտային մեխանիկայի թեման բացակայում է 5-րդ դասարանի աղբյուրներում, համակարգը պետք է մերժի:',
      },
      {
        id: 'task-tigran-gen',
        subject: 'Հայոց պատմություն',
        grade: 7,
        topic: 'Տիգրան Բ Մեծի գահակալությունը և Տիգրանակերտի հիմնադրումը',
        sourceIds: ['demo-source-history-01'],
        expectedOutcome: 'generate',
        description: 'Տիգրան Մեծի և Տիգրանակերտի թեմաները լիարժեք առկա են 7-րդ դասարանի դասագրքում:',
      },
    ];

    this.thematicPlans = getDemoThematicPlans();
    this.reportTemplates = getDemoReportTemplates();
    this.reports = getDemoReports();
    this.answerSheets = getDemoAnswerSheets();
    this.glossary = getDemoGlossary();
    this.armenianEvalTasks = getDemoArmenianEvalTasks();
  }

  // --- Sources ---
  getSources(): Source[] {
    return [...this.sources];
  }

  getSource(id: string): Source | undefined {
    return this.sources.find((s) => s.id === id);
  }

  saveSource(source: Source): Source {
    const existingIndex = this.sources.findIndex((s) => s.id === source.id);
    if (existingIndex >= 0) {
      this.sources[existingIndex] = source;
    } else {
      this.sources.push(source);
    }
    this.saveToDisk();
    return source;
  }

  supersedeSource(oldSourceId: string, newSource: Source): { old: Source; current: Source } {
    const oldSource = this.sources.find((s) => s.id === oldSourceId);
    if (!oldSource) {
      throw new Error(`Old source ${oldSourceId} not found`);
    }
    oldSource.status = 'superseded';
    oldSource.effectiveTo = new Date().toISOString();

    newSource.status = 'active';
    this.sources.push(newSource);
    this.saveToDisk();

    return { old: oldSource, current: newSource };
  }

  deleteSource(id: string): boolean {
    const idx = this.sources.findIndex((s) => s.id === id);
    if (idx >= 0) {
      this.sources.splice(idx, 1);
      this.saveToDisk();
      return true;
    }
    return false;
  }

  // --- Outcomes ---
  getOutcomes(): CurriculumOutcome[] {
    return [...this.outcomes];
  }

  getConfirmedOutcomes(subject: string, grade: number): CurriculumOutcome[] {
    return this.outcomes.filter(
      (o) => o.subject === subject && o.grade === grade && o.confirmed
    );
  }

  saveOutcomes(outcomes: CurriculumOutcome[]): void {
    for (const o of outcomes) {
      const idx = this.outcomes.findIndex((existing) => existing.code === o.code);
      if (idx >= 0) {
        this.outcomes[idx] = o;
      } else {
        this.outcomes.push(o);
      }
    }
    this.saveToDisk();
  }

  confirmOutcome(code: string, confirmed: boolean): boolean {
    const outcome = this.outcomes.find((o) => o.code === code);
    if (outcome) {
      outcome.confirmed = confirmed;
      this.saveToDisk();
      return true;
    }
    return false;
  }

  deleteOutcome(code: string): boolean {
    const idx = this.outcomes.findIndex((o) => o.code === code);
    if (idx >= 0) {
      this.outcomes.splice(idx, 1);
      this.saveToDisk();
      return true;
    }
    return false;
  }

  // --- Rules ---
  getRules(): MethodRule[] {
    return [...this.rules];
  }

  getActiveRules(): MethodRule[] {
    return this.rules.filter((r) => r.active);
  }

  saveRule(rule: MethodRule): MethodRule {
    const idx = this.rules.findIndex((r) => r.id === rule.id);
    if (idx >= 0) {
      this.rules[idx] = rule;
    } else {
      this.rules.push(rule);
    }
    this.saveToDisk();
    return rule;
  }

  toggleRule(id: string, active: boolean): boolean {
    const rule = this.rules.find((r) => r.id === id);
    if (rule) {
      rule.active = active;
      this.saveToDisk();
      return true;
    }
    return false;
  }

  deleteRule(id: string): boolean {
    const idx = this.rules.findIndex((r) => r.id === id);
    if (idx >= 0) {
      this.rules.splice(idx, 1);
      this.saveToDisk();
      return true;
    }
    return false;
  }

  // --- Assessments ---
  getAssessments(): Assessment[] {
    return [...this.assessments];
  }

  getAssessment(id: string): Assessment | undefined {
    return this.assessments.find((a) => a.id === id);
  }

  saveAssessment(assessment: Assessment): Assessment {
    const idx = this.assessments.findIndex((a) => a.id === assessment.id);
    if (idx >= 0) {
      this.assessments[idx] = assessment;
    } else {
      this.assessments.unshift(assessment);
    }
    this.saveToDisk();
    return assessment;
  }

  updateAssessmentStatus(id: string, status: Assessment['status'], acceptedWarnings?: string[]): boolean {
    const asm = this.assessments.find((a) => a.id === id);
    if (asm) {
      asm.status = status;
      if (acceptedWarnings) {
        asm.acceptedWarnings = acceptedWarnings;
      }
      this.saveToDisk();
      return true;
    }
    return false;
  }

  deleteAssessment(id: string): boolean {
    const idx = this.assessments.findIndex((a) => a.id === id);
    if (idx >= 0) {
      this.assessments.splice(idx, 1);
      this.saveToDisk();
      return true;
    }
    return false;
  }

  // --- Material Validation Reports ---
  getValidationReports(): MaterialValidationReport[] {
    return [...this.validationReports];
  }

  saveValidationReport(report: MaterialValidationReport): MaterialValidationReport {
    const idx = this.validationReports.findIndex((r) => r.id === report.id);
    if (idx >= 0) {
      this.validationReports[idx] = report;
    } else {
      this.validationReports.unshift(report);
    }
    this.saveToDisk();
    return report;
  }

  deleteValidationReport(id: string): boolean {
    const idx = this.validationReports.findIndex((r) => r.id === id);
    if (idx >= 0) {
      this.validationReports.splice(idx, 1);
      this.saveToDisk();
      return true;
    }
    return false;
  }

  // --- Frozen Tasks & Regression ---
  getFrozenTasks(): FrozenTask[] {
    return [...this.frozenTasks];
  }

  saveFrozenTask(task: FrozenTask): FrozenTask {
    const idx = this.frozenTasks.findIndex((t) => t.id === task.id);
    if (idx >= 0) {
      this.frozenTasks[idx] = task;
    } else {
      this.frozenTasks.push(task);
    }
    this.saveToDisk();
    return task;
  }

  deleteFrozenTask(id: string): boolean {
    const idx = this.frozenTasks.findIndex((t) => t.id === id);
    if (idx >= 0) {
      this.frozenTasks.splice(idx, 1);
      this.saveToDisk();
      return true;
    }
    return false;
  }

  getRegressionRuns(): RegressionRun[] {
    return [...this.regressionRuns];
  }

  saveRegressionRun(run: RegressionRun): RegressionRun {
    this.regressionRuns.unshift(run);
    if (this.regressionRuns.length > 50) {
      this.regressionRuns = this.regressionRuns.slice(0, 50);
    }
    this.saveToDisk();
    return run;
  }

  // --- Side-by-Side ---
  getSideBySideReports(): SideBySideReport[] {
    return [...this.sideBySideReports];
  }

  saveSideBySideReport(report: SideBySideReport): SideBySideReport {
    this.sideBySideReports.unshift(report);
    if (this.sideBySideReports.length > 50) {
      this.sideBySideReports = this.sideBySideReports.slice(0, 50);
    }
    this.saveToDisk();
    return report;
  }

  // --- Thematic Plans ---
  getThematicPlans(schoolId?: string, subject?: string, grade?: number): ThematicPlan[] {
    return this.thematicPlans.filter((p) => {
      if (schoolId && p.schoolId !== schoolId) return false;
      if (subject && p.subject !== subject) return false;
      if (grade !== undefined && p.grade !== grade) return false;
      return true;
    });
  }

  getThematicPlan(id: string): ThematicPlan | undefined {
    return this.thematicPlans.find((p) => p.id === id);
  }

  saveThematicPlan(plan: ThematicPlan): ThematicPlan {
    const idx = this.thematicPlans.findIndex((p) => p.id === plan.id);
    if (idx >= 0) {
      this.thematicPlans[idx] = plan;
    } else {
      this.thematicPlans.unshift(plan);
    }
    this.saveToDisk();
    return plan;
  }

  updateThematicPlanRow(planId: string, rowId: string, update: Partial<ThematicPlanRow>): ThematicPlan | undefined {
    const plan = this.thematicPlans.find((p) => p.id === planId);
    if (!plan) return undefined;
    const row = plan.rows.find((r) => r.id === rowId);
    if (!row) return undefined;

    Object.assign(row, update);
    plan.updatedAt = new Date().toISOString();
    this.saveToDisk();
    return plan;
  }

  deleteThematicPlan(id: string): boolean {
    const idx = this.thematicPlans.findIndex((p) => p.id === id);
    if (idx >= 0) {
      this.thematicPlans.splice(idx, 1);
      this.saveToDisk();
      return true;
    }
    return false;
  }

  // --- Lesson Plans ---
  getLessonPlans(thematicPlanId?: string): LessonPlan[] {
    if (thematicPlanId) {
      return this.lessonPlans.filter((p) => p.thematicPlanId === thematicPlanId);
    }
    return [...this.lessonPlans];
  }

  getLessonPlan(id: string): LessonPlan | undefined {
    return this.lessonPlans.find((p) => p.id === id);
  }

  saveLessonPlan(plan: LessonPlan): LessonPlan {
    const idx = this.lessonPlans.findIndex((p) => p.id === plan.id);
    if (idx >= 0) {
      this.lessonPlans[idx] = plan;
    } else {
      this.lessonPlans.unshift(plan);
    }
    this.saveToDisk();
    return plan;
  }

  deleteLessonPlan(id: string): boolean {
    const idx = this.lessonPlans.findIndex((p) => p.id === id);
    if (idx >= 0) {
      this.lessonPlans.splice(idx, 1);
      this.saveToDisk();
      return true;
    }
    return false;
  }

  // --- Report Templates ---
  getReportTemplates(): ReportTemplate[] {
    return [...this.reportTemplates];
  }

  getReportTemplate(id: string): ReportTemplate | undefined {
    return this.reportTemplates.find((t) => t.id === id);
  }

  saveReportTemplate(template: ReportTemplate): ReportTemplate {
    const idx = this.reportTemplates.findIndex((t) => t.id === template.id);
    if (idx >= 0) {
      this.reportTemplates[idx] = template;
    } else {
      this.reportTemplates.push(template);
    }
    this.saveToDisk();
    return template;
  }

  deleteReportTemplate(id: string): boolean {
    const idx = this.reportTemplates.findIndex((t) => t.id === id);
    if (idx >= 0) {
      this.reportTemplates.splice(idx, 1);
      this.saveToDisk();
      return true;
    }
    return false;
  }

  // --- Reports ---
  getReports(filters?: {
    schoolId?: string;
    authorRole?: string;
    period?: string;
    status?: string;
    templateId?: string;
    subject?: string;
    grade?: number;
  }): ReportInstance[] {
    return this.reports.filter((r) => {
      if (filters?.schoolId && r.schoolId !== filters.schoolId) return false;
      if (filters?.authorRole && r.authorRole !== filters.authorRole) return false;
      if (filters?.period && r.period !== filters.period) return false;
      if (filters?.status && r.status !== filters.status) return false;
      if (filters?.templateId && r.templateId !== filters.templateId) return false;
      if (filters?.subject && r.subject !== filters.subject) return false;
      if (filters?.grade !== undefined && r.grade !== filters.grade) return false;
      return true;
    });
  }

  getReport(id: string): ReportInstance | undefined {
    return this.reports.find((r) => r.id === id);
  }

  saveReport(report: ReportInstance): ReportInstance {
    const idx = this.reports.findIndex((r) => r.id === report.id);
    if (idx >= 0) {
      this.reports[idx] = report;
    } else {
      this.reports.unshift(report);
    }

    // Check if child report changed, mark parent as stale
    if (report.parentReportId) {
      const parent = this.reports.find((p) => p.id === report.parentReportId);
      if (parent) {
        parent.isStale = true;
      }
    }

    this.saveToDisk();
    return report;
  }

  updateReportStatus(
    id: string,
    status: ReportInstance['status'],
    comment?: { fieldKey: string; text: string; author: string; role: string }
  ): ReportInstance | undefined {
    const rep = this.reports.find((r) => r.id === id);
    if (!rep) return undefined;

    rep.status = status;
    rep.updatedAt = new Date().toISOString();

    if (comment) {
      rep.comments.push({
        id: `comm-${Date.now()}`,
        fieldKey: comment.fieldKey,
        text: comment.text,
        author: comment.author,
        role: comment.role,
        date: new Date().toISOString(),
      });
    }

    rep.timeline.push({
      action: status,
      actor: comment?.author || 'Օգտատեր',
      timestamp: new Date().toISOString(),
      note: comment?.text,
    });

    this.saveToDisk();
    return rep;
  }

  consolidateSchoolReport(
    templateId: string,
    schoolId: string,
    academicYear: string,
    period: string,
    subjectGroup: string
  ): ReportInstance {
    const school = DEMO_SCHOOLS.find((s) => s.id === schoolId) || DEMO_SCHOOLS[0];
    const template = this.getReportTemplate(templateId) || this.getReportTemplates()[2];

    // Find accepted child reports from this school
    const childReports = this.reports.filter(
      (r) =>
        r.schoolId === schoolId &&
        r.academicYear === academicYear &&
        (r.status === 'accepted_by_director' || r.status === 'included_in_school_report')
    );

    const totalPlannedHours = childReports.reduce((acc, c) => acc + Number(c.data.plannedHours || 0), 0);
    const totalActualHours = childReports.reduce((acc, c) => acc + Number(c.data.actualHours || 0), 0);
    const teachersCount = childReports.length || 1;
    const averageCompletion =
      totalPlannedHours > 0 ? Math.round((totalActualHours / totalPlannedHours) * 100) : 100;

    const reportId = `rep-school-${schoolId}-${Date.now().toString(36)}`;
    const consolidated: ReportInstance = {
      id: reportId,
      templateId: template.id,
      templateVersion: template.version,
      title: `${school.name} — Ամփոփ հաշվետվություն (${subjectGroup})`,
      schoolId: school.id,
      schoolName: school.name,
      authorRole: 'director',
      authorName: `Տնօրեն / Փոխտնօրեն (${school.name})`,
      subject: subjectGroup,
      grade: 7,
      period: period as any,
      academicYear,
      status: 'submitted_to_reviewer',
      childReportIds: childReports.map((c) => c.id),
      data: {
        subjectGroup,
        teachersCount,
        totalPlannedHours,
        totalActualHours,
        averageCompletion,
        methodologicalWorkSummary: `Հաշվետվությունն ավտոմատ ագրեգացվել է ${teachersCount} ուսուցիչների կողմից ներկայացված և հաստատված տվյալներից:`,
        identifiedDifficulties: 'Ոչ էական շեղումներ:',
        recommendations: 'Շարունակել ծրագրային ժամանակացույցի պահպանումը:',
      },
      comments: [],
      timeline: [
        {
          action: 'consolidated',
          actor: 'Տնօրեն',
          timestamp: new Date().toISOString(),
          note: `Ամփոփված է ${teachersCount} հաշվետվություն`,
        },
      ],
      dataSnapshotHash: `hash-consol-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Mark children as included
    for (const child of childReports) {
      child.status = 'included_in_school_report';
      child.parentReportId = consolidated.id;
    }

    this.saveReport(consolidated);
    return consolidated;
  }

  deleteReport(id: string): boolean {
    const idx = this.reports.findIndex((r) => r.id === id);
    if (idx >= 0) {
      this.reports.splice(idx, 1);
      this.saveToDisk();
      return true;
    }
    return false;
  }

  // --- Answer Sheets ---
  getAnswerSheets(assessmentId?: string): AnswerSheetSubmission[] {
    if (assessmentId) {
      return this.answerSheets.filter((s) => s.assessmentId === assessmentId);
    }
    return [...this.answerSheets];
  }

  getAnswerSheet(id: string): AnswerSheetSubmission | undefined {
    return this.answerSheets.find((s) => s.id === id);
  }

  saveAnswerSheet(sheet: AnswerSheetSubmission): AnswerSheetSubmission {
    const idx = this.answerSheets.findIndex((s) => s.id === sheet.id);
    if (idx >= 0) {
      this.answerSheets[idx] = sheet;
    } else {
      this.answerSheets.unshift(sheet);
    }
    this.saveToDisk();
    return sheet;
  }

  confirmAnswerSheet(id: string): AnswerSheetSubmission | undefined {
    const sheet = this.answerSheets.find((s) => s.id === id);
    if (!sheet) return undefined;

    sheet.status = 'confirmed';
    // Zero-retention: delete original image immediately upon confirmation
    delete sheet.imageUrl;
    this.saveToDisk();
    return sheet;
  }

  deleteAnswerSheet(id: string): boolean {
    const idx = this.answerSheets.findIndex((s) => s.id === id);
    if (idx >= 0) {
      this.answerSheets.splice(idx, 1);
      this.saveToDisk();
      return true;
    }
    return false;
  }

  // --- Glossary ---
  getGlossary(subject?: string, grade?: number): TerminologyGlossaryItem[] {
    return this.glossary.filter((item) => {
      if (subject && item.subject !== subject) return false;
      if (grade !== undefined && !item.grades.includes(grade)) return false;
      return true;
    });
  }

  saveGlossaryItem(item: TerminologyGlossaryItem): TerminologyGlossaryItem {
    const idx = this.glossary.findIndex((g) => g.id === item.id);
    if (idx >= 0) {
      this.glossary[idx] = item;
    } else {
      this.glossary.unshift(item);
    }
    this.saveToDisk();
    return item;
  }

  deleteGlossaryItem(id: string): boolean {
    const idx = this.glossary.findIndex((g) => g.id === id);
    if (idx >= 0) {
      this.glossary.splice(idx, 1);
      this.saveToDisk();
      return true;
    }
    return false;
  }

  // --- Armenian Eval ---
  getArmenianEvalTasks(): ArmenianEvalTask[] {
    return [...this.armenianEvalTasks];
  }

  saveArmenianEvalTask(task: ArmenianEvalTask): ArmenianEvalTask {
    const idx = this.armenianEvalTasks.findIndex((t) => t.id === task.id);
    if (idx >= 0) {
      this.armenianEvalTasks[idx] = task;
    } else {
      this.armenianEvalTasks.push(task);
    }
    this.saveToDisk();
    return task;
  }

  getArmenianEvalResults(): ArmenianEvalResult[] {
    return [...this.armenianEvalResults];
  }

  saveArmenianEvalResult(res: ArmenianEvalResult): ArmenianEvalResult {
    this.armenianEvalResults.unshift(res);
    if (this.armenianEvalResults.length > 50) {
      this.armenianEvalResults = this.armenianEvalResults.slice(0, 50);
    }
    this.saveToDisk();
    return res;
  }

  getEvalModelPreferences(): Record<string, string> {
    return { ...this.evalModelPreferences };
  }

  setEvalModelPreference(category: string, providerModelKey: string): void {
    this.evalModelPreferences[category] = providerModelKey;
    this.saveToDisk();
  }

  // --- Schools & Teachers ---
  getSchools(): SchoolInfo[] {
    return DEMO_SCHOOLS;
  }

  getTeachers(): typeof DEMO_TEACHERS {
    return DEMO_TEACHERS;
  }

  // --- Audit Logs ---
  logAIInteraction(log: Omit<AuditLog, 'id' | 'timestamp'>): AuditLog {
    const fullLog: AuditLog = {
      ...log,
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
    };
    this.auditLogs.unshift(fullLog);
    if (this.auditLogs.length > 200) {
      this.auditLogs = this.auditLogs.slice(0, 200);
    }
    this.saveToDisk();
    return fullLog;
  }

  getAuditLogs(): AuditLog[] {
    return [...this.auditLogs];
  }

  clearAuditLogs(): void {
    this.auditLogs = [];
    this.saveToDisk();
  }

  // --- Export & Wipe & Reset ---
  exportAllData(): Record<string, unknown> {
    return {
      exportedAt: new Date().toISOString(),
      policyVersion: this.computePolicyVersion(),
      sources: this.sources,
      outcomes: this.outcomes,
      rules: this.rules,
      assessments: this.assessments,
      thematicPlans: this.thematicPlans,
      lessonPlans: this.lessonPlans,
      reportTemplates: this.reportTemplates,
      reports: this.reports,
      answerSheets: this.answerSheets,
      glossary: this.glossary,
      validationReports: this.validationReports,
      frozenTasks: this.frozenTasks,
      regressionRuns: this.regressionRuns,
      sideBySideReports: this.sideBySideReports,
      auditLogs: this.auditLogs,
    };
  }

  clearNonDemoData(): void {
    this.sources = this.sources.filter((s) => s.isDemo);
    this.assessments = [];
    this.validationReports = [];
    this.regressionRuns = [];
    this.sideBySideReports = [];
    this.auditLogs = [];
    this.saveToDisk();
  }

  clearDemoData(): void {
    this.thematicPlans = [];
    this.lessonPlans = [];
    this.reports = [];
    this.answerSheets = [];
    this.assessments = [];
    this.validationReports = [];
    this.saveToDisk();
  }

  resetDemoData(): void {
    this.seedInitialData();
    this.saveToDisk();
  }
}

export const repository = new JsonFileRepository();
