import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportInstance, ReportTemplate } from '../shared/types.js';

const store = vi.hoisted(() => ({
  template: null as ReportTemplate | null,
  saved: [] as ReportInstance[],
}));

vi.mock('../server/store/repository.js', () => ({
  repository: {
    getReportTemplate: () => store.template,
    getReportTemplates: () => (store.template ? [store.template] : []),
    saveReport: (r: ReportInstance) => {
      store.saved.push(r);
      return r;
    },
  },
}));

import { importLegacyReport } from '../server/pipeline/legacyReportImporter.js';
import { getDemoReportTemplates } from '../server/store/demoData.js';
import type { IModelProvider } from '../server/providers/modelProvider.js';

function template(): ReportTemplate {
  return {
    id: 'tpl-1',
    name: { hy: 'Ծրագրի առաջընթաց', ru: 'x', en: 'x' },
    status: 'confirmed',
    period: 'half_year',
    authorRole: 'teacher',
    recipientRole: 'director',
    fields: [
      { key: 'subject', label: { hy: 'Առարկա', ru: 'x' }, type: 'text', source: 'manual', required: true },
      { key: 'grade', label: { hy: 'Դասարան', ru: 'x' }, type: 'number', source: 'manual', required: true },
    ],
    validationRules: [],
    layout: { sections: [] },
    version: 'v1',
  };
}

function providerReturning(output: { fields: unknown[] } | Error): IModelProvider {
  return {
    providerId: 'fake',
    generateStructured: vi.fn(async () => {
      if (output instanceof Error) throw output;
      return {
        output,
        providerId: 'fake',
        modelId: 'fake-model',
        latencyMs: 0,
        requestId: 'r',
      };
    }) as unknown as IModelProvider['generateStructured'],
    generateText: vi.fn() as unknown as IModelProvider['generateText'],
  };
}

beforeEach(() => {
  store.template = template();
  store.saved = [];
});

describe('importLegacyReport error surfacing', () => {
  it('throws a visible error when the extraction model call fails, and saves nothing', async () => {
    const provider = providerReturning(new Error('OPENROUTER_API_KEY is not set'));

    await expect(
      importLegacyReport({
        rawText: 'Առարկան Հայոց պատմություն է, 7-րդ դասարան:',
        fileName: 'old_report.txt',
        templateId: 'tpl-1',
        schoolId: 'sch-1',
        schoolName: 'Դպրոց Ա',
        authorName: 'Ուսուցիչ',
        provider,
      })
    ).rejects.toThrow(/OPENROUTER_API_KEY is not set/);

    expect(store.saved).toHaveLength(0);
  });

  it('does not swallow the failure into an all-null "nothing found" report', async () => {
    const provider = providerReturning(new Error('network timeout'));
    let caught: Error | null = null;
    try {
      await importLegacyReport({
        rawText: 'text',
        fileName: 'f.txt',
        templateId: 'tpl-1',
        schoolId: 'sch-1',
        schoolName: 'Դպրոց Ա',
        authorName: 'Ուսուցիչ',
        provider,
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(store.saved).toHaveLength(0);
  });
});

describe('importLegacyReport successful extraction', () => {
  it('accepts a field whose sourceQuote is verbatim in the document', async () => {
    const rawText = 'Հաշվետվություն: Առարկան Հայոց պատմություն է, 7-րդ դասարան:';
    const provider = providerReturning({
      fields: [
        { key: 'subject', value: 'Հայոց պատմություն', confidence: 0.9, sourceQuote: 'Հայոց պատմություն', lineNumber: 1 },
        { key: 'grade', value: 7, confidence: 0.9, sourceQuote: '7-րդ դասարան', lineNumber: 1 },
      ],
    });

    const report = await importLegacyReport({
      rawText,
      fileName: 'f.txt',
      templateId: 'tpl-1',
      schoolId: 'sch-1',
      schoolName: 'Դպրոց Ա',
      authorName: 'Ուսուցիչ',
      provider,
    });

    expect(report.data.subject).toBe('Հայոց պատմություն');
    expect(report.data.grade).toBe(7);
    expect(report.fieldConfidences?.subject).toBe(0.9);
    expect(store.saved).toHaveLength(1);
  });

  it('zeroes confidence and nulls the value when the sourceQuote is not verbatim in the document', async () => {
    const rawText = 'Հաշվետվություն: Առարկան Հայոց պատմություն է:';
    const provider = providerReturning({
      fields: [
        { key: 'subject', value: 'Ֆիզիկա', confidence: 0.9, sourceQuote: 'Ֆիզիկա', lineNumber: 1 },
      ],
    });

    const report = await importLegacyReport({
      rawText,
      fileName: 'f.txt',
      templateId: 'tpl-1',
      schoolId: 'sch-1',
      schoolName: 'Դպրոց Ա',
      authorName: 'Ուսուցիչ',
      provider,
    });

    expect(report.data.subject).toBeNull();
    expect(report.fieldConfidences?.subject).toBe(0);
  });
});

describe('importLegacyReport invents nothing outside the document', () => {
  it('leaves grade and academicYear null when the document does not state them', async () => {
    const rawText = 'Հաշվետվություն: Առարկան Հայոց պատմություն է:';
    const provider = providerReturning({
      fields: [
        { key: 'subject', value: 'Հայոց պատմություն', confidence: 0.9, sourceQuote: 'Հայոց պատմություն', lineNumber: 1 },
        { key: 'grade', value: null, confidence: 0, sourceQuote: '', lineNumber: 1 },
      ],
    });

    const report = await importLegacyReport({
      rawText,
      fileName: 'f.txt',
      templateId: 'tpl-1',
      schoolId: 'sch-1',
      schoolName: 'Դպրոց Ա',
      authorName: 'Ուսուցիչ',
      provider,
    });

    // Was: grade 0 and academicYear '2026-2027' — both invented.
    expect(report.grade).toBeNull();
    expect(report.academicYear).toBeNull();
  });

  it('uses the extracted grade and academic year when the document does state them', async () => {
    store.template!.fields.push({
      key: 'academicYear',
      label: { hy: 'Ուսումնական տարի', ru: 'x' },
      type: 'text',
      source: 'manual',
      required: true,
    });
    const rawText = '2024-2025 ուսումնական տարի, 7-րդ դասարան:';
    const provider = providerReturning({
      fields: [
        { key: 'grade', value: 7, confidence: 0.9, sourceQuote: '7-րդ դասարան', lineNumber: 1 },
        { key: 'academicYear', value: '2024-2025', confidence: 0.9, sourceQuote: '2024-2025', lineNumber: 1 },
      ],
    });

    const report = await importLegacyReport({
      rawText,
      fileName: 'f.txt',
      templateId: 'tpl-1',
      schoolId: 'sch-1',
      schoolName: 'Դպրոց Ա',
      authorName: 'Ուսուցիչ',
      provider,
    });

    expect(report.grade).toBe(7);
    expect(report.academicYear).toBe('2024-2025');
  });

  it('rejects an unknown template instead of filing the data against the first one', async () => {
    store.template = null;
    const provider = providerReturning({ fields: [] });

    await expect(
      importLegacyReport({
        rawText: 'text',
        fileName: 'f.txt',
        templateId: 'tpl-does-not-exist',
        schoolId: 'sch-1',
        schoolName: 'Դպրոց Ա',
        authorName: 'Ուսուցիչ',
        provider,
      })
    ).rejects.toThrow(/tpl-does-not-exist/);
    expect(store.saved).toHaveLength(0);
  });

  it('stores a real sha256 of the extracted data as dataSnapshotHash', async () => {
    const rawText = 'Առարկան Հայոց պատմություն է:';
    const provider = providerReturning({
      fields: [
        { key: 'subject', value: 'Հայոց պատմություն', confidence: 0.9, sourceQuote: 'Հայոց պատմություն', lineNumber: 1 },
      ],
    });

    const report = await importLegacyReport({
      rawText,
      fileName: 'f.txt',
      templateId: 'tpl-1',
      schoolId: 'sch-1',
      schoolName: 'Դպրոց Ա',
      authorName: 'Ուսուցիչ',
      provider,
    });

    // Was: `hash-${Date.now()}`, which proved nothing about the data.
    expect(report.dataSnapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.dataSnapshotHash).toBe(
      crypto.createHash('sha256').update(JSON.stringify(report.data)).digest('hex')
    );
  });

  it('keeps the academic year with the real tpl-program-progress form, which has no academicYear field', async () => {
    // The form the import modal actually sends. The earlier test added an
    // academicYear field to its own template, which hid that this one has none.
    const real = getDemoReportTemplates().find((t) => t.id === 'tpl-program-progress')!;
    expect(real.fields.some((f) => f.key === 'academicYear')).toBe(false);
    store.template = real;

    const rawText = '2024-2025 ուսումնական տարի, 7-րդ դասարան, Հայոց պատմություն:';
    const provider = providerReturning({
      fields: [
        { key: 'subject', value: 'Հայոց պատմություն', confidence: 0.9, sourceQuote: 'Հայոց պատմություն', lineNumber: 1 },
        { key: 'grade', value: 7, confidence: 0.9, sourceQuote: '7-րդ դասարան', lineNumber: 1 },
        { key: 'academicYear', value: '2024-2025', confidence: 0.9, sourceQuote: '2024-2025', lineNumber: 1 },
      ],
    });

    const report = await importLegacyReport({
      rawText,
      fileName: 'f.txt',
      templateId: 'tpl-program-progress',
      schoolId: 'sch-1',
      schoolName: 'Դպրոց Ա',
      authorName: 'Ուսուցիչ',
      provider,
    });

    expect(report.academicYear).toBe('2024-2025');
    expect(report.grade).toBe(7);
    expect(report.subject).toBe('Հայոց պատմություն');
    // The form's data stays exactly the form's fields.
    expect('academicYear' in report.data).toBe(false);
    // The model was asked for the year even though the form lacks the field.
    const prompt = (provider.generateStructured as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as string;
    expect(prompt).toContain('"academicYear"');
  });

  it('still drops a metadata value whose quote is not verbatim in the document', async () => {
    store.template = getDemoReportTemplates().find((t) => t.id === 'tpl-program-progress')!;
    const provider = providerReturning({
      fields: [{ key: 'academicYear', value: '2025-2026', confidence: 0.9, sourceQuote: '2025-2026', lineNumber: 1 }],
    });

    const report = await importLegacyReport({
      rawText: '2024-2025 ուսումնական տարի:',
      fileName: 'f.txt',
      templateId: 'tpl-program-progress',
      schoolId: 'sch-1',
      schoolName: 'Դպրոց Ա',
      authorName: 'Ուսուցիչ',
      provider,
    });

    expect(report.academicYear).toBeNull();
  });

  it('records quote and confidence for metadata that is not a form field', async () => {
    store.template = getDemoReportTemplates().find((t) => t.id === 'tpl-program-progress')!;
    const provider = providerReturning({
      fields: [{ key: 'academicYear', value: '2024-2025', confidence: 0, sourceQuote: '2024-2025', lineNumber: 1 }],
    });

    const report = await importLegacyReport({
      rawText: '2024-2025 ուսումնական տարի:',
      fileName: 'f.txt',
      templateId: 'tpl-program-progress',
      schoolId: 'sch-1',
      schoolName: 'Դպրոց Ա',
      authorName: 'Ուսուցիչ',
      provider,
    });

    // The value is kept (the quote is verbatim), but its uncertainty and
    // source travel with it so the UI routes it to manual confirmation.
    expect(report.academicYear).toBe('2024-2025');
    expect(report.fieldConfidences?.academicYear).toBe(0);
    expect(report.fieldProvenance?.academicYear).toContain('2024-2025');
    expect('academicYear' in report.data).toBe(false);
  });
});
