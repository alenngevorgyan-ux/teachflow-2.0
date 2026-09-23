import fs from 'fs';
import path from 'path';
import { AssessmentGenerationOutputSchema } from '../../shared/schemas.js';
import { AssessmentItem } from '../../shared/types.js';
import { IModelProvider, ProviderResponse } from '../providers/modelProvider.js';
import { repository } from '../store/repository.js';
import { RetrievedChunk } from './retrieval.js';

export interface GenerationResult {
  items: AssessmentItem[];
  modelId: string;
  providerId: string;
  latencyMs: number;
  rawPrompt: string;
}

export async function generateAssessmentItems(
  provider: IModelProvider,
  subject: string,
  grade: number,
  topic: string,
  factChunks: RetrievedChunk[],
  methodChunks: RetrievedChunk[],
  options?: { modelId?: string; temperature?: number }
): Promise<GenerationResult> {
  const confirmedOutcomes = repository.getConfirmedOutcomes(subject, grade);
  const outcomesFormatted =
    confirmedOutcomes.length > 0
      ? confirmedOutcomes.map((o) => `[${o.code}] ${o.text}`).join('\n')
      : '(Վերջնարդյունքներ սահմանված չեն)';

  const activeRules = repository.getActiveRules();
  const methodRulesFormatted = activeRules
    .map((r) => `- [${r.id}] ${r.title} (${r.kind}): ${r.description}`)
    .join('\n');

  const factChunksFormatted = factChunks
    .map(
      (c) =>
        `CHUNK ID: ${c.chunk.id} (Source: ${c.sourceTitle}, v${c.version})\nTEXT:\n"${c.chunk.text}"`
    )
    .join('\n\n');

  const methodChunksFormatted =
    methodChunks.length > 0
      ? methodChunks
          .map(
            (c) =>
              `CHUNK ID: ${c.chunk.id} (Source: ${c.sourceTitle}, v${c.version})\nMETHOD GUIDELINE:\n"${c.chunk.text}"`
          )
          .join('\n\n')
      : '(Մեթոդական լրացուցիչ աղբյուրներ չկան: Հետևեք ընդհանուր կանոններին)';

  const promptTemplatePath = path.resolve(process.cwd(), 'server/prompts/generate_items.v1.txt');
  let prompt = fs.readFileSync(promptTemplatePath, 'utf-8');
  prompt = prompt
    .replace('{{subject}}', subject)
    .replace('{{grade}}', String(grade))
    .replace('{{topic}}', topic)
    .replace('{{factChunks}}', factChunksFormatted)
    .replace('{{methodChunks}}', methodChunksFormatted)
    .replace('{{outcomes}}', outcomesFormatted)
    .replace('{{methodRules}}', methodRulesFormatted);

  const res: ProviderResponse<{ items: AssessmentItem[] }> = await provider.generateStructured(
    prompt,
    AssessmentGenerationOutputSchema,
    {
      modelId: options?.modelId,
      temperature: options?.temperature !== undefined ? options?.temperature : 0.2,
      actionName: 'generateAssessmentItems',
    }
  );

  return {
    items: res.output.items,
    modelId: res.modelId,
    providerId: res.providerId,
    latencyMs: res.latencyMs,
    rawPrompt: prompt,
  };
}
