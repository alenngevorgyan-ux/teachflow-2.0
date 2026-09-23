import { ReportInstance, ReportReviewResult, ReportRule, ReportTemplate } from '../../shared/types.js';
import { repository } from '../store/repository.js';
import { collectStrings } from './privacyGuard.js';

/** A number from report data, or null when missing — never a default 0. */
function num(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

type RuleEvaluator = (report: ReportInstance) => RuleOutcome;

// Deterministic evaluators for the rules of the draft templates. A rule
// without an evaluator here is NOT evaluated (and never reported as passed).
const RULE_EVALUATORS: Record<string, RuleEvaluator> = {
  // Report total hours must equal the program's annual hours from the
  // teacher's thematic plan (not a hardcoded 68/34/32).
  'rule-hours-sum': (report) => {
    const total = num(report.data.totalHours);
    if (total === null) return missingData('totalHours');
    const plan = repository.getThematicPlans(report.schoolId, report.subject, report.grade)[0];
    const programHours = num(plan?.programTargetHours);
    if (programHours === null) return notEvaluated('Կանոնը չի ստուգվել՝ ծրագրի տարեկան ժամաքանակը հայտնի չէ (թեմատիկ պլան չկա):');
    return total === programHours
      ? pass(`Տարեկան ժամաքանակը (${total}) հավասար է ծրագրի ժամաքանակին (${programHours}):`)
      : fail(`Տարեկան ժամաքանակը (${total}) հավասար չէ ծրագրի ժամաքանակին (${programHours}):`);
  },
  'rule-mandatory-outcomes': (report) => {
    const covered = num(report.data.coveredOutcomesCount);
    const mandatory = num(report.data.mandatoryOutcomesCount);
    if (covered === null || mandatory === null) return missingData('coveredOutcomesCount', 'mandatoryOutcomesCount');
    return covered >= mandatory
      ? pass(`Ծածկված են ${covered} / ${mandatory} պարտադիր վերջնարդյունք:`)
      : fail(`Ծածկված են միայն ${covered} / ${mandatory} պարտադիր վերջնարդյունք:`);
  },
  // Scans every value in the report for outcome codes of the same subject
  // but another grade (as recorded in the registry).
  'rule-grade-consistency': (report) => {
    const otherGrade = repository
      .getOutcomes()
      .filter((o) => o.subject === report.subject && o.grade !== report.grade);
    const text = collectStrings(report.data).join('\n');
    const found = otherGrade.filter((o) => text.includes(o.code)).map((o) => `${o.code} (${o.grade})`);
    return found.length === 0
      ? pass('Այլ դասարանի վերջնարդյունքների կոդեր չեն հայտնաբերվել:')
      : fail(`Հայտնաբերվել են այլ դասարանի կոդեր՝ ${found.join(', ')}:`);
  },
  // Draft wording: «must not exceed 15% or 4 hours». Read strictly: exceeding
  // either limit fails, so the report goes to a human rather than passing.
  'rule-hours-deviation': (report) => {
    const planned = num(report.data.plannedHours);
    const actual = num(report.data.actualHours);
    if (planned === null || actual === null) return missingData('plannedHours', 'actualHours');
    const diff = Math.abs(planned - actual);
    const pct = planned > 0 ? (diff / planned) * 100 : diff > 0 ? Infinity : 0;
    const pctText = Number.isFinite(pct) ? `${pct.toFixed(1)}%` : 'n/a';
    return diff <= 4 && pct <= 15
      ? pass(`Շեղումը թույլատրելի է՝ ${diff} ժամ (${pctText}), պլան՝ ${planned}, փաստացի՝ ${actual}:`)
      : fail(`Շեղումը գերազանցում է 4 ժամը կամ 15%-ը՝ ${diff} ժամ (${pctText}), պլան՝ ${planned}, փաստացի՝ ${actual}:`);
  },
  'rule-lag-warning': (report) => {
    const lag = num(report.data.lagWeeks);
    if (lag === null) return missingData('lagWeeks');
    if (lag <= 2) return pass(`Ուշացումը ${lag} շաբաթ է (≤ 2):`);
    const reflection = typeof report.data.teacherReflection === 'string' ? report.data.teacherReflection.trim() : '';
    return reflection
      ? pass(`Ուշացումը ${lag} շաբաթ է, բացատրությունը ներկայացված է:`)
      : fail(`Ուշացումը ${lag} շաբաթ է (> 2), սակայն բացատրություն (teacherReflection) չկա:`);
  },
  'rule-mu-teachers': (report) => {
    const teachers = num(report.data.teachersCount);
    if (teachers === null) return missingData('teachersCount');
    return teachers >= 1 ? pass(`Ուսուցիչների թիվը՝ ${teachers}:`) : fail(`Ուսուցիչների թիվը՝ ${teachers} (< 1):`);
  },
  'rule-mu-cross-check': (report) => {
    const ids = report.childReportIds ?? [];
    if (ids.length === 0) return notEvaluated('Կանոնը չի ստուգվել՝ ենթակա հաշվետվություններ կապված չեն:');
    const children = ids.map((id) => repository.getReport(id));
    const total = num(report.data.totalActualHours);
    const hours = children.map((c) => num(c?.data.actualHours));
    if (total === null || hours.some((h) => h === null)) return missingData('totalActualHours', 'actualHours (ենթակա)');
    const sum = (hours as number[]).reduce((a, h) => a + h, 0);
    return total === sum
      ? pass(`Ընդհանուր ժամերը (${total}) հավասար են ենթակա հաշվետվությունների գումարին:`)
      : fail(`Ընդհանուր ժամերը (${total}) հավասար չեն ենթակա հաշվետվությունների գումարին (${sum}):`);
  },
  'rule-students-count': (report) => {
    const n = num(report.data.studentsParticipatedCount);
    if (n === null) return missingData('studentsParticipatedCount');
    return n > 0 ? pass(`Մասնակիցների թիվը՝ ${n}:`) : fail(`Մասնակիցների թիվը դրական չէ (${n}):`);
  },
  'rule-avg-bounds': (report) => {
    const avg = num(report.data.averageScorePercent);
    if (avg === null) return missingData('averageScorePercent');
    return avg >= 0 && avg <= 100 ? pass(`Միջին տոկոսը՝ ${avg}%:`) : fail(`Միջին տոկոսը դուրս է 0–100 միջակայքից (${avg}):`);
  },
};

export function evaluateTemplateRule(rule: ReportRule, report: ReportInstance): RuleOutcome {
  if (rule.kind === 'llm_judged') {
    return notEvaluated('LLM-ով գնահատվող կանոնները հաշվետվության ավտոմատ ստուգման ժամանակ չեն կատարվում:');
  }
  const evaluator = RULE_EVALUATORS[rule.id];
  if (!evaluator) return notEvaluated('Այս կանոնի համար ավտոմատ ստուգիչ չկա:');
  return evaluator(report);
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

  // Program version: the thematic plan behind this report must use a version
  // that exists among the active registry sources for this subject/grade.
  // No plan or no active sources -> the check cannot run; say so, never pass.
  const versionPlans = repository.getThematicPlans(report.schoolId, report.subject, report.grade);
  const activeVersions = new Set(
    repository
      .getSources()
      .filter((s) => s.status === 'active' && s.subject === report.subject && s.grades.includes(report.grade))
      .map((s) => s.version)
  );
  if (versionPlans.length === 0 || activeVersions.size === 0) {
    checks.push({
      id: 'reg-program-version',
      name: 'Առարկայական ծրագրի տարբերակի համապատասխանություն',
      category: 'registry',
      passed: false,
      severity: 'warning',
      detail:
        versionPlans.length === 0
          ? 'Ստուգումը հնարավոր չէ՝ այս առարկայի/դասարանի թեմատիկ պլան չկա: Պահանջվում է ձեռքով հաստատում:'
          : 'Ստուգումը հնարավոր չէ՝ գրանցամատյանում այս առարկայի/դասարանի ակտիվ աղբյուր չկա: Պահանջվում է ձեռքով հաստատում:',
    });
  } else {
    const planVersion = versionPlans[0].programVersion;
    const matches = activeVersions.has(planVersion);
    checks.push({
      id: 'reg-program-version',
      name: 'Առարկայական ծրագրի տարբերակի համապատասխանություն',
      category: 'registry',
      passed: matches,
      severity: matches ? 'info' : 'error',
      detail: matches
        ? `Թեմատիկ պլանի ծրագրի տարբերակը (${planVersion}) համընկնում է գրանցամատյանի ակտիվ աղբյուրի տարբերակի հետ:`
        : `Թեմատիկ պլանի ծրագրի տարբերակը (${planVersion}) չկա գրանցամատյանի ակտիվ աղբյուրներում (${[...activeVersions].join(', ')}):`,
      confidence: 1.0,
    });
  }

  // Check 4: Consistency with Source Data (Thematic plans / Progress / Assessments)
  const relatedPlans = repository.getThematicPlans(report.schoolId, report.subject, report.grade);
  if (relatedPlans.length > 0) {
    const activePlan = relatedPlans[0];
    const planTaughtHours = activePlan.rows.filter((r) => r.taught).reduce((acc, r) => acc + (r.actualHours || 0), 0);
    const repActualHours = num(report.data.actualHours);

    if (repActualHours === null) {
      checks.push({
        id: 'src-plan-hours-match',
        name: 'Համապատասխանություն ուսուցչի էլեկտրոնային թեմատիկ պլանին',
        category: 'source_data',
        passed: false,
        severity: 'warning',
        detail: `Ստուգումը հնարավոր չէ՝ հաշվետվությունում փաստացի ժամերը նշված չեն (թեմատիկ պլանում՝ ${planTaughtHours} ժամ): Պահանջվում է ձեռքով ստուգում:`,
      });
    } else {
    const match = Math.abs(repActualHours - planTaughtHours) <= 2;
    checks.push({
      id: 'src-plan-hours-match',
      name: 'Համապատասխանություն ուսուցչի էլեկտրոնային թեմատիկ պլանին',
      category: 'source_data',
      passed: match,
      severity: match ? 'info' : 'warning',
      detail: match
        ? `Հաշվետվության փաստացի ժամերը (${repActualHours} ժամ) համընկնում են թեմատիկ պլանում նշված անցած դասաժամերի հետ (${planTaughtHours} ժամ, թույլատրելի շեղում՝ ±2):`
        : `Անհամապատասխանություն. Հաշվետվության ժամերը (${repActualHours}) չեն համընկնում թեմատիկ պլանում նշված անցած ժամերի հետ (${planTaughtHours}):`,
      confidence: 1.0,
    });
    }
  }

  // Check 5: Cross-Report Consistency (for consolidated reports)
  if (report.childReportIds && report.childReportIds.length > 0) {
    const childReports = report.childReportIds.map((id) => repository.getReport(id)).filter((r): r is ReportInstance => !!r);
    const childActual = childReports.map((c) => num(c.data.actualHours));
    const repTotalActual = num(report.data.totalActualHours);
    const missing =
      childReports.length !== report.childReportIds.length || repTotalActual === null || childActual.some((h) => h === null);

    if (missing) {
      checks.push({
        id: 'cross-child-reports-sum',
        name: 'Ենթակա հաշվետվությունների թվաբանական համադրում',
        category: 'cross_report',
        passed: false,
        severity: 'warning',
        detail: 'Ստուգումը հնարավոր չէ՝ ամփոփ կամ ենթակա հաշվետվություններից մեկում փաստացի ժամերը նշված չեն (կամ հաշվետվությունը չի գտնվել): Պահանջվում է ձեռքով ստուգում:',
      });
    } else {
    const sumChildActual = (childActual as number[]).reduce((acc, h) => acc + h, 0);
    const matchesSum = repTotalActual === sumChildActual;
    checks.push({
      id: 'cross-child-reports-sum',
      name: 'Ենթակա հաշվետվությունների թվաբանական համադրում',
      category: 'cross_report',
      passed: matchesSum,
      severity: matchesSum ? 'info' : 'error',
      detail: matchesSum
        ? `Դպրոցի ամփոփ ժամերը (${repTotalActual} ժամ) ճշգրիտ հավասար են ${childReports.length} ուսուցիչների հաշվետվությունների գումարին:`
        : `Թվաբանական անհամապատասխանություն. Ամփոփ հաշվետվությունում նշված է ${repTotalActual} ժամ, սակայն ուսուցիչների հաշվետվությունների գումարը ${sumChildActual} ժամ է:`,
      confidence: 1.0,
    });
    }
  }

  // Check 6: Anomalies (neutral, objective wording about data)
  const lagWeeks = Number(report.data.lagWeeks || 0);
  if (lagWeeks >= 2) {
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
  if (relatedPlans.length > 0) checkedAspects.push('համադրում թեմատիկ պլանի հետ');
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
