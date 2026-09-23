import fs from 'fs';
import path from 'path';
import { CoverageCheckResult, CoverageCheckSchema } from '../../shared/schemas.js';
import { IModelProvider } from '../providers/modelProvider.js';
import { repository } from '../store/repository.js';
import { RetrievedChunk } from './retrieval.js';

export async function checkCoverageGate(
  provider: IModelProvider,
  subject: string,
  grade: number,
  topic: string,
  factChunks: RetrievedChunk[],
  options?: { modelId?: string }
): Promise<CoverageCheckResult> {
  // If no FACT chunks exist at all for this subject and grade, immediately refuse deterministically
  if (!factChunks || factChunks.length === 0) {
    return {
      topicCovered: false,
      coveredOutcomeCodes: [],
      missingAspects: [
        'Համակարգում բացակայում են այս դասարանի և առարկայի համար հաստատված ՓԱՍՏԱՑԻ աղբյուրները:',
      ],
      refusalReasonArmenian: `«${topic}» թեմայի վերաբերյալ ${grade}-րդ դասարանի «${subject}» առարկայի համար համակարգում չկան հաստատված փաստացի աղբյուրներ: Գեներացիան մերժված է:`,
    };
  }

  // Load outcomes
  const confirmedOutcomes = repository.getConfirmedOutcomes(subject, grade);
  const outcomesFormatted = confirmedOutcomes.length > 0
    ? confirmedOutcomes.map((o) => `[${o.code}] ${o.text}`).join('\n')
    : '(Պաշտոնական հաստատված վերջնարդյունքներ գրանցված չեն)';

  // Format fact source chunks
  const factSourcesFormatted = factChunks
    .map(
      (c) =>
        `CHUNK ID: ${c.chunk.id} (Source: ${c.sourceTitle}, v${c.version}, page: ${c.chunk.page ?? 1})\nTEXT: ${c.chunk.text}`
    )
    .join('\n\n');

  // Load prompt template
  const promptTemplatePath = path.resolve(process.cwd(), 'server/prompts/coverage_gate.v1.txt');
  let prompt = fs.readFileSync(promptTemplatePath, 'utf-8');
  prompt = prompt
    .replace('{{subject}}', subject)
    .replace('{{grade}}', String(grade))
    .replace('{{topic}}', topic)
    .replace('{{factSources}}', factSourcesFormatted)
    .replace('{{outcomes}}', outcomesFormatted);

  try {
    const res = await provider.generateStructured(prompt, CoverageCheckSchema, {
      modelId: options?.modelId,
      temperature: 0.0,
      actionName: 'coverageGateCheck',
    });

    return res.output;
  } catch (err: unknown) {
    console.error('Coverage gate call failed:', err);
    throw err;
  }
}
