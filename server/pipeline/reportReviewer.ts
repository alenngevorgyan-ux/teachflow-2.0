import { ReportInstance, ReportReviewResult, ReportRule, ReportTemplate, ThematicPlan } from '../../shared/types.js';
import { repository } from '../store/repository.js';
import { findCodeInText } from './normalization.js';
import { collectStrings } from './privacyGuard.js';

type Kind = 'number' | 'count' | 'hours';

type FieldValue = { value: number } | { missing: true } | { invalid: string };

/**
 * A number from report data. Only real numbers and numeric strings count:
 * arrays, booleans and blank strings are not numbers (Number([]) === 0 and
 * Number(true) === 1 would invent values). Missing stays missing.
 */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*-?\d+(?:[.,]\d+)?\s*$/.test(v)) return Number(v.trim().replace(',', '.'));
  return null;
}

function readField(raw: unknown, key: string, kind: Kind): FieldValue {
  if (raw === undefined || raw === null || raw === '') return { missing: true };
  const n = num(raw);
  if (n === null) return { invalid: `«${key}»-ը թիվ չէ (${JSON.stringify(raw)})` };
  if (kind === 'count' && (!Number.isInteger(n) || n < 0)) return { invalid: `«${key}»-ը պետք է լինի ոչ բացասական ամբողջ թիվ (${n})` };
  if (kind === 'hours' && n < 0) return { invalid: `«${key}»-ը չի կարող բացասական լինել (${n})` };
  return { value: n };
}

export interface RuleOutcome {
  status: 'pass' | 'fail' | 'not_evaluated';
  detail: string;
}

const pass = (detail: string): RuleOutcome => ({ status: 'pass', detail });
const fail = (detail: string): RuleOutcome => ({ status: 'fail', detail });
const notEvaluated = (detail: string): RuleOutcome => ({
  status: 'not_evaluated',
  detail: `${detail} Պահանջվում է ձեռքով ստուգում:`,
});
const missingData = (...keys: string[]) =>
  notEvaluated(`Կանոնը չի ստուգվել՝ բացակայում են տվյալները (${keys.join(', ')}):`);

/**
 * Reads several fields at once: any invalid value fails the rule (the report
 * contains a wrong value), any missing value leaves it not evaluated.
 */
function readAll(
  report: ReportInstance,
  spec: Record<string, Kind>
): { values: Record<string, number> } | { outcome: RuleOutcome } {
  const values: Record<string, number> = {};
  const missing: string[] = [];
  for (const [key, kind] of Object.entries(spec)) {
    const f = readField(report.data[key], key, kind);
    if ('invalid' in f) return { outcome: fail(`Անվավեր արժեք՝ ${f.invalid}:`) };
    if ('missing' in f) missing.push(key);
    else values[key] = f.value;
  }
  if (missing.length > 0) return { outcome: missingData(...missing) };
  return { values };
}

/**
 * The teacher's thematic plan behind a report: same school, subject, grade
 * and academic year. With several plans for that year, the one whose
 * teacherName equals the report author; otherwise it is ambiguous.
 */
export function planForReport(report: ReportInstance): { plan: ThematicPlan } | { reason: string } {
  const plans = repository
    .getThematicPlans(report.schoolId, report.subject, report.grade)
    .filter((p) => p.academicYear === report.academicYear);
  if (plans.length === 0) return { reason: `${report.academicYear} ուսումնական տարվա թեմատիկ պլան չկա` };
  if (plans.length === 1) return { plan: plans[0] };
  const byAuthor = plans.filter((p) => p.teacherName === report.authorName);
  if (byAuthor.length === 1) return { plan: byAuthor[0] };
  return { reason: `${report.academicYear} տարվա համար կա ${plans.length} թեմատիկ պլան, և հայտնի չէ, որն է այս հաշվետվության պլանը` };
}

interface RuleEvaluator {
  // The exact rule expression this evaluator implements. A template rule is
  // evaluated only if its expression is identical: an edited rule is not
  // silently checked with the old logic.
  expression: string;
  evaluate: (report: ReportInstance) => RuleOutcome;
}

// Deterministic evaluators for the rules of the draft templates. A rule
// without an evaluator (or with a different expression) is NOT evaluated and
// never reported as passed.
export const RULE_EVALUATORS: Record<string, RuleEvaluator> = {
  'rule-hours-sum': {
    expression: 'sum(rows.hours) == program.totalHours',
    evaluate: (report) => {
      const rows = report.data.topicsTable;
      if (!Array.isArray(rows) || rows.length === 0) return missingData('topicsTable');
      let sum = 0;
      for (const [i, row] of rows.entries()) {
        const f = readField(row && typeof row === 'object' ? (row as Record<string, unknown>).hours : undefined, `topicsTable[${i}].hours`, 'hours');
        if ('invalid' in f) return fail(`Անվավեր արժեք՝ ${f.invalid}:`);
        if ('missing' in f) return missingData(`topicsTable[${i}].hours`);
        sum += f.value;
      }
      const sel = planForReport(report);
      if ('reason' in sel) return notEvaluated(`Ծրագրի տարեկան ժամաքանակը հայտնի չէ՝ ${sel.reason}:`);
      const program = readField(sel.plan.programTargetHours, 'programTargetHours', 'hours');
      if (!('value' in program)) return notEvaluated('Թեմատիկ պլանում ծրագրի տարեկան ժամաքանակը նշված չէ:');
      return sum === program.value
        ? pass(`Թեմաների ժամերի գումարը (${sum}) հավասար է ծրագրի ժամաքանակին (${program.value}):`)
        : fail(`Թեմաների ժամերի գումարը (${sum}) հավասար չէ ծրագրի ժամաքանակին (${program.value}):`);
    },
  },
  'rule-mandatory-outcomes': {
    expression: 'coveredOutcomesCount >= mandatoryOutcomesCount',
    evaluate: (report) => {
      const r = readAll(report, { coveredOutcomesCount: 'count', mandatoryOutcomesCount: 'count' });
      if ('outcome' in r) return r.outcome;
      const { coveredOutcomesCount: covered, mandatoryOutcomesCount: mandatory } = r.values;
      return covered >= mandatory
        ? pass(`Ծածկված են ${covered} / ${mandatory} պարտադիր վերջնարդյունք:`)
        : fail(`Ծածկված են միայն ${covered} / ${mandatory} պարտադիր վերջնարդյունք:`);
    },
  },
  // Scans every value in the report for outcome codes that the registry
  // records for the same subject but another grade (whole codes only).
  'rule-grade-consistency': {
    expression: 'none(report.codes, registry.grade != report.grade)',
    evaluate: (report) => {
      const otherGrade = repository
        .getOutcomes()
        .filter((o) => o.subject === report.subject && o.grade !== report.grade);
      if (otherGrade.length === 0) {
        return notEvaluated('Գրանցամատյանում այս առարկայի այլ դասարանների վերջնարդյունքներ չկան՝ համեմատելու բան չկա:');
      }
      const text = collectStrings(report.data).join('\n');
      const found = otherGrade.filter((o) => findCodeInText(o.code, text).length > 0).map((o) => `${o.code} (${o.grade})`);
      return found.length === 0
        ? pass(`Այլ դասարանի վերջնարդյունքների կոդեր չեն հայտնաբերվել (ստուգվել է ${otherGrade.length} կոդ):`)
        : fail(`Հայտնաբերվել են այլ դասարանի կոդեր՝ ${found.join(', ')}:`);
    },
  },
  // Draft wording: «must not exceed 15% or 4 hours». Read strictly: exceeding
  // either limit fails, so the report goes to a human rather than passing.
  'rule-hours-deviation': {
    expression: 'abs(plannedHours - actualHours) <= min(4, 0.15 * plannedHours)',
    evaluate: (report) => {
      const r = readAll(report, { plannedHours: 'hours', actualHours: 'hours' });
      if ('outcome' in r) return r.outcome;
      const { plannedHours: planned, actualHours: actual } = r.values;
      const diff = Math.abs(planned - actual);
      const limit = Math.min(4, 0.15 * planned);
      const pctText = planned > 0 ? `${((diff / planned) * 100).toFixed(1)}%` : 'n/a';
      return diff <= limit
        ? pass(`Շեղումը թույլատրելի է՝ ${diff} ժամ (${pctText}), պլան՝ ${planned}, փաստացի՝ ${actual}:`)
        : fail(`Շեղումը գերազանցում է 4 ժամը կամ 15%-ը՝ ${diff} ժամ (${pctText}), պլան՝ ${planned}, փաստացի՝ ${actual}:`);
    },
  },
  'rule-lag-warning': {
    expression: 'lagWeeks <= 2 || teacherReflection != ""',
    evaluate: (report) => {
      const r = readAll(report, { lagWeeks: 'hours' });
      if ('outcome' in r) return r.outcome;
      const lag = r.values.lagWeeks;
      if (lag <= 2) return pass(`Ուշացումը ${lag} շաբաթ է (≤ 2):`);
      const reflection = typeof report.data.teacherReflection === 'string' ? report.data.teacherReflection.trim() : '';
      return reflection
        ? pass(`Ուշացումը ${lag} շաբաթ է, բացատրությունը ներկայացված է:`)
        : fail(`Ուշացումը ${lag} շաբաթ է (> 2), սակայն բացատրություն (teacherReflection) չկա:`);
    },
  },
  'rule-mu-teachers': {
    expression: 'teachersCount >= 1',
    evaluate: (report) => {
      const r = readAll(report, { teachersCount: 'count' });
      if ('outcome' in r) return r.outcome;
      const n = r.values.teachersCount;
      return n >= 1 ? pass(`Ուսուցիչների թիվը՝ ${n}:`) : fail(`Ուսուցիչների թիվը՝ ${n} (< 1):`);
    },
  },
  'rule-mu-cross-check': {
    expression: 'totalActualHours == sum(children.actualHours)',
    evaluate: (report) => {
      const ids = report.childReportIds ?? [];
      if (ids.length === 0) return notEvaluated('Կանոնը չի ստուգվել՝ ենթակա հաշվետվություններ կապված չեն:');
      const r = readAll(report, { totalActualHours: 'hours' });
      if ('outcome' in r) return r.outcome;
      let sum = 0;
      for (const id of ids) {
        const child = repository.getReport(id);
        if (!child) return notEvaluated(`Ենթակա հաշվետվությունը (${id}) չի գտնվել:`);
        const f = readField(child.data.actualHours, `${id}.actualHours`, 'hours');
        if ('invalid' in f) return fail(`Անվավեր արժեք ենթակա հաշվետվությունում՝ ${f.invalid}:`);
        if ('missing' in f) return missingData(`${id}.actualHours`);
        sum += f.value;
      }
      const total = r.values.totalActualHours;
      return total === sum
        ? pass(`Ընդհանուր ժամերը (${total}) հավասար են ենթակա հաշվետվությունների գումարին:`)
        : fail(`Ընդհանուր ժամերը (${total}) հավասար չեն ենթակա հաշվետվությունների գումարին (${sum}):`);
    },
  },
  'rule-students-count': {
    expression: 'studentsParticipatedCount > 0',
    evaluate: (report) => {
      const r = readAll(report, { studentsParticipatedCount: 'count' });
      if ('outcome' in r) return r.outcome;
      const n = r.values.studentsParticipatedCount;
      return n > 0 ? pass(`Մասնակիցների թիվը՝ ${n}:`) : fail(`Մասնակիցների թիվը դրական չէ (${n}):`);
    },
  },
  'rule-avg-bounds': {
    expression: '0 <= averageScorePercent <= 100',
    evaluate: (report) => {
      const r = readAll(report, { averageScorePercent: 'number' });
      if ('outcome' in r) return r.outcome;
      const avg = r.values.averageScorePercent;
      return avg >= 0 && avg <= 100 ? pass(`Միջին տոկոսը՝ ${avg}%:`) : fail(`Միջին տոկոսը դուրս է 0–100 միջակայքից (${avg}):`);
    },
  },
};

export function evaluateTemplateRule(rule: ReportRule, report: ReportInstance): RuleOutcome {
  if (rule.kind === 'llm_judged') {
    return notEvaluated('LLM-ով գնահատվող կանոնները հաշվետվության ավտոմատ ստուգման ժամանակ չեն կատարվում:');
  }
  const evaluator = RULE_EVALUATORS[rule.id];
  if (!evaluator) return notEvaluated('Այս կանոնի համար ավտոմատ ստուգիչ չկա:');
  if ((rule.expression ?? '').trim() !== evaluator.expression) {
    return notEvaluated(
      `Կանոնի արտահայտությունը («${rule.expression ?? ''}») չի համընկնում ավտոմատ ստուգվողի հետ («${evaluator.expression}»):`
    );
  }
  return evaluator.evaluate(report);
}

export function runReportReview(
  report: ReportInstance,
  template?: ReportTemplate
): ReportReviewResult {
  const tpl = template || repository.getReportTemplate(report.templateId);
  const checks: ReportReviewResult['checks'] = [];

  // Check 1: Completeness
  if (tpl) {
    for (const field of tpl.fields) {
      if (field.required) {
        const val = report.data[field.key];
        const isPresent = val !== undefined && val !== null && val !== '';
        checks.push({
          id: `comp-${field.key}`,
          name: `Պարտադիր դաշտ՝ «${field.label.hy}»`,
          category: 'completeness',
          passed: isPresent,
          severity: isPresent ? 'info' : 'error',
          detail: isPresent
            ? `Դաշտը լրացված է: Տվյալ՝ ${typeof val === 'object' ? '[Աղյուսակ/Կառույց]' : val}`
            : `Պարտադիր դաշտը լրացված չէ:`,
          confidence: 1.0,
          fieldKey: field.key,
        });
      }
    }
  }

  // Check 2: Template rules. Only rules with a known deterministic evaluator
  // are run; everything else (incl. llm_judged) is reported as not evaluated
  // and needs a human — never as passed.
  let rulesEvaluated = 0;
  let rulesNotEvaluated = 0;
  if (tpl && tpl.validationRules) {
    for (const rule of tpl.validationRules) {
      const outcome = evaluateTemplateRule(rule, report);
      if (outcome.status === 'not_evaluated') rulesNotEvaluated++;
      else rulesEvaluated++;
      const passed = outcome.status === 'pass';
      checks.push({
        id: `rule-${rule.id}`,
        name: `Կանոն՝ ${rule.description.substring(0, 45)}...`,
        category: 'deterministic',
        passed,
        severity: passed ? 'info' : outcome.status === 'fail' ? rule.severity : 'warning',
        detail: outcome.detail,
        ...(outcome.status === 'not_evaluated' ? {} : { confidence: 1.0 }),
      });
    }
  }

  // Check 3: Consistency with Registry (active version, valid outcome codes, no other-grade codes)
  const outcomes = repository.getOutcomes();
  const validCodesForGrade = new Set(
    outcomes.filter((o) => o.subject === report.subject && o.grade === report.grade).map((o) => o.code)
  );
  const otherGradeCodes = new Map<string, number>();
  for (const o of outcomes) {
    if (o.subject === report.subject && o.grade !== report.grade) {
      otherGradeCodes.set(o.code, o.grade);
    }
  }

  // Check data for any outcome codes mentioned
  const reportedUncovered = Array.isArray(report.data.uncoveredOutcomes) ? report.data.uncoveredOutcomes : [];
  for (const code of reportedUncovered) {
    if (otherGradeCodes.has(code)) {
      checks.push({
        id: `reg-other-grade-${code}`,
        name: `Այլ դասարանի վերջնարդյունքի կոդ`,
        category: 'registry',
        passed: false,
        severity: 'error',
        detail: `Հաշվետվությունում հայտնաբերվել է «${code}» կոդը, որը պատկանում է ${otherGradeCodes.get(code)}-րդ դասարանի ծրագրին (${report.grade}-րդի փոխարեն):`,
        confidence: 1.0,
      });
    } else if (!validCodesForGrade.has(code)) {
      checks.push({
        id: `reg-unknown-code-${code}`,
        name: `Գրանցամատյանում չգտնված կոդ`,
        category: 'registry',
        passed: false,
        severity: 'warning',
        detail: `«${code}» կոդը հաստատված չէ պաշտոնական առարկայական չափորոշչում:`,
        confidence: 1.0,
      });
    }
  }

  // Program version: the teacher's thematic plan for this academic year must
  // use a version of an active subject program / standard in the registry
  // (a textbook's version is not a program version). If the plan or the
  // program is unknown, the check cannot run; say so, never pass.
  const planSel = planForReport(report);
  const programVersions = new Set(
    repository
      .getSources()
      .filter(
        (s) =>
          s.status === 'active' &&
          (s.docType === 'subject_program' || s.docType === 'standard') &&
          s.subject === report.subject &&
          s.grades.includes(report.grade)
      )
      .map((s) => s.version)
  );
  const versionCheck = {
    id: 'reg-program-version',
    name: 'Առարկայական ծրագրի տարբերակի համապատասխանություն',
    category: 'registry' as const,
  };
  if ('reason' in planSel) {
    checks.push({ ...versionCheck, passed: false, severity: 'warning', detail: `Ստուգումը հնարավոր չէ՝ ${planSel.reason}: Պահանջվում է ձեռքով հաստատում:` });
  } else if (programVersions.size === 0) {
    checks.push({
      ...versionCheck,
      passed: false,
      severity: 'warning',
      detail: 'Ստուգումը հնարավոր չէ՝ գրանցամատյանում այս առարկայի/դասարանի ակտիվ առարկայական ծրագիր կամ չափորոշիչ չկա: Պահանջվում է ձեռքով հաստատում:',
    });
  } else {
    const planVersion = planSel.plan.programVersion;
    const matches = programVersions.has(planVersion);
    checks.push({
      ...versionCheck,
      passed: matches,
      severity: matches ? 'info' : 'error',
      detail: matches
        ? `Թեմատիկ պլանի ծրագրի տարբերակը (${planVersion}) համընկնում է ակտիվ առարկայական ծրագրի/չափորոշչի տարբերակի հետ:`
        : `Թեմատիկ պլանի ծրագրի տարբերակը (${planVersion}) չկա ակտիվ ծրագրերի/չափորոշիչների մեջ (${[...programVersions].join(', ')}):`,
      confidence: 1.0,
    });
  }

  // Check 4: report actual hours vs taught hours in the teacher's plan
  // (±2 h tolerance). Missing hours on either side -> cannot check.
  const planHoursCheck = {
    id: 'src-plan-hours-match',
    name: 'Համապատասխանություն ուսուցչի էլեկտրոնային թեմատիկ պլանին',
    category: 'source_data' as const,
  };
  if ('plan' in planSel) {
    const taught = planSel.plan.rows.filter((r) => r.taught);
    const rowHours = taught.map((r) => readField(r.actualHours, `row ${r.id}.actualHours`, 'hours'));
    const reportHours = readField(report.data.actualHours, 'actualHours', 'hours');
    const invalid = [...rowHours, reportHours].find((f): f is { invalid: string } => 'invalid' in f);
    if (invalid) {
      checks.push({ ...planHoursCheck, passed: false, severity: 'error', detail: `Անվավեր արժեք՝ ${invalid.invalid}:` });
    } else if (!('value' in reportHours) || rowHours.some((f) => !('value' in f))) {
      checks.push({
        ...planHoursCheck,
        passed: false,
        severity: 'warning',
        detail: !('value' in reportHours)
          ? 'Ստուգումը հնարավոր չէ՝ հաշվետվությունում փաստացի ժամերը նշված չեն: Պահանջվում է ձեռքով ստուգում:'
          : 'Ստուգումը հնարավոր չէ՝ թեմատիկ պլանի անցած թեմաներից մեկում փաստացի ժամերը նշված չեն: Պահանջվում է ձեռքով ստուգում:',
      });
    } else {
      const planTaughtHours = rowHours.reduce((acc, f) => acc + (f as { value: number }).value, 0);
      const repActualHours = reportHours.value;
      const match = Math.abs(repActualHours - planTaughtHours) <= 2;
      checks.push({
        ...planHoursCheck,
        passed: match,
        severity: match ? 'info' : 'warning',
        detail: match
          ? `Հաշվետվության փաստացի ժամերը (${repActualHours} ժամ) համընկնում են թեմատիկ պլանում նշված անցած դասաժամերի հետ (${planTaughtHours} ժամ, թույլատրելի շեղում՝ ±2):`
          : `Անհամապատասխանություն. Հաշվետվության ժամերը (${repActualHours}) չեն համընկնում թեմատիկ պլանում նշված անցած ժամերի հետ (${planTaughtHours}):`,
        confidence: 1.0,
      });
    }
  }

  // Check 5: consolidated report hours == sum of child reports (same logic
  // as the rule-mu-cross-check evaluator).
  if (report.childReportIds && report.childReportIds.length > 0) {
    const outcome = RULE_EVALUATORS['rule-mu-cross-check'].evaluate(report);
    checks.push({
      id: 'cross-child-reports-sum',
      name: 'Ենթակա հաշվետվությունների թվաբանական համադրում',
      category: 'cross_report',
      passed: outcome.status === 'pass',
      severity: outcome.status === 'pass' ? 'info' : outcome.status === 'fail' ? 'error' : 'warning',
      detail: outcome.detail,
      ...(outcome.status === 'not_evaluated' ? {} : { confidence: 1.0 }),
    });
  }

  // Check 6: Anomalies (neutral, objective wording about data)
  const lagWeeks = num(report.data.lagWeeks);
  if (lagWeeks !== null && lagWeeks >= 2) {
    checks.push({
      id: 'anom-lag',
      name: 'Ծրագրային ժամանակացույցի շեղում',
      category: 'anomaly',
      passed: false,
      severity: 'warning',
      detail: `Տվյալների համաձայն՝ առկա է ${lagWeeks} շաբաթ ծրագրային հետ ընկնելու ցուցանիշ: Անհրաժեշտ է դիտարկել լրացուցիչ պարապմունքների ժամանակացույց:`,
      confidence: 1.0,
    });
  }

  const hasErrors = checks.some((c) => c.severity === 'error' && !c.passed);
  const hasWarnings = checks.some((c) => c.severity === 'warning' && !c.passed);

  const status = hasErrors ? 'has_errors' : hasWarnings ? 'has_warnings' : 'ready';
  const recommendation = hasErrors ? 'return_for_correction' : 'accept';

  // Verify whether every field has real provenance
  const tplFields = tpl ? tpl.fields : [];
  const allFieldsHaveProvenance =
    tplFields.length > 0 &&
    tplFields.every((f) => {
      const prov = report.fieldProvenance?.[f.key];
      return Boolean(prov && prov.trim().length > 0 && !prov.includes('Չի հայտնաբերվել') && !prov.includes('պահանջվում է'));
    });

  const checkedAspects: string[] = [];
  if (tpl) checkedAspects.push('պարտադիր դաշտերի լրացվածություն');
  if (rulesEvaluated > 0) checkedAspects.push(`ձևանմուշի կանոններ (${rulesEvaluated})`);
  if (validCodesForGrade.size > 0) checkedAspects.push('չափորոշչային կոդերի առկայություն');
  if ('plan' in planSel) checkedAspects.push('համադրում թեմատիկ պլանի հետ');
  if (report.childReportIds?.length) checkedAspects.push('ենթակա հաշվետվությունների թվաբանություն');
  if (report.data.lagWeeks !== undefined) checkedAspects.push('ժամանակացույցի շեղումներ');

  let summaryArmenian = `Հաշվետվության ավտոմատ ստուգումն ավարտվել է: Ստուգվել են՝ ${checkedAspects.join(', ')}: `;
  if (rulesNotEvaluated > 0) {
    summaryArmenian += `Ավտոմատ չեն ստուգվել ${rulesNotEvaluated} կանոն(ներ)՝ պահանջվում է ձեռքով ստուգում: `;
  }
  if (status === 'ready') {
    summaryArmenian += `Ստուգված բոլոր կանոններն ու պարտադիր դաշտերը համապատասխանում են սահմանված պահանջներին: `;
    if (allFieldsHaveProvenance) {
      summaryArmenian += `Բոլոր դաշտերի տվյալները հաստատված են սկզբնաղբյուրներով: `;
    }
    summaryArmenian += `Խորհուրդ է տրվում հաստատել:`;
  } else if (status === 'has_warnings') {
    summaryArmenian += `Հայտնաբերվել են նախազգուշացումներ (օր.՝ փոքր շեղումներ կամ բացատրություն պահանջող կետեր): Դիտարկեք դրանք նախքան հաստատելը:`;
  } else {
    summaryArmenian += `Հայտնաբերվել են սխալներ կամ անհամապատասխանություններ, որոնք պահանջում են ճշգրտում ուսուցչի կողմից: Խորհուրդ է տրվում վերադարձնել մեկնաբանություններով:`;
  }

  return {
    reportId: report.id,
    status,
    checks,
    summaryArmenian,
    recommendation,
  };
}
