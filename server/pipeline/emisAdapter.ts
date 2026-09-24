import { AnswerSheetSubmission, ReportInstance, ThematicPlan } from '../../shared/types.js';

export interface EmisExportAdapter {
  exportGradesCsv(assessmentTitle: string, submissions: AnswerSheetSubmission[]): string;
  exportThematicPlanCsv(plan: ThematicPlan): string;
  exportReportCsv(report: ReportInstance): string;
}

// Missing values: this CSV is a TeachFlow draft format (no official EMIS
// schema is confirmed). An EMPTY cell means "unknown / not recorded"; each
// file says so in its header. Nothing missing is replaced by a number
// (1.0 or 0 are both claims), a boolean or placeholder text.
export const EMIS_MISSING_VALUE_NOTE = '# Empty cell = unknown / not recorded (no value is assumed)';

/** One CSV cell: quoted text, empty for null/undefined. */
function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return `"${text.replace(/"/g, '""')}"`;
}

/** A numeric cell: the number as written, empty when not a finite number. */
function num(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

export class StandardEmisExportAdapter implements EmisExportAdapter {
  exportGradesCsv(assessmentTitle: string, submissions: AnswerSheetSubmission[]): string {
    const lines: string[] = [];
    lines.push(`# TeachFlow Export to EMIS/Electronic Journal`);
    lines.push(`# Assessment: "${assessmentTitle.replace(/"/g, '""')}"`);
    lines.push(`# Date: ${new Date().toISOString()}`);
    lines.push(`# Privacy Notice: Anonymous student codes only (No PII)`);
    lines.push(`StudentCode,Variant,TotalScore,MaxScore,Percent,Status,Timestamp`);

    for (const sub of submissions) {
      lines.push(
        `"${sub.studentCode}","${sub.variant}",${sub.totalScore},${sub.maxScore},${sub.percent}%,"${sub.status}","${sub.timestamp}"`
      );
    }

    return lines.join('\n');
  }

  exportThematicPlanCsv(plan: ThematicPlan): string {
    const lines: string[] = [];
    lines.push(`# TeachFlow Thematic Plan Export`);
    lines.push(`# Subject: ${plan.subject}, Grade: ${plan.grade}`);
    lines.push(`# School: ${plan.schoolName}, Teacher: ${plan.teacherName}`);
    if (plan.isDemoContext) lines.push('# DEMO context: the school is a demo record, not a real school');
    lines.push(`# Program Target Hours: ${plan.programTargetHours}, Total Planned: ${plan.totalAnnualHours}`);
    lines.push(EMIS_MISSING_VALUE_NOTE);
    lines.push(`WeekNumber,Topic,OutcomeCodes,PlannedHours,PlannedDates,HasAssessment,Taught,ActualHours,TeacherNote`);

    for (const row of plan.rows) {
      lines.push(
        [
          num(row.weekNumber),
          cell(row.topic),
          cell(row.outcomeCodes.join(';')),
          num(row.plannedHours),
          cell(row.plannedDates),
          typeof row.hasAssessment === 'boolean' ? String(row.hasAssessment) : '',
          typeof row.taught === 'boolean' ? String(row.taught) : '',
          num(row.actualHours), // not taught yet = unknown, never 0
          cell(row.teacherNote),
        ].join(',')
      );
    }

    return lines.join('\n');
  }

  exportReportCsv(report: ReportInstance): string {
    const lines: string[] = [];
    lines.push(`# TeachFlow Report Export`);
    lines.push(`# Title: "${report.title.replace(/"/g, '""')}"`);
    lines.push(`# Template ID: ${report.templateId}, Version: ${report.templateVersion}`);
    lines.push(`# School: "${report.schoolName}", Author: "${report.authorName}"`);
    lines.push(`# Snapshot Hash: ${report.dataSnapshotHash}`);
    lines.push(EMIS_MISSING_VALUE_NOTE);
    lines.push(`FieldKey,Value,Confidence,Provenance`);

    for (const [key, val] of Object.entries(report.data)) {
      // Confidence / provenance exist only for extracted fields; for the rest
      // they are unknown and stay empty (not 1.0, not 0, not "System recorded").
      lines.push([cell(key), cell(val), num(report.fieldConfidences?.[key]), cell(report.fieldProvenance?.[key])].join(','));
    }

    return lines.join('\n');
  }
}

export const emisAdapter = new StandardEmisExportAdapter();
