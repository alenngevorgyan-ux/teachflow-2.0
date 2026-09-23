import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  Assessment,
  CurriculumOutcome,
  FrozenTask,
  MaterialValidationReport,
  MethodRule,
  RegressionRun,
  SideBySideReport,
  Source,
} from '../../shared/types.js';

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
  updateAssessmentStatus(id: string, status: Assessment['status']): boolean;
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

  // Audit Logs
  logAIInteraction(log: Omit<AuditLog, 'id' | 'timestamp'>): AuditLog;
  getAuditLogs(): AuditLog[];
  clearAuditLogs(): void;

  // Policy calculation
  computePolicyVersion(): string;

  // Export & Wipe
  exportAllData(): Record<string, unknown>;
  clearNonDemoData(): void;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
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

  constructor() {
    this.loadFromDisk();
    if (this.sources.length === 0) {
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
    // Demo FACT source
    const factChunks = [
      {
        id: 'demo-source-fact-01#p1#c1',
        sourceId: 'demo-source-fact-01',
        page: 1,
        text: 'Լուսասինթեզը գործընթաց է, որի ընթացքում կանաչ բույսերը արևի լույսի էներգիայի հաշվին ջրից և ածխաթթու գազից սինթեզում են օրգանական նյութեր (գլյուկոզ) և անջատում են թթվածին: Լուսասինթեզը կատարվում է բույսի կանաչ մասերում՝ քլորոպլաստներում, որոնք պարունակում են քլորոֆիլ պիգմենտը:',
      },
      {
        id: 'demo-source-fact-01#p1#c2',
        sourceId: 'demo-source-fact-01',
        page: 1,
        text: 'Բույսերի արմատները հողից կլանում են ջուր և հանքային աղեր: Տերևները մթնոլորտից կլանում են ածխաթթու գազ հերձանցքերի միջոցով: Լույսի առկայությամբ քլորոֆիլը կլանում է լուսային էներգիան, որը փոխակերպվում է քիմիական էներգիայի:',
      },
      {
        id: 'demo-source-fact-01#p2#c1',
        sourceId: 'demo-source-fact-01',
        page: 2,
        text: 'Լուսասինթեզի արդյունքում առաջացած թթվածինը անջատվում է մթնոլորտ և օգտագործվում է կենդանի օրգանիզմների շնչառության համար: Առաջացած օրգանական նյութերը ծառայում են որպես սնունդ ինչպես բույսի, այնպես էլ այլ օրգանիզմների համար:',
      },
      {
        id: 'demo-source-fact-01#p2#c2',
        sourceId: 'demo-source-fact-01',
        page: 2,
        text: 'Լուսասինթեզի ինտենսիվությունը կախված է լուսավորվածության աստիճանից, շրջակա միջավայրի ջերմաստիճանից, ջրի քանակից և ածխաթթու գազի կոնցենտրացիայից: Օպտիմալ պայմաններում գործընթացը կատարվում է առավել արդյունավետ:',
      },
    ];

    const demoFactSource: Source = {
      id: 'demo-source-fact-01',
      title: 'Բնագիտություն 5-րդ դասարան (Ցուցադրական նմուշ / Demo)',
      authority: 'Ուսումնական նյութերի նմուշային բազա (Demo Repository)',
      docType: 'textbook',
      subject: 'Բնագիտություն',
      grades: [5],
      role: 'FACT',
      version: '1.0-demo',
      effectiveFrom: '2025-01-01',
      status: 'active',
      sha256: crypto.createHash('sha256').update(factChunks.map((c) => c.text).join('')).digest('hex'),
      isDemo: true,
      uploadedAt: new Date().toISOString(),
      chunks: factChunks,
    };

    // Demo METHOD source
    const methodChunks = [
      {
        id: 'demo-source-method-01#p1#c1',
        sourceId: 'demo-source-method-01',
        page: 1,
        text: 'Բնագիտական առարկաների թեստերի կազմման մեթոդական կանոններ. Յուրաքանչյուր հարց պետք է ունենա հստակ, միանշանակ ձևակերպում: Ընտրովի պատասխանով առաջադրանքներում տարբերակների քանակը պետք է լինի առնվազն 3 կամ 4: Բոլոր տարբերակները պետք է լինեն տրամաբանորեն հավանական և համասեռ:',
      },
      {
        id: 'demo-source-method-01#p1#c2',
        sourceId: 'demo-source-method-01',
        page: 1,
        text: 'Արգելվում է օգտագործել երկակի ժխտումներով հարցեր (օրինակ՝ «Ստորև նշվածներից ո՞րը չի հանդիսանում ոչ կենդանի...»): Մեկ ընտրությամբ հարցերում ճիշտ պատասխանը պետք է լինի միակը և անվիճելին: Բարդության մակարդակները (հիմնական, միջին, առաջադեմ) պետք է հավասարաչափ բաշխված լինեն տարբերակների միջև:',
      },
    ];

    const demoMethodSource: Source = {
      id: 'demo-source-method-01',
      title: 'Բնագիտական առարկաների թեստավորման մեթոդական ուղեցույց (Demo Method Guide)',
      authority: 'Մեթոդական նմուշների բազա (Demo Methodology Base)',
      docType: 'methodological_guide',
      subject: 'Բնագիտություն',
      grades: [5],
      role: 'METHOD',
      version: '1.0-demo',
      effectiveFrom: '2025-01-01',
      status: 'active',
      sha256: crypto.createHash('sha256').update(methodChunks.map((c) => c.text).join('')).digest('hex'),
      isDemo: true,
      uploadedAt: new Date().toISOString(),
      chunks: methodChunks,
    };

    this.sources = [demoFactSource, demoMethodSource];

    // Seed confirmed curriculum outcomes
    this.outcomes = [
      {
        code: 'ԲՆ-5-1',
        text: 'Բացատրել լուսասինթեզի գործընթացը և դրա անհրաժեշտ պայմանները (արևի լույս, ջուր, ածխաթթու գազ, քլորոֆիլ):',
        subject: 'Բնագիտություն',
        grade: 5,
        standardVersion: '2025-v1',
        sourceId: 'demo-source-fact-01',
        confirmed: true,
      },
      {
        code: 'ԲՆ-5-2',
        text: 'Նկարագրել լուսասինթեզի արդյունքում թթվածնի անջատման կարևորությունը կենդանի օրգանիզմների շնչառության համար:',
        subject: 'Բնագիտություն',
        grade: 5,
        standardVersion: '2025-v1',
        sourceId: 'demo-source-fact-01',
        confirmed: true,
      },
      {
        code: 'ԲՆ-5-3',
        text: 'Տարբերակել բույսերի օրգանների դերը սննդառության գործընթացում (արմատներ, տերևներ, հերձանցքեր):',
        subject: 'Բնագիտություն',
        grade: 5,
        standardVersion: '2025-v1',
        sourceId: 'demo-source-fact-01',
        confirmed: true,
      },
    ];

    // Seed rules
    this.rules = [
      {
        id: 'rule-require-answer-key',
        title: 'Ճիշտ պատասխանի առկայության պահանջ',
        description: 'Յուրաքանչյուր առաջադրանք պարտադիր պետք է ունենա լրացված և վավեր ճիշտ պատասխան (Answer Key):',
        kind: 'deterministic',
        params: {},
        severity: 'error',
        active: true,
      },
      {
        id: 'rule-single-choice-one-answer',
        title: 'Մեկ ընտրությամբ հարցում միակ ճիշտ պատասխան',
        description: 'Մեկ ընտրությամբ առաջադրանքի ճիշտ պատասխանը պետք է լինի հստակ և համապատասխանի տրված տարբերակներից միայն մեկին:',
        kind: 'deterministic',
        params: {},
        severity: 'error',
        active: true,
      },
      {
        id: 'rule-min-options',
        title: 'Ընտրովի առաջադրանքների տարբերակների նվազագույն քանակ',
        description: 'Ընտրովի առաջադրանքը պետք է ունենա առնվազն 3 տարբերակ:',
        kind: 'deterministic',
        params: { min_options: 3 },
        severity: 'error',
        active: true,
      },
      {
        id: 'rule-max-items',
        title: 'Տարբերակում առաջադրանքների առավելագույն քանակ',
        description: 'Տարբերակը չպետք է գերազանցի սահմանված առաջադրանքների քանակը (կանխադրված 10):',
        kind: 'deterministic',
        params: { max_items: 10 },
        severity: 'warning',
        active: true,
      },
      {
        id: 'rule-allowed-item-types',
        title: 'Թույլատրելի առաջադրանքների տեսակներ',
        description: 'Առաջադրանքների տեսակները պետք է լինեն հաստատված ցանկից (մեկ ընտրություն, բազմակի ընտրություն, կարճ պատասխան, բաց):',
        kind: 'deterministic',
        params: {
          allowed_types: ['single_choice', 'multiple_choice', 'short_answer', 'open'],
        },
        severity: 'error',
        active: true,
      },
      {
        id: 'rule-llm-no-double-negatives',
        title: 'Երկակի ժխտումների և շփոթեցնող ձևակերպումների արգելք',
        description: 'Հարցի ձևակերպման մեջ արգելվում են երկակի ժխտումներ և աշակերտին շփոթեցնող արհեստական թակարդներ:',
        kind: 'llm_judged',
        params: {},
        severity: 'warning',
        sourceId: 'demo-source-method-01',
        active: true,
      },
      {
        id: 'rule-llm-age-appropriate',
        title: 'Տարիքային խմբին համապատասխան բառապաշար',
        description: 'Հարցի լեզուն և տերմինաբանությունը պետք է համապատասխանեն տվյալ դասարանի տարիքային զարգացմանը:',
        kind: 'llm_judged',
        params: {},
        severity: 'warning',
        active: true,
      },
    ];

    // Seed frozen tasks for regression runner
    this.frozenTasks = [
      {
        id: 'task-photo-01',
        subject: 'Բնագիտություն',
        grade: 5,
        topic: 'Լուսասինթեզի ընթացքը և քլորոպլաստների դերը',
        sourceIds: ['demo-source-fact-01'],
        expectedOutcome: 'generate',
        description: 'Թեմա առկա է աղբյուրներում. պետք է հաջողությամբ գեներացվի և անցնի վալիդացիան:',
      },
      {
        id: 'task-quantum-refusal-02',
        subject: 'Բնագիտություն',
        grade: 5,
        topic: 'Քվանտային համակարգիչներ և կիսահաղորդիչներ',
        sourceIds: ['demo-source-fact-01'],
        expectedOutcome: 'refuse',
        description: 'Թեմա, որը լիովին բացակայում է 5-րդ դասարանի աղբյուրներում. համակարգը ՊԵՏՔ Է մերժի:',
      },
      {
        id: 'task-roots-03',
        subject: 'Բնագիտություն',
        grade: 5,
        topic: 'Բույսերի արմատային սննդառություն և ջրի կլանում',
        sourceIds: ['demo-source-fact-01'],
        expectedOutcome: 'generate',
        description: 'Թեմա առկա է աղբյուրներում. պետք է գեներացվեն ստուգված առաջադրանքներ:',
      },
    ];
  }

  // --- Source methods ---
  getSources(): Source[] {
    return [...this.sources];
  }

  getSource(id: string): Source | undefined {
    return this.sources.find((s) => s.id === id);
  }

  saveSource(source: Source): Source {
    const idx = this.sources.findIndex((s) => s.id === source.id);
    if (idx >= 0) {
      this.sources[idx] = source;
    } else {
      this.sources.push(source);
    }
    this.saveToDisk();
    return source;
  }

  supersedeSource(oldSourceId: string, newSource: Source): { old: Source; current: Source } {
    const oldIdx = this.sources.findIndex((s) => s.id === oldSourceId);
    if (oldIdx >= 0) {
      this.sources[oldIdx].status = 'superseded';
      this.sources[oldIdx].effectiveTo = new Date().toISOString();
    }
    this.sources.push(newSource);
    this.saveToDisk();
    return {
      old: this.sources[oldIdx],
      current: newSource,
    };
  }

  deleteSource(id: string): boolean {
    const initialLen = this.sources.length;
    this.sources = this.sources.filter((s) => s.id !== id);
    if (this.sources.length !== initialLen) {
      this.saveToDisk();
      return true;
    }
    return false;
  }

  // --- Outcome methods ---
  getOutcomes(): CurriculumOutcome[] {
    return [...this.outcomes];
  }

  getConfirmedOutcomes(subject: string, grade: number): CurriculumOutcome[] {
    return this.outcomes.filter(
      (o) => o.confirmed && o.subject.toLowerCase() === subject.toLowerCase() && o.grade === grade
    );
  }

  saveOutcomes(outcomes: CurriculumOutcome[]): void {
    for (const outcome of outcomes) {
      const idx = this.outcomes.findIndex((o) => o.code === outcome.code);
      if (idx >= 0) {
        this.outcomes[idx] = outcome;
      } else {
        this.outcomes.push(outcome);
      }
    }
    this.saveToDisk();
  }

  confirmOutcome(code: string, confirmed: boolean): boolean {
    const item = this.outcomes.find((o) => o.code === code);
    if (item) {
      item.confirmed = confirmed;
      this.saveToDisk();
      return true;
    }
    return false;
  }

  deleteOutcome(code: string): boolean {
    const initialLen = this.outcomes.length;
    this.outcomes = this.outcomes.filter((o) => o.code !== code);
    if (this.outcomes.length !== initialLen) {
      this.saveToDisk();
      return true;
    }
    return false;
  }

  // --- Rule methods ---
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
    const initialLen = this.rules.length;
    this.rules = this.rules.filter((r) => r.id !== id);
    if (this.rules.length !== initialLen) {
      this.saveToDisk();
      return true;
    }
    return false;
  }

  // --- Assessment methods ---
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
      this.assessments.push(assessment);
    }
    this.saveToDisk();
    return assessment;
  }

  updateAssessmentStatus(id: string, status: Assessment['status']): boolean {
    const a = this.assessments.find((item) => item.id === id);
    if (a) {
      a.status = status;
      this.saveToDisk();
      return true;
    }
    return false;
  }

  deleteAssessment(id: string): boolean {
    const initialLen = this.assessments.length;
    this.assessments = this.assessments.filter((a) => a.id !== id);
    if (this.assessments.length !== initialLen) {
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
      this.validationReports.push(report);
    }
    this.saveToDisk();
    return report;
  }

  deleteValidationReport(id: string): boolean {
    const initialLen = this.validationReports.length;
    this.validationReports = this.validationReports.filter((r) => r.id !== id);
    if (this.validationReports.length !== initialLen) {
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
    const initialLen = this.frozenTasks.length;
    this.frozenTasks = this.frozenTasks.filter((t) => t.id !== id);
    if (this.frozenTasks.length !== initialLen) {
      this.saveToDisk();
      return true;
    }
    return false;
  }

  getRegressionRuns(): RegressionRun[] {
    return [...this.regressionRuns];
  }

  saveRegressionRun(run: RegressionRun): RegressionRun {
    this.regressionRuns.push(run);
    this.saveToDisk();
    return run;
  }

  // --- Side-by-Side ---
  getSideBySideReports(): SideBySideReport[] {
    return [...this.sideBySideReports];
  }

  saveSideBySideReport(report: SideBySideReport): SideBySideReport {
    this.sideBySideReports.push(report);
    this.saveToDisk();
    return report;
  }

  // --- Audit Logs ---
  logAIInteraction(log: Omit<AuditLog, 'id' | 'timestamp'>): AuditLog {
    const fullLog: AuditLog = {
      ...log,
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
    };
    this.auditLogs.unshift(fullLog);
    // Keep max 200 logs
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

  // --- Export & Wipe ---
  exportAllData(): Record<string, unknown> {
    return {
      exportedAt: new Date().toISOString(),
      policyVersion: this.computePolicyVersion(),
      sources: this.sources,
      outcomes: this.outcomes,
      rules: this.rules,
      assessments: this.assessments,
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
}

export const repository = new JsonFileRepository();
