import crypto from 'crypto';
import { Assessment, AssessmentItem, ItemTrace } from '../../shared/types.js';
import { IModelProvider } from '../providers/modelProvider.js';
import { IJudgeProvider } from '../providers/judgeProvider.js';
import { repository } from '../store/repository.js';
import { checkCoverageGate } from './coverage.js';
import { checkVariantEquivalence } from './equivalence.js';
import { generateAssessmentItems } from './generator.js';
import { retrieveChunks } from './retrieval.js';
import { validateAllItems } from './validator.js';

export interface GenerateAssessmentParams {
  subject: string;
  grade: number;
  topic: string;
  selectedSourceIds?: string[];
  provider: IModelProvider;
  modelId?: string;
  generateOnlyCoveredPart?: boolean;
  judgeProvider?: IJudgeProvider;
  judgeConfidenceThreshold?: number;
}

export async function runFullGenerationPipeline(
  params: GenerateAssessmentParams
): Promise<Assessment> {
  const { subject, grade, topic, selectedSourceIds, provider, modelId, generateOnlyCoveredPart } =
    params;
  const assessmentId = `asm-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const policyVersion = repository.computePolicyVersion();

  // Step 1: Retrieval
  const { factChunks, methodChunks } = retrieveChunks(
    subject,
    grade,
    topic,
    selectedSourceIds
  );

  // Step 2: Coverage gate
  const coverage = await checkCoverageGate(provider, subject, grade, topic, factChunks, {
    modelId,
  });

  // If topic not covered AND teacher has NOT explicitly requested "generate only for the covered part"
  if (!coverage.topicCovered && !generateOnlyCoveredPart) {
    const refusedAssessment: Assessment = {
      id: assessmentId,
      subject,
      grade,
      topic,
      selectedSourceIds: selectedSourceIds || factChunks.map((c) => c.sourceId),
      status: 'refused',
      refusalReason:
        coverage.refusalReasonArmenian ||
        `«${topic}» թեման բավարար չափով ներկայացված չէ ընտրված փաստացի աղբյուրներում: Գեներացիան մերժված է:`,
      coverage: {
        topicCovered: false,
        coveredOutcomeCodes: coverage.coveredOutcomeCodes || [],
        missingAspects: coverage.missingAspects || [],
      },
      items: [],
      traces: [],
      variantEquivalence: [],
      createdAt: new Date().toISOString(),
      policyVersion,
    };
    return repository.saveAssessment(refusedAssessment);
  }

  // Step 3: Generation
  const genResult = await generateAssessmentItems(
    provider,
    subject,
    grade,
    topic,
    factChunks,
    methodChunks,
    { modelId }
  );

  // Step 4: Independent Validation (with pluggable JudgeProvider)
  const traces: ItemTrace[] = await validateAllItems(
    genResult.items,
    subject,
    grade,
    provider,
    {
      modelId,
      generationModelId: genResult.modelId,
      judgeProvider: params.judgeProvider,
      judgeConfidenceThreshold: params.judgeConfidenceThreshold,
    }
  );

  // Step 5: Variant Equivalence
  const variantEquivalence = await checkVariantEquivalence(genResult.items, provider, {
    modelId,
  });

  // Determine overall assessment validation status
  const hasFail = traces.some((t) => t.status === 'FAIL');
  const initialStatus = hasFail ? 'draft' : 'validated';

  const assessment: Assessment = {
    id: assessmentId,
    subject,
    grade,
    topic,
    selectedSourceIds: selectedSourceIds || Array.from(new Set(factChunks.map((c) => c.sourceId))),
    status: initialStatus,
    coverage: {
      topicCovered: coverage.topicCovered,
      coveredOutcomeCodes: coverage.coveredOutcomeCodes || [],
      missingAspects: coverage.missingAspects || [],
    },
    items: genResult.items,
    traces,
    variantEquivalence,
    createdAt: new Date().toISOString(),
    policyVersion,
  };

  return repository.saveAssessment(assessment);
}
