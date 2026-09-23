import { AnswerSheetSubmission, ReportInstance, ThematicPlan } from '../../shared/types.js';

export interface EmisExportAdapter {
  exportGradesCsv(assessmentTitle: string, submissions: AnswerSheetSubmission[]): string;
  exportThematicPlanCsv(plan: ThematicPlan): string;
  exportReportCsv(report: ReportInstance): string;
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
    lines.push(`# Program Target Hours: ${plan.programTargetHours}, Total Planned: ${plan.totalAnnualHours}`);
    lines.push(`WeekNumber,Topic,OutcomeCodes,PlannedHours,PlannedDates,HasAssessment,Taught,ActualHours,TeacherNote`);

    for (const row of plan.rows) {
      lines.push(
        `${row.weekNumber},"${row.topic.replace(/"/g, '""')}","${row.outcomeCodes.join(';')}",${row.plannedHours},"${row.plannedDates}",${row.hasAssessment},${row.taught || false},${row.actualHours || 0},"${(row.teacherNote || '').replace(/"/g, '""')}"`
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
    lines.push(`FieldKey,Value,Confidence,Provenance`);

    for (const [key, val] of Object.entries(report.data)) {
      const conf = report.fieldConfidences?.[key] !== undefined ? report.fieldConfidences[key] : 1.0;
      const prov = report.fieldProvenance?.[key] || 'System recorded';
      const formattedVal = typeof val === 'object' ? JSON.stringify(val).replace(/"/g, '""') : String(val).replace(/"/g, '""');
      lines.push(`"${key}","${formattedVal}",${conf},"${prov.replace(/"/g, '""')}"`);
    }

    return lines.join('\n');
  }
}

export const emisAdapter = new StandardEmisExportAdapter();
