import crypto from 'crypto';
import { ReportField, ReportInstance, ReportTemplate } from '../../shared/types.js';
import { IModelProvider, getProvider } from '../providers/modelProvider.js';
import { repository } from '../store/repository.js';
import { assertNoPii } from './privacyGuard.js';
import { UserInputError } from './errors.js';
import { z } from 'zod';

export interface LegacyImportParams {
  rawText: string;
  fileName: string;
  templateId: string;
  schoolId: string;
  schoolName: string;
  authorName: string;
  provider?: IModelProvider;
  modelId?: string;
}

const FieldExtractionSchema = z.object({
  key: z.string(),
  value: z.union([z.string(), z.number(), z.array(z.any()), z.null()]).optional(),
  confidence: z.number().min(0).max(1).optional(),
  sourceQuote: z.string().optional(),
  lineNumber: z.number().int().optional(),
});

const ExtractionResponseSchema = z.object({
  fields: z.array(FieldExtractionSchema),
});

export async function importLegacyReport(params: LegacyImportParams): Promise<ReportInstance> {
  const { rawText, fileName, templateId, schoolId, schoolName, authorName, modelId } = params;
  // Check before the text reaches a model or the store.
  assertNoPii(rawText, 'legacyImport.rawText');
  // An unknown template id is a client error. Falling back to "the first
  // template" would file the imported data against a form nobody asked for.
  const template = repository.getReportTemplate(templateId);
  if (!template) {
    throw new UserInputError(`Անհայտ հաշվետվության ձևանմուշ՝ «${templateId}»:`);
  }

  const extractedData: Record<string, any> = {};
  const fieldConfidences: Record<string, number> = {};
  const fieldProvenance: Record<string, string> = {};

  const lines = rawText.split('\n');
  const linesWithNumbers = lines
    .map((line, idx) => `${idx + 1}: ${line}`)
    .join('\n');

  const provider = params.provider || getProvider();
  const extractionMap = new Map<string, z.infer<typeof FieldExtractionSchema>>();

  const prompt = `You are a curriculum report data extractor. Extract values for the specified report fields from the document text below.
DO NOT fabricate or guess any values. If a field is not explicitly mentioned or clearly derivable from the text, set value to null and confidence to 0.

Template fields to extract:
${template.fields
  .map(
    (f) =>
      `- Key: "${f.key}", Label: "${f.label.hy}", Type: "${f.type}", Required: ${f.required ? 'true' : 'false'}, Description: "${f.description || ''}"`
  )
  .join('\n')}

Document Text (with 1-indexed line numbers):
${linesWithNumbers}

Instructions:
1. For each field in the template, return:
   - "key": exact field key
   - "value": the extracted value (string, number, array of strings, or null). NEVER fabricate default numbers or subjects!
   - "confidence": confidence score from 0.0 to 1.0 (0.0 if not found or uncertain)
   - "sourceQuote": exact verbatim excerpt from the document text that contains this value (must match the document text exactly). If not found, use empty string.
   - "lineNumber": the 1-indexed line number in the document where the excerpt begins.
2. Return JSON format: {"fields": [...]}`;

  try {
    const res = await provider.generateStructured(prompt, ExtractionResponseSchema, {
      modelId,
      actionName: 'legacy_report_import',
      systemInstruction:
        'You are an uncompromising educational data extraction system. Do not fabricate, hallucinate, or extrapolate default values. If data is missing from the text, report value as null and confidence as 0.',
    });

    for (const f of res.output.fields) {
      extractionMap.set(f.key, f);
    }
  } catch (err: unknown) {
    // SPEC: A failed extraction call must surface as a visible error, not
    // silently produce a report where every field looks like "not found in
    // the document" — that's indistinguishable from a genuinely empty legacy
    // file and would hide a real model/provider outage from the teacher.
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Ներմուծման քաղվածքի մոդելային կանչը ձախողվեց («${fileName}»): ${msg} Հաշվետվությունը չի ստեղծվել. փորձեք կրկին:`
    );
  }

  // Deterministic validation of extracted fields
  for (const field of template.fields) {
    const extracted = extractionMap.get(field.key);
    let value: any = null;
    let confidence = 0;
    let provenance = 'Չի հայտնաբերվել բնօրինակում (պահանջվում է ձեռքով հաստատում)';

    if (extracted && extracted.value !== undefined && extracted.value !== null && extracted.value !== '') {
      const rawQuote = (extracted.sourceQuote || '').trim();
      // Deterministic check: verify sourceQuote exists in rawText
      const quoteExists = rawQuote.length > 0 && rawText.includes(rawQuote);

      if (!quoteExists) {
        // Deterministic failure: quote does not exist in rawText -> confidence 0, manual confirmation
        confidence = 0;
        value = null;
        provenance = `Մեջբերումը չգտնվեց բնօրինակում («${rawQuote}»): վստահություն՝ 0, պահանջվում է ձեռքով հաստատում`;
      } else {
        confidence = extracted.confidence ?? 0;
        value = extracted.value;

        if (field.type === 'number') {
          const num = Number(value);
          if (isNaN(num)) {
            value = null;
            confidence = 0;
            provenance = `Թվային արժեքը չճանաչվեց: վստահություն՝ 0, պահանջվում է ձեռքով հաստատում`;
          } else {
            value = num;
          }
        }

        const lineStr = extracted.lineNumber ? ` (տող ${extracted.lineNumber})` : '';
        provenance = `Քաղված «${fileName}» ֆայլից${lineStr}: «${rawQuote}»`;
      }
    }

    extractedData[field.key] = value;
    fieldConfidences[field.key] = confidence;
    fieldProvenance[field.key] = provenance;
  }

  const gradeRaw = extractedData.grade;
  const gradeNum = typeof gradeRaw === 'number' ? gradeRaw : typeof gradeRaw === 'string' && gradeRaw.trim() !== '' ? Number(gradeRaw) : NaN;
  const extractedGrade = Number.isInteger(gradeNum) && gradeNum > 0 ? gradeNum : null;

  const yearRaw = extractedData.academicYear;
  const extractedAcademicYear = typeof yearRaw === 'string' && yearRaw.trim() !== '' ? yearRaw.trim() : null;

  const reportId = `rep-imported-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const importedReport: ReportInstance = {
    id: reportId,
    templateId: template.id,
    templateVersion: template.version,
    title: `Ներմուծված հաշվետվություն (${fileName})`,
    schoolId,
    schoolName,
    authorRole: template.authorRole,
    authorName,
    subject: extractedData.subject || '',
    // Nothing here is assumed: a grade or an academic year the document does
    // not state stays null and is shown as "n/a" for manual confirmation.
    // Grade 0 and the current year were both invented values.
    grade: extractedGrade,
    period: template.period,
    academicYear: extractedAcademicYear,
    status: 'draft',
    data: extractedData,
    fieldConfidences,
    fieldProvenance,
    comments: [],
    timeline: [
      {
        action: 'legacy_imported',
        actor: authorName,
        timestamp: new Date().toISOString(),
        note: `Ֆայլ «${fileName}» ներմուծվել է (պահանջվում է ձեռքով հաստատում չճանաչված դաշտերի համար)`,
      },
    ],
    isLegacyImported: true,
    importedFromLegacy: true,
    legacySourceFile: fileName,
    // A real hash of what was extracted, so a later change to the data is
    // detectable. `hash-<timestamp>` proved nothing.
    dataSnapshotHash: crypto.createHash('sha256').update(JSON.stringify(extractedData)).digest('hex'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return repository.saveReport(importedReport);
}
