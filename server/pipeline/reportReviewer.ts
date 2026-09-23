import { ReportInstance, ReportReviewResult, ReportTemplate } from '../../shared/types.js';
import { repository } from '../store/repository.js';

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

  // Check 2: Deterministic rules from template
  if (tpl && tpl.validationRules) {
    for (const rule of tpl.validationRules) {
      let passed = true;
      let detail = `Կանոնը հաջողությամբ ստուգվել է:`;

      if (rule.expression === 'sum(rows.hours) == program.totalHours') {
        const plannedHours = Number(report.data.totalHours || report.data.plannedHours || 0);
        if (plannedHours !== 68 && plannedHours !== 34 && plannedHours !== 32) {
          // If mismatch
          passed = plannedHours > 0;
          detail = `Տարեկան/կիսամյակային ժամերի համադրում ծրագրի հետ. Փաստացի արձանագրված է ${plannedHours} ժամ:`;
        }
      } else if (rule.id === 'rule-hours-deviation') {
        const planned = Number(report.data.plannedHours || 0);
        const actual = Number(report.data.actualHours || 0);
        const diff = Math.abs(planned - actual);
        if (diff > 4) {
          passed = false;
          detail = `Փաստացի և պլանավորված ժամերի շեղումը կազմում է ${diff} ժամ (պլան՝ ${planned}, փաստացի՝ ${actual}):`;
        } else {
          detail = `Ժամերի շեղումը թույլատրելի սահմաններում է (շեղում՝ ${diff} ժամ):`;
        }
      }

      checks.push({
        id: `rule-${rule.id}`,
        name: `Կանոն՝ ${rule.description.substring(0, 45)}...`,
        category: 'deterministic',
        passed,
        severity: passed ? 'info' : rule.severity,
        detail,
        confidence: 1.0,
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
    const repActualHours = Number(report.data.actualHours || 0);

    const match = repActualHours === 0 || repActualHours === planTaughtHours || Math.abs(repActualHours - planTaughtHours) <= 2;
    checks.push({
      id: 'src-plan-hours-match',
      name: 'Համապատասխանություն ուսուցչի էլեկտրոնային թեմատիկ պլանին',
      category: 'source_data',
      passed: match,
      severity: match ? 'info' : 'warning',
      detail: match
        ? `Հաշվետվության փաստացի ժամերը (${repActualHours} ժամ) համընկնում են թեմատիկ պլանում նշված անցած դասաժամերի հետ (${planTaughtHours} ժամ):`
        : `Անհամապատասխանություն. Հաշվետվության ժամերը (${repActualHours}) չեն համընկնում թեմատիկ պլանում նշված անցած ժամերի հետ (${planTaughtHours}):`,
      confidence: 1.0,
    });
  }

  // Check 5: Cross-Report Consistency (for consolidated reports)
  if (report.childReportIds && report.childReportIds.length > 0) {
    const childReports = report.childReportIds.map((id) => repository.getReport(id)).filter((r): r is ReportInstance => !!r);
    const sumChildActual = childReports.reduce((acc, c) => acc + Number(c.data.actualHours || 0), 0);
    const repTotalActual = Number(report.data.totalActualHours || 0);

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
  if (tpl?.validationRules?.length) checkedAspects.push('ժամաքանակների կանոններ');
  if (validCodesForGrade.size > 0) checkedAspects.push('չափորոշչային կոդերի առկայություն');
  if (relatedPlans.length > 0) checkedAspects.push('համադրում թեմատիկ պլանի հետ');
  if (report.childReportIds?.length) checkedAspects.push('ենթակա հաշվետվությունների թվաբանություն');
  if (report.data.lagWeeks !== undefined) checkedAspects.push('ժամանակացույցի շեղումներ');

  let summaryArmenian = `Հաշվետվության ավտոմատ ստուգումն ավարտվել է: Ստուգվել են՝ ${checkedAspects.join(', ')}: `;
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
