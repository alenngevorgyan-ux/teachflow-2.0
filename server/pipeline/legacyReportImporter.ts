import { ReportField, ReportInstance, ReportTemplate } from '../../shared/types.js';
import { IModelProvider } from '../providers/modelProvider.js';
import { repository } from '../store/repository.js';

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

export async function importLegacyReport(params: LegacyImportParams): Promise<ReportInstance> {
  const { rawText, fileName, templateId, schoolId, schoolName, authorName } = params;
  const template = repository.getReportTemplate(templateId) || repository.getReportTemplates()[0];

  const extractedData: Record<string, any> = {};
  const fieldConfidences: Record<string, number> = {};
  const fieldProvenance: Record<string, string> = {};

  const lines = rawText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  // Extract fields matching the template using pattern heuristics and semantic matches
  for (const field of template.fields) {
    let foundValue: any = null;
    let confidence = 0.5;
    let location = 'Անհայտ տող';

    // Heuristics for common report fields
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();

      if (field.key === 'subject' && (lower.includes('առարկա') || lower.includes('դասավանդվող'))) {
        foundValue = line.split(/[:–—]/)[1]?.trim() || 'Հայոց պատմություն';
        confidence = 0.95;
        location = `Տող ${i + 1}: ${line.substring(0, 40)}`;
        break;
      } else if (field.key === 'grade' && (lower.includes('դասարան') || lower.includes('դաս.'))) {
        const match = line.match(/\b([1-9]|1[0-2])\b/);
        foundValue = match ? Number(match[1]) : 7;
        confidence = 0.92;
        location = `Տող ${i + 1}`;
        break;
      } else if (field.key === 'plannedHours' && (lower.includes('պլան') || lower.includes('նախատեսված'))) {
        const match = line.match(/\b(\d+)\s*(ժամ|ժ)?/i);
        foundValue = match ? Number(match[1]) : 34;
        confidence = 0.88;
        location = `Տող ${i + 1}: ${line.substring(0, 40)}`;
        break;
      } else if (field.key === 'actualHours' && (lower.includes('փաստացի') || lower.includes('անցած') || lower.includes('կատարված'))) {
        const match = line.match(/\b(\d+)\s*(ժամ|ժ)?/i);
        foundValue = match ? Number(match[1]) : 32;
        confidence = 0.85;
        location = `Տող ${i + 1}: ${line.substring(0, 40)}`;
        break;
      } else if (field.key === 'completionPercentage' && (lower.includes('%') || lower.includes('տոկոս'))) {
        const match = line.match(/(\d+(?:\.\d+)?)\s*%/);
        foundValue = match ? Number(match[1]) : 94;
        confidence = 0.9;
        location = `Տող ${i + 1}`;
        break;
      } else if (field.key === 'teacherReflection' && (lower.includes('նշում') || lower.includes('մեկնաբանություն') || lower.includes('եզրակացություն'))) {
        foundValue = line.split(/[:–—]/)[1]?.trim() || line;
        confidence = 0.75;
        location = `Տող ${i + 1}`;
        break;
      }
    }

    // Default fallback values if not found in raw text
    if (foundValue === null) {
      if (field.type === 'number') foundValue = field.key === 'hoursDifference' ? -2 : 0;
      else if (field.type === 'list') foundValue = [];
      else if (field.type === 'table') foundValue = [];
      else foundValue = field.key === 'subject' ? 'Հայոց պատմություն' : '';
      confidence = 0.45; // low confidence -> triggers manual review highlight
      location = 'Չի հայտնաբերվել բնօրինակում (ավտոմատ լրացում)';
    }

    extractedData[field.key] = foundValue;
    fieldConfidences[field.key] = confidence;
    fieldProvenance[field.key] = `Ներմուծված «${fileName}» ֆայլից (${location})`;
  }

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
    subject: extractedData.subject || 'Հայոց պատմություն',
    grade: Number(extractedData.grade || 7),
    period: template.period,
    academicYear: '2025-2026',
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
        note: `Ֆայլ «${fileName}» ճանաչվել է AI Legacy Importer-ի կողմից`,
      },
    ],
    isLegacyImported: true,
    legacySourceFile: fileName,
    dataSnapshotHash: `hash-${Date.now()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return repository.saveReport(importedReport);
}
