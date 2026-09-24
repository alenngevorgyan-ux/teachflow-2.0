import fs from 'fs';
import path from 'path';
import {
  ClaimJudgeSchema,
  LanguageJudgeSchema,
  RuleJudgeSchema,
} from '../../shared/schemas.js';
import {
  AssessmentItem,
  CheckResult,
  ItemTrace,
  MethodRule,
  Source,
} from '../../shared/types.js';
import { IModelProvider } from '../providers/modelProvider.js';
import { IJudgeProvider, getJudgeProvider } from '../providers/judgeProvider.js';
import { repository } from '../store/repository.js';
import { isQuoteVerbatimInChunk } from './normalization.js';

export interface ValidationOptions {
  modelId?: string;
  // The model id actually returned by the generation call for these items (not the
  // requested id), recorded in the trace. Falls back to `modelId` / provider default.
  generationModelId?: string;
  judgeProvider?: IJudgeProvider;
  judgeConfidenceThreshold?: number; // default 0.8
  // Item count per variant across the whole assessment, used to enforce rule-max-items.
  // Supplied by validateAllItems; single-item revalidation callers should pass it too.
  variantItemCounts?: Record<string, number>;
}

export async function validateSingleItem(
  item: AssessmentItem,
  subject: string,
  grade: number,
  provider: IModelProvider,
  options?: ValidationOptions
): Promise<{ trace: ItemTrace; status: 'PASS' | 'WARN' | 'FAIL' }> {
  const sources = repository.getSources();
  const activeRules = repository.getActiveRules();
  const policyVersion = repository.computePolicyVersion();

  const judge = options?.judgeProvider || getJudgeProvider('gemini');
  const confidenceThreshold = options?.judgeConfidenceThreshold ?? 0.8;

  const checks: CheckResult[] = [];
  const factSourcesRef: {
    sourceId: string;
    version: string;
    chunkId: string;
    page?: number;
  }[] = [];

  // Helper to find chunk across all sources
  const findChunk = (chunkId: string) => {
    for (const src of sources) {
      const chunk = src.chunks.find((c) => c.id === chunkId);
      if (chunk) return { chunk, source: src };
    }
    return null;
  };

  // 1. Check citation_exists (deterministic)
  let allCitationsExist = true;
  if (!item.citations || item.citations.length === 0) {
    checks.push({
      checkId: 'citation_exists',
      label: 'Մեջբերման առկայություն (Citations exist)',
      kind: 'deterministic',
      result: 'fail',
      detail: 'Առաջադրանքը չունի որևէ հղում աղբյուրի հատվածին (chunkId):',
    });
    allCitationsExist = false;
  } else {
    for (const cit of item.citations) {
      const found = findChunk(cit.chunkId);
      if (!found) {
        checks.push({
          checkId: 'citation_exists',
          label: 'Մեջբերման առկայություն (Citation exists)',
          kind: 'deterministic',
          result: 'fail',
          detail: `Նշված ${cit.chunkId} հատվածը գոյություն չունի համակարգի բազայում:`,
        });
        allCitationsExist = false;
      }
    }
    if (allCitationsExist) {
      checks.push({
        checkId: 'citation_exists',
        label: 'Մեջբերման առկայություն (Citation exists)',
        kind: 'deterministic',
        result: 'pass',
        detail: 'Բոլոր հղված chunkId-ները առկա են հաստատված աղբյուրներում:',
      });
    }
  }

  // 2. Check citation_is_fact_source (deterministic)
  // Catches METHOD / TEMPLATE contamination or wrong grade / inactive
  let isFactSourcePass = true;
  const factCitationsForJudge: { chunkId: string; quote: string; chunkText: string }[] = [];

  if (item.citations && item.citations.length > 0) {
    for (const cit of item.citations) {
      const found = findChunk(cit.chunkId);
      if (found) {
        const { source, chunk } = found;
        if (source.role !== 'FACT') {
          isFactSourcePass = false;
          checks.push({
            checkId: 'citation_is_fact_source',
            label: 'Մեջբերումը ՓԱՍՏԱՑԻ աղբյուրից (Fact source enforcement)',
            kind: 'deterministic',
            result: 'fail',
            detail: `Աղբյուրների շփոթում. Հղված «${source.title}» աղբյուրը հանդիսանում է ${source.role} (մեթոդական/ձևանմուշ), ոչ թե ՓԱՍՏ (FACT): Առաջադրանքի փաստերը պետք է բխեն բացառապես ՓԱՍՏԱՑԻ աղբյուրներից:`,
          });
        } else if (source.status !== 'active') {
          isFactSourcePass = false;
          checks.push({
            checkId: 'citation_is_fact_source',
            label: 'Աղբյուրի ակտիվ կարգավիճակ (Source active)',
            kind: 'deterministic',
            result: 'fail',
            detail: `Հղված «${source.title}» աղբյուրը ակտիվ չէ (${source.status}):`,
          });
        } else if (!source.grades.includes(grade)) {
          isFactSourcePass = false;
          checks.push({
            checkId: 'citation_is_fact_source',
            label: 'Դասարանի համապատասխանություն (Grade match)',
            kind: 'deterministic',
            result: 'fail',
            detail: `Աղբյուրի դասարանը (${source.grades.join(', ')}) չի ներառում ընթացիկ ${grade}-րդ դասարանը:`,
          });
        } else {
          factSourcesRef.push({
            sourceId: source.id,
            version: source.version,
            chunkId: chunk.id,
            page: chunk.page,
          });
          factCitationsForJudge.push({
            chunkId: chunk.id,
            quote: cit.quote,
            chunkText: chunk.text,
          });
        }
      }
    }
  }

  if (isFactSourcePass && allCitationsExist) {
    checks.push({
      checkId: 'citation_is_fact_source',
      label: 'Մեջբերումը ՓԱՍՏԱՑԻ աղբյուրից (Fact source enforcement)',
      kind: 'deterministic',
      result: 'pass',
      detail: 'Բոլոր մեջբերումները կատարված են ակտիվ, համապատասխան դասարանի ՓԱՍՏԱՑԻ աղբյուրներից:',
    });
  }

  // 3. Check quote_verbatim (deterministic)
  // Quote is found in the chunk text after Armenian-aware normalization
  let quoteVerbatimPass = true;
  if (item.citations && item.citations.length > 0) {
    for (const cit of item.citations) {
      const found = findChunk(cit.chunkId);
      if (found) {
        const isVerbatim = isQuoteVerbatimInChunk(cit.quote, found.chunk.text);
        if (!isVerbatim) {
          quoteVerbatimPass = false;
          checks.push({
            checkId: 'quote_verbatim',
            label: 'Բառացի մեջբերման ստուգում (Verbatim quote match)',
            kind: 'deterministic',
            result: 'fail',
            detail: `Մեջբերված տեքստը («${cit.quote}») բառացիորեն չի գտնվել համապատասխան հատվածում (${cit.chunkId}) հայերենի նորմալացումից հետո:`,
          });
        }
      }
    }
  }
  if (quoteVerbatimPass && allCitationsExist) {
    checks.push({
      checkId: 'quote_verbatim',
      label: 'Բառացի մեջբերման ստուգում (Verbatim quote match)',
      kind: 'deterministic',
      result: 'pass',
      detail: 'Մեջբերումը 100% բառացիորեն համապատասխանում է աղբյուրի տեքստին:',
    });
  }

  // 4. Check answer_key_valid (deterministic)
  let answerKeyValidPass = true;
  if (!item.answerKey || (typeof item.answerKey === 'string' && !item.answerKey.trim())) {
    checks.push({
      checkId: 'answer_key_valid',
      label: 'Պատասխանի վավերականություն (Answer key valid)',
      kind: 'deterministic',
      result: 'fail',
      detail: 'Առաջադրանքը չունի լրացված ճիշտ պատասխան:',
    });
    answerKeyValidPass = false;
  } else if (item.type === 'single_choice') {
    if (!item.options || item.options.length < 2) {
      checks.push({
        checkId: 'answer_key_valid',
        label: 'Պատասխանի տարբերակներ (Options exist)',
        kind: 'deterministic',
        result: 'fail',
        detail: 'Մեկ ընտրությամբ առաջադրանքը չունի բավարար պատասխանի տարբերակներ:',
      });
      answerKeyValidPass = false;
    } else {
      // Options must be distinct
      const uniqueOptions = new Set(item.options.map((o) => o.trim().toLowerCase()));
      if (uniqueOptions.size !== item.options.length) {
        checks.push({
          checkId: 'answer_key_valid',
          label: 'Տարբերակների տարբերակելիություն (Distinct options)',
          kind: 'deterministic',
          result: 'fail',
          detail: 'Պատասխանի տարբերակներում կան կրկնվող տողեր:',
        });
        answerKeyValidPass = false;
      }
      // Answer key must match one of the options
      const akStr = String(item.answerKey).trim();
      const matchesOption = item.options.some((opt) => opt.trim() === akStr);
      if (!matchesOption) {
        checks.push({
          checkId: 'answer_key_valid',
          label: 'Ճիշտ պատասխանի համապատասխանություն (Answer key matches option)',
          kind: 'deterministic',
          result: 'fail',
          detail: `Ճիշտ պատասխանը («${akStr}») չի համընկնում տրված տարբերակներից ոչ մեկի հետ:`,
        });
        answerKeyValidPass = false;
      }
    }
  }

  if (answerKeyValidPass) {
    checks.push({
      checkId: 'answer_key_valid',
      label: 'Պատասխանի վավերականություն (Answer key valid)',
      kind: 'deterministic',
      result: 'pass',
      detail: 'Ճիշտ պատասխանը առկա է, եզակի է և համապատասխանում է տարբերակներին:',
    });
  }

  // 5. Deterministic MethodRules. Every active deterministic rule is either
  // evaluated here (and leaves a check with its id, pass or not) or reported
  // as "not checked": a rule id with no evaluator can no longer be skipped
  // silently (as 'rule-min-options' was, while the seed defines
  // 'rule-single-correct-answer').
  const rulesEvaluated: string[] = [];
  const rulesNotEvaluated: string[] = [];
  const posInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;
  const ruleCheck = (rule: MethodRule, ok: boolean, detail: string) => {
    rulesEvaluated.push(rule.id);
    checks.push({
      checkId: rule.id,
      label: rule.title,
      kind: 'deterministic',
      result: ok ? 'pass' : rule.severity === 'error' ? 'fail' : 'warn',
      detail,
    });
  };
  const misconfigured = (rule: MethodRule, why: string) => {
    rulesNotEvaluated.push(rule.id);
    checks.push({
      checkId: rule.id,
      label: rule.title,
      kind: 'deterministic',
      result: 'warn',
      detail: `Կանոնը չի ստուգվել. ${why}`,
    });
  };

  for (const rule of activeRules.filter((r) => r.kind === 'deterministic')) {
    switch (rule.id) {
      // Option count. The seeded rule is for single-choice items (params
      // minOptions / maxOptions); 'rule-min-options' (min_options) is kept for
      // rules created earlier and also covers multiple choice. No default.
      case 'rule-single-correct-answer':
      case 'rule-min-options': {
        const applies = rule.id === 'rule-single-correct-answer' ? item.type === 'single_choice' : item.type === 'single_choice' || item.type === 'multiple_choice';
        if (!applies) break;
        const min = rule.params?.minOptions ?? rule.params?.min_options;
        const max = rule.params?.maxOptions ?? rule.params?.max_options;
        if (!posInt(min) || (max !== undefined && (!posInt(max) || max < min))) {
          misconfigured(rule, 'տարբերակների նվազագույն/առավելագույն քանակը (minOptions / maxOptions) բացակայում է կամ սխալ է:');
          break;
        }
        const n = item.options?.length ?? 0;
        const ok = n >= min && (max === undefined || n <= (max as number));
        ruleCheck(rule, ok, max === undefined ? `${n} տարբերակ, պահանջվում է առնվազն ${min}:` : `${n} տարբերակ, պահանջվում է ${min}–${max}:`);
        break;
      }
      case 'rule-factual-grounding': {
        const min = rule.params?.minCitations;
        if (!posInt(min)) {
          misconfigured(rule, 'minCitations արժեքը բացակայում է կամ սխալ է:');
          break;
        }
        const n = item.citations?.length ?? 0;
        ruleCheck(rule, n >= min, `${n} մեջբերում, պահանջվում է առնվազն ${min}:`);
        break;
      }
      case 'rule-allowed-item-types': {
        const allowed = rule.params?.allowed_types;
        if (!Array.isArray(allowed) || allowed.length === 0) {
          misconfigured(rule, 'թույլատրված տեսակների ցանկը (allowed_types) դատարկ է:');
          break;
        }
        ruleCheck(rule, allowed.includes(item.type), allowed.includes(item.type) ? `«${item.type}» տեսակը թույլատրված է:` : `«${item.type}» տեսակը թույլատրված չէ մեթոդական կանոններով:`);
        break;
      }
      case 'rule-max-items': {
        const maxItems = rule.params?.max_items;
        if (!posInt(maxItems)) {
          misconfigured(rule, 'max_items արժեքը բացակայում է կամ սխալ է:');
          break;
        }
        if (!options?.variantItemCounts) {
          misconfigured(rule, 'տարբերակի առաջադրանքների քանակը հայտնի չէ (առանձին վերստուգում):');
          break;
        }
        const countInVariant = options.variantItemCounts[item.variant] ?? 1;
        ruleCheck(rule, countInVariant <= maxItems, `«${item.variant}» տարբերակն ունի ${countInVariant} առաջադրանք, թույլատրվում է առավելագույնը ${maxItems}:`);
        break;
      }
      default:
        misconfigured(rule, `«${rule.id}» կանոնի համար կանոնային ստուգիչ չկա:`);
    }
  }

  // 6. Pluggable Judge: claim_supported for EVERY FACT citation (worst verdict wins)
  let judgeVerificationConfidence: number | undefined = undefined;

  if (factCitationsForJudge.length > 0) {
    for (const fc of factCitationsForJudge) {
      try {
        const claimText = `${item.stem} (Ճիշտ պատասխան: ${String(item.answerKey)}). Մեջբերում: ${fc.quote}`;
        const verification = await judge.verifyClaim(claimText, fc.chunkText, {
          stem: item.stem,
          options: item.options,
          answerKey: String(item.answerKey),
        });

        // Worst-wins: keep the lowest confidence seen across all judged citations.
        judgeVerificationConfidence =
          judgeVerificationConfidence === undefined
            ? verification.confidence
            : Math.min(judgeVerificationConfidence, verification.confidence);

        const resultForVerdict: Record<typeof verification.verdict, 'pass' | 'warn' | 'fail'> = {
          supported: 'pass',
          partially_supported: 'warn',
          not_supported: 'fail',
        };
        const detailForVerdict: Record<typeof verification.verdict, string> = {
          supported: verification.reason || 'Հարցը և պատասխանը լիովին հիմնավորված են աղբյուրի տեքստով:',
          partially_supported: `Մասամբ հիմնավորված: ${verification.reason}`,
          not_supported: `Անհիմն փաստ: ${verification.reason}`,
        };

        checks.push({
          checkId: 'claim_supported',
          label: `Փաստացի հիմնավորվածություն (${fc.chunkId})`,
          kind: 'llm_judged',
          result: resultForVerdict[verification.verdict],
          detail: detailForVerdict[verification.verdict],
          judgeProviderId: judge.providerId,
          judgeModelId: judge.modelId,
          confidence: verification.confidence,
        });

        // Check configurable confidence threshold (default 0.8)
        // Items with judge confidence below threshold go to the methodologist review queue
        if (verification.confidence < confidenceThreshold) {
          checks.push({
            checkId: 'judge_confidence_threshold',
            label: `Դատավորի վստահության շեմ (${fc.chunkId})`,
            kind: 'llm_judged',
            result: 'warn',
            detail: `Դատավորի վստահությունը (${verification.confidence.toFixed(2)}) ցածր է սահմանված շեմից (${confidenceThreshold}): Առաջադրանքն ուղարկված է մեթոդիստի ստուգման հերթ (Review Queue):`,
            judgeProviderId: judge.providerId,
            judgeModelId: judge.modelId,
            confidence: verification.confidence,
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('Judge verifyClaim failed:', msg);
        // SPEC: Never silently switch judge! If judge fails (e.g. TypeSafe Jev missing key), record visible error check
        checks.push({
          checkId: 'claim_supported',
          label: `Փաստացի հիմնավորվածություն (Judge Error, ${fc.chunkId})`,
          kind: 'llm_judged',
          result: 'fail',
          detail: `Դատավորի ստուգման խափանում: ${msg}`,
          judgeProviderId: judge.providerId,
          judgeModelId: judge.modelId,
        });
      }
    }
  } else {
    checks.push({
      checkId: 'claim_supported',
      label: 'Փաստացի հիմնավորվածություն (Claim supported)',
      kind: 'llm_judged',
      result: 'fail',
      detail: 'Առաջադրանքը չունի վավեր ՓԱՍՏԱՑԻ աղբյուրի տեքստ ստուգման համար:',
      judgeProviderId: judge.providerId,
      judgeModelId: judge.modelId,
    });
  }

  // 7. LLM Judge: armenian_language_check (warning severity)
  try {
    const langPromptTemplate = path.resolve(
      process.cwd(),
      'server/prompts/language_judge.v1.txt'
    );
    let langPrompt = fs.readFileSync(langPromptTemplate, 'utf-8');
    langPrompt = langPrompt
      .replace('{{stem}}', item.stem)
      .replace('{{options}}', item.options ? item.options.join(' | ') : 'N/A')
      .replace('{{answerKey}}', String(item.answerKey));

    const langRes = await provider.generateStructured(langPrompt, LanguageJudgeSchema, {
      modelId: options?.modelId,
      temperature: 0.0,
      actionName: 'languageJudge',
    });

    if (langRes.output.hasIssues && langRes.output.issues.length > 0) {
      const issueDetails = langRes.output.issues
        .map((i) => `[${i.category}] "${i.flaggedText}": ${i.explanation}`)
        .join('; ');
      checks.push({
        checkId: 'armenian_language_check',
        label: 'Հայերենի և տերմինաբանության ստուգում (Armenian language check)',
        kind: 'llm_judged',
        result: 'warn',
        detail: `Լեզվական/տերմինաբանական դիտողություններ: ${issueDetails}`,
      });
    } else {
      checks.push({
        checkId: 'armenian_language_check',
        label: 'Հայերենի և տերմինաբանության ստուգում (Armenian language check)',
        kind: 'llm_judged',
        result: 'pass',
        detail: 'Տեքստը համապատասխանում է գրական հայերենի և առարկայական տերմինաբանության նորմերին:',
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('Language judge check failed:', msg);
    // SPEC: A failed judge call must produce a visible check, not a silent skip.
    checks.push({
      checkId: 'armenian_language_check',
      label: 'Հայերենի և տերմինաբանության ստուգում (Language Judge Error)',
      kind: 'llm_judged',
      result: 'fail',
      detail: `Լեզվական ստուգման խափանում: ${msg}`,
    });
  }

  // 8. LLM Judged Method Rules
  for (const rule of activeRules.filter((r) => r.kind === 'llm_judged')) {
    try {
      const rulePromptTemplate = path.resolve(
        process.cwd(),
        'server/prompts/rule_judge.v1.txt'
      );
      let rulePrompt = fs.readFileSync(rulePromptTemplate, 'utf-8');
      rulePrompt = rulePrompt
        .replace('{{ruleTitle}}', rule.title)
        .replace('{{ruleDescription}}', rule.description)
        .replace('{{ruleParams}}', JSON.stringify(rule.params))
        .replace('{{stem}}', item.stem)
        .replace('{{type}}', item.type)
        .replace('{{options}}', item.options ? item.options.join(' | ') : 'N/A')
        .replace('{{answerKey}}', String(item.answerKey))
        .replace('{{difficulty}}', item.difficulty);

      const rRes = await provider.generateStructured(rulePrompt, RuleJudgeSchema, {
        modelId: options?.modelId,
        temperature: 0.0,
        actionName: `ruleJudge:${rule.id}`,
      });

      checks.push({
        checkId: rule.id,
        label: rule.title,
        kind: 'llm_judged',
        result: rRes.output.result,
        detail: rRes.output.detail,
      });
      // A validated verdict (pass or fail) means the rule was evaluated.
      rulesEvaluated.push(rule.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Rule judge failed for ${rule.id}:`, msg);
      // The call failed: the rule was not evaluated (the error stays visible below).
      rulesNotEvaluated.push(rule.id);
      // SPEC: A failed judge call must produce a visible check, not a silent skip.
      checks.push({
        checkId: rule.id,
        label: `${rule.title} (Judge Error)`,
        kind: 'llm_judged',
        result: rule.severity === 'error' ? 'fail' : 'warn',
        detail: `Կանոնի ստուգման խափանում: ${msg}`,
      });
    }
  }

  // Determine overall item status:
  // FAIL if any check with result === 'fail'
  // WARN if any check with result === 'warn' (and no fail)
  // PASS otherwise
  let overallStatus: 'PASS' | 'WARN' | 'FAIL' = 'PASS';
  if (checks.some((c) => c.result === 'fail')) {
    overallStatus = 'FAIL';
  } else if (checks.some((c) => c.result === 'warn')) {
    overallStatus = 'WARN';
  }

  const trace: ItemTrace = {
    itemId: item.id,
    factSources: factSourcesRef,
    // Only rules that were actually evaluated (deterministic here, llm_judged by the rule judge).
    // Only rules that produced a result: deterministic evaluators and LLM
    // rules whose judge returned a validated verdict. Failed calls are in
    // methodRulesNotEvaluated.
    methodRulesApplied: rulesEvaluated,
    methodRulesNotEvaluated: rulesNotEvaluated,
    providerId: provider.providerId,
    modelId: options?.generationModelId || options?.modelId || provider.defaultModelId || 'n/a',
    judgeProviderId: judge.providerId,
    judgeModelId: judge.modelId,
    confidence: judgeVerificationConfidence,
    policyVersion,
    generatedAt: new Date().toISOString(),
    checks,
    status: overallStatus,
  };

  return { trace, status: overallStatus };
}

export async function validateAllItems(
  items: AssessmentItem[],
  subject: string,
  grade: number,
  provider: IModelProvider,
  options?: ValidationOptions
): Promise<ItemTrace[]> {
  const variantItemCounts: Record<string, number> = {};
  for (const item of items) {
    variantItemCounts[item.variant] = (variantItemCounts[item.variant] || 0) + 1;
  }

  const traces: ItemTrace[] = [];
  for (const item of items) {
    const { trace } = await validateSingleItem(item, subject, grade, provider, {
      ...options,
      variantItemCounts,
    });
    traces.push(trace);
  }
  return traces;
}
