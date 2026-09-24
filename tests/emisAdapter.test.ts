import { describe, expect, it } from 'vitest';
import type { ReportInstance, ThematicPlan } from '../shared/types.js';
import { EMIS_MISSING_VALUE_NOTE, emisAdapter } from '../server/pipeline/emisAdapter.js';

const report = (o: Partial<ReportInstance> = {}): ReportInstance =>
  ({
    id: 'r',
    templateId: 't',
    templateVersion: 'v',
    title: 'T',
    schoolId: 's',
    schoolName: 'S',
    authorRole: 'teacher',
    authorName: 'A',
    subject: 'x',
    grade: 7,
    period: 'term',
    academicYear: null,
    status: 'draft',
    data: { plannedHours: 32, teacherReflection: null, missing: undefined, extracted: '2024-2025' },
    fieldConfidences: { extracted: 0 },
    fieldProvenance: { extracted: 'Քաղված «f.txt» ֆայլից' },
    comments: [],
    timeline: [],
    createdAt: '',
    updatedAt: '',
    ...o,
  }) as ReportInstance;

const rowsOf = (csv: string) => Object.fromEntries(csv.split('\n').filter((l) => l.startsWith('"')).map((l) => [l.split(',')[0].replace(/"/g, ''), l]));

describe('EMIS report export: missing confidence stays unknown', () => {
  it('never invents 1.0 or "System recorded"; a real 0 stays 0', () => {
    const csv = emisAdapter.exportReportCsv(report());
    expect(csv).toContain(EMIS_MISSING_VALUE_NOTE);
    expect(csv).not.toContain('1.0');
    expect(csv).not.toContain('System recorded');
    const r = rowsOf(csv);
    expect(r.plannedHours).toBe('"plannedHours","32",,'); // no confidence, no provenance: empty
    expect(r.extracted).toBe('"extracted","2024-2025",0,"Քաղված «f.txt» ֆայլից"'); // recorded 0 is kept
    expect(r.teacherReflection).toBe('"teacherReflection",,,'); // null value is empty, not "null"
    expect(r.missing).toBe('"missing",,,');
  });
});

describe('EMIS thematic plan export: untaught rows are not 0 hours', () => {
  it('leaves unknown actual hours and taught flag empty', () => {
    const plan = {
      subject: 'x',
      grade: 7,
      schoolName: 'S',
      teacherName: 'T',
      programTargetHours: 4,
      totalAnnualHours: 4,
      rows: [
        { id: '1', topic: 'A', outcomeCodes: ['C1'], plannedHours: 2, weekNumber: 1, plannedDates: 'Շաբաթ 1', hasAssessment: false, taught: true, actualHours: 0 },
        { id: '2', topic: 'B', outcomeCodes: [], plannedHours: 2, weekNumber: 2, plannedDates: 'Շաբաթ 2', hasAssessment: false },
      ],
    } as unknown as ThematicPlan;
    const lines = emisAdapter.exportThematicPlanCsv(plan).split('\n');
    expect(lines.at(-2)).toBe('1,"A","C1",2,"Շաբաթ 1",false,true,0,'); // a recorded 0 stays 0
    expect(lines.at(-1)).toBe('2,"B","",2,"Շաբաթ 2",false,,,'); // unknown: empty
  });
});
