import fs from 'fs';
import path from 'path';
import { LessonPlanGenerationOutputSchema } from '../../shared/schemas.js';
import { LessonPlan, LessonPlanCheck } from '../../shared/types.js';
import { IModelProvider, getProvider } from '../providers/modelProvider.js';
import { IJudgeProvider, getJudgeProvider } from '../providers/judgeProvider.js';
import { isQuoteVerbatimInChunk } from './normalization.js';
import { checkCoverageGate } from './coverage.js';
import { retrieveChunks } from './retrieval.js';
import { repository } from '../store/repository.js';

export interface GenerateLessonPlanParams {
  thematicPlanId: string;
  rowId: string;
  durationMinutes?: number;
  provider?: IModelProvider;
  modelId?: string;
  judgeProvider?: IJudgeProvider;
}

export async function generateLessonPlanFromRow(
  params: GenerateLessonPlanParams
): Promise<LessonPlan> {
  const plan = repository.getThematicPlan(params.thematicPlanId);
  if (!plan) {
    throw new Error(`Thematic plan not found: ${params.thematicPlanId}`);
  }

  const row = plan.rows.find((r) => r.id === params.rowId);
  if (!row) {
    throw new Error(`Row not found: ${params.rowId}`);
  }

  const durationMinutes = params.durationMinutes || 45;
  const provider = params.provider || getProvider();
  const judge = params.judgeProvider || getJudgeProvider('gemini');
  const policyVersion = repository.computePolicyVersion();

  // Retrieve FACT chunks for this subject, grade, and topic (real hybrid
  // retrieval — see server/pipeline/retrieval.ts).
  const { factChunks } = await retrieveChunks(plan.subject, plan.grade, row.topic);

  // Same coverage gate the assessment pipeline uses: refuse rather than
  // fabricate a lesson plan for a topic the registered sources don't
  // actually cover.
  const coverage = await checkCoverageGate(provider, plan.subject, plan.grade, row.topic, factChunks, {
    modelId: params.modelId,
  });
  if (!coverage.topicCovered) {
    throw new Error(
      coverage.refusalReasonArmenian ||
        `«${row.topic}» թեման բավարար չափով ներկայացված չէ ընտրված փաստացի աղբյուրներում: Դասի պլանի գեներացումը մերժված է:`
    );
  }

  const factChunksFormatted = factChunks
    .map(
      (c) =>
        `CHUNK ID: ${c.chunk.id} (Source: ${c.sourceTitle}, v${c.version})\nTEXT:\n"${c.chunk.text}"`
    )
    .join('\n\n');

  const promptTemplatePath = path.resolve(process.cwd(), 'server/prompts/lesson_plan.v1.txt');
  let prompt = fs.readFileSync(promptTemplatePath, 'utf-8');
  prompt = prompt
    .replace('{{subject}}', plan.subject)
    .replace('{{grade}}', String(plan.grade))
    .replace('{{topic}}', row.topic)
    .replace('{{durationMinutes}}', String(durationMinutes))
    .replace('{{outcomeCodes}}', row.outcomeCodes.join(', ') || '(n/a)')
    .replace('{{factChunks}}', factChunksFormatted);

  const res = await provider.generateStructured(prompt, LessonPlanGenerationOutputSchema, {
    modelId: params.modelId,
    temperature: 0.2,
    actionName: 'generateLessonPlan',
  });

  // Validate every citation deterministically (chunk exists as a retrieved
  // FACT chunk, quote is verbatim) and, when verbatim, with the judge
  // (claim_supported) — the same "worst wins across every citation" pattern
  // used by the assessment validator (T2).
  const checks: LessonPlanCheck[] = [];
  const factSourcesRef: { sourceId: string; version: string; chunkId: string; page?: number }[] = [];

  for (const cit of res.output.citations) {
    const found = factChunks.find((f) => f.chunk.id === cit.chunkId);
    if (!found) {
      checks.push({
        checkId: 'citation_exists',
        label: 'Մեջբերման առկայություն (Citation exists)',
        kind: 'deterministic',
        result: 'fail',
        detail: `Հղված «${cit.chunkId}» հատվածը առկա չէ ներկայացված ՓԱՍՏԱՑԻ հատվածների շարքում:`,
      });
      continue;
    }

    factSourcesRef.push({
      sourceId: found.sourceId,
      version: found.version,
      chunkId: found.chunk.id,
      page: found.chunk.page,
    });

    const verbatim = isQuoteVerbatimInChunk(cit.quote, found.chunk.text);
    checks.push({
      checkId: 'quote_verbatim',
      label: `Բառացի մեջբերման ստուգում (${found.chunk.id})`,
      kind: 'deterministic',
      result: verbatim ? 'pass' : 'fail',
      detail: verbatim
        ? 'Մեջբերումը 100% բառացիորեն համապատասխանում է աղբյուրի տեքստին:'
        : `Մեջբերված տեքստը («${cit.quote}») բառացիորեն չի գտնվել համապատասխան հատվածում:`,
    });

    if (!verbatim) continue;

    try {
      const verification = await judge.verifyClaim(
        `${row.topic}: ${cit.quote}`,
        found.chunk.text,
        { stem: row.topic }
      );
      const resultForVerdict = { supported: 'pass', partially_supported: 'warn', not_supported: 'fail' } as const;
      checks.push({
        checkId: 'claim_supported',
        label: `Փաստացի հիմնավորվածություն (${found.chunk.id})`,
        kind: 'llm_judged',
        result: resultForVerdict[verification.verdict],
        detail: verification.reason || '',
        confidence: verification.confidence,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      checks.push({
        checkId: 'claim_supported',
        label: `Փաստացի հիմնավորվածություն (Judge Error, ${found.chunk.id})`,
        kind: 'llm_judged',
        result: 'fail',
        detail: `Դատավորի ստուգման խափանում: ${msg}`,
      });
    }
  }

  let status: 'PASS' | 'WARN' | 'FAIL' = 'PASS';
  if (checks.some((c) => c.result === 'fail')) status = 'FAIL';
  else if (checks.some((c) => c.result === 'warn')) status = 'WARN';

  const lessonPlan: LessonPlan = {
    id: `lp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    thematicPlanId: plan.id,
    rowId: row.id,
    subject: plan.subject,
    grade: plan.grade,
    topic: row.topic,
    durationMinutes,
    outcomeCodes: row.outcomeCodes,
    objectives: res.output.objectives,
    requiredMaterials: res.output.requiredMaterials,
    stages: res.output.stages,
    factCitations: res.output.citations.map((c) => {
      const found = factChunks.find((f) => f.chunk.id === c.chunkId);
      return { chunkId: c.chunkId, quote: c.quote, sourceTitle: found?.sourceTitle || 'n/a' };
    }),
    homework: res.output.homework,
    createdAt: new Date().toISOString(),
    trace: {
      factSources: factSourcesRef,
      providerId: res.providerId,
      modelId: res.modelId,
      judgeProviderId: judge.providerId,
      judgeModelId: judge.modelId,
      policyVersion,
      generatedAt: new Date().toISOString(),
      checks,
      status,
    },
  };

  return repository.saveLessonPlan(lessonPlan);
}
