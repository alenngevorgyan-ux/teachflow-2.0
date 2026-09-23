import fs from 'fs';
import path from 'path';
import { ClaimJudgeSchema, ExtractedClaimsSchema } from '../../shared/schemas.js';
import { CheckResult, MaterialValidationReport } from '../../shared/types.js';
import { IModelProvider } from '../providers/modelProvider.js';
import { repository } from '../store/repository.js';
import { normalizeArmenianText } from './normalization.js';
import { retrieveChunks } from './retrieval.js';

export async function validateExternalMaterial(
  provider: IModelProvider,
  subject: string,
  grade: number,
  text: string,
  selectedSourceIds?: string[],
  options?: { modelId?: string }
): Promise<MaterialValidationReport> {
  const policyVersion = repository.computePolicyVersion();

  // 1. Split text into items and claims
  const splitPromptTemplate = path.resolve(
    process.cwd(),
    'server/prompts/split_claims.v1.txt'
  );
  let splitPrompt = fs.readFileSync(splitPromptTemplate, 'utf-8');
  splitPrompt = splitPrompt.replace('{{text}}', text);

  const splitRes = await provider.generateStructured(splitPrompt, ExtractedClaimsSchema, {
    modelId: options?.modelId,
    temperature: 0.1,
    actionName: 'splitMaterialClaims',
  });

  const parsedClaims = splitRes.output.claims;
  const sources = repository.getSources();
  const eligibleSources = sources.filter(
    (s) =>
      s.role === 'FACT' &&
      s.status === 'active' &&
      (!selectedSourceIds || selectedSourceIds.includes(s.id))
  );

  const reportClaims: MaterialValidationReport['claims'] = [];
  let unsupportedCount = 0;
  let outOfScopeCount = 0;
  let ruleViolationsCount = 0;

  for (const item of parsedClaims) {
    // 2. Find best matching FACT chunk
    let bestChunk: { id: string; text: string; sourceTitle: string; grades: number[] } | null = null;
    let highestOverlap = -1;

    const normalizedClaim = normalizeArmenianText(item.claimFact || item.stem);
    const claimTerms = normalizedClaim.split(' ').filter((w) => w.length > 2);

    for (const src of eligibleSources) {
      for (const ch of src.chunks) {
        const normChunk = normalizeArmenianText(ch.text);
        let overlap = 0;
        for (const t of claimTerms) {
          if (normChunk.includes(t)) overlap++;
        }
        if (overlap > highestOverlap) {
          highestOverlap = overlap;
          bestChunk = {
            id: ch.id,
            text: ch.text,
            sourceTitle: src.title,
            grades: src.grades,
          };
        }
      }
    }

    const checks: CheckResult[] = [];
    let supportStatus: 'supported' | 'partially_supported' | 'not_supported' = 'not_supported';
    let reason = '';
    let gradeAppropriate = true;

    if (!bestChunk || highestOverlap < 1) {
      supportStatus = 'not_supported';
      reason = 'Հայտարարված փաստը կամ հարցը չի գտնվել համակարգում առկա պաշտոնական ՓԱՍՏԱՑԻ աղբյուրներում:';
      checks.push({
        checkId: 'claim_supported',
        label: 'Փաստացի հիմնավորվածություն (Claim supported)',
        kind: 'llm_judged',
        result: 'fail',
        detail: reason,
      });
      unsupportedCount++;
    } else {
      if (!bestChunk.grades.includes(grade)) {
        gradeAppropriate = false;
        outOfScopeCount++;
        checks.push({
          checkId: 'grade_scope',
          label: 'Դասարանային ծրագրի համապատասխանություն (Grade scope)',
          kind: 'deterministic',
          result: 'warn',
          detail: `Փաստը գտնվել է այլ դասարանի աղբյուրում (${bestChunk.grades.join(', ')}) և չի համապատասխանում ${grade}-րդ դասարանին:`,
        });
      }

      // Run strict claim judge
      try {
        const judgePromptTemplate = path.resolve(
          process.cwd(),
          'server/prompts/claim_judge.v1.txt'
        );
        let judgePrompt = fs.readFileSync(judgePromptTemplate, 'utf-8');
        judgePrompt = judgePrompt
          .replace('{{stem}}', item.stem)
          .replace('{{type}}', item.type || 'question')
          .replace('{{options}}', item.options ? item.options.join(' | ') : 'N/A')
          .replace('{{answerKey}}', item.answerKey || 'N/A')
          .replace('{{chunkText}}', bestChunk.text)
          .replace('{{quote}}', item.claimFact || item.stem);

        const judgeRes = await provider.generateStructured(judgePrompt, ClaimJudgeSchema, {
          modelId: options?.modelId,
          temperature: 0.0,
          actionName: 'validateExternalClaim',
        });

        supportStatus = judgeRes.output.supportStatus;
        reason = judgeRes.output.reason;

        checks.push({
          checkId: 'claim_supported',
          label: 'Փաստացի հիմնավորվածություն (Claim supported)',
          kind: 'llm_judged',
          result: supportStatus === 'supported' ? 'pass' : supportStatus === 'partially_supported' ? 'warn' : 'fail',
          detail: reason,
        });

        if (supportStatus === 'not_supported') {
          unsupportedCount++;
        }
      } catch (err: unknown) {
        console.warn('Judge failed for external claim:', err);
        reason = 'Չհաջողվեց կատարել դատավորի ավտոմատ ստուգումը';
      }
    }

    // Check deterministic rules (e.g. min options for single choice)
    if (item.type === 'single_choice' && item.options && item.options.length < 3) {
      ruleViolationsCount++;
      checks.push({
        checkId: 'rule-min-options',
        label: 'Տարբերակների նվազագույն քանակ (Min 3 options)',
        kind: 'deterministic',
        result: 'fail',
        detail: `Առաջադրանքն ունի ընդամենը ${item.options.length} տարբերակ (պահանջվում է առնվազն 3):`,
      });
    }

    reportClaims.push({
      id: item.id,
      originalText: item.stem,
      matchedChunkId: bestChunk?.id,
      matchedSourceTitle: bestChunk?.sourceTitle,
      supportStatus,
      reason,
      gradeAppropriate,
      checks,
    });
  }

  const report: MaterialValidationReport = {
    id: `val-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    subject,
    grade,
    analyzedAt: new Date().toISOString(),
    policyVersion,
    totalClaims: parsedClaims.length,
    unsupportedClaimsCount: unsupportedCount,
    outOfScopeClaimsCount: outOfScopeCount,
    ruleViolationsCount,
    claims: reportClaims,
  };

  return repository.saveValidationReport(report);
}
