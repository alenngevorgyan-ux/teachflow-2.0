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
