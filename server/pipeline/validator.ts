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
import { repository } from '../store/repository.js';
import { isQuoteVerbatimInChunk } from './normalization.js';

export async function validateSingleItem(
  item: AssessmentItem,
  subject: string,
  grade: number,
  provider: IModelProvider,
  options?: { modelId?: string }
): Promise<{ trace: ItemTrace; status: 'PASS' | 'WARN' | 'FAIL' }> {
  const sources = repository.getSources();
  const activeRules = repository.getActiveRules();
  const policyVersion = repository.computePolicyVersion();

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
  let primaryFactChunkText = '';
  let primaryQuote = '';

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
          if (!primaryFactChunkText) {
            primaryFactChunkText = chunk.text;
            primaryQuote = cit.quote;
          }
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

  // 5. Deterministic MethodRules
  for (const rule of activeRules.filter((r) => r.kind === 'deterministic')) {
    if (rule.id === 'rule-min-options' && (item.type === 'single_choice' || item.type === 'multiple_choice')) {
      const minOpt = (rule.params?.min_options as number) || 3;
      if (!item.options || item.options.length < minOpt) {
        checks.push({
          checkId: rule.id,
          label: rule.title,
          kind: 'deterministic',
          result: rule.severity === 'error' ? 'fail' : 'warn',
          detail: `Առաջադրանքն ունի ${item.options?.length || 0} տարբերակ, պահանջվում է առնվազն ${minOpt}:`,
        });
        continue;
      }
    }

    if (rule.id === 'rule-allowed-item-types') {
      const allowed = (rule.params?.allowed_types as string[]) || [];
      if (allowed.length > 0 && !allowed.includes(item.type)) {
        checks.push({
          checkId: rule.id,
          label: rule.title,
          kind: 'deterministic',
          result: rule.severity === 'error' ? 'fail' : 'warn',
          detail: `«${item.type}» տեսակը թույլատրված չէ մեթոդական կանոններով:`,
        });
        continue;
      }
    }
  }

  // 6. LLM Judge: claim_supported (Separate call, strict judge)
  if (primaryFactChunkText) {
    try {
      const claimJudgePromptTemplate = path.resolve(
        process.cwd(),
        'server/prompts/claim_judge.v1.txt'
      );
      let claimPrompt = fs.readFileSync(claimJudgePromptTemplate, 'utf-8');
      claimPrompt = claimPrompt
        .replace('{{stem}}', item.stem)
        .replace('{{type}}', item.type)
        .replace('{{options}}', item.options ? item.options.join(' | ') : 'N/A')
        .replace('{{answerKey}}', String(item.answerKey))
        .replace('{{chunkText}}', primaryFactChunkText)
        .replace('{{quote}}', primaryQuote);

      const judgeRes = await provider.generateStructured(claimPrompt, ClaimJudgeSchema, {
        modelId: options?.modelId,
        temperature: 0.0,
        actionName: 'claimJudge',
      });

      if (judgeRes.output.supportStatus === 'supported') {
        checks.push({
          checkId: 'claim_supported',
          label: 'Փաստացի հիմնավորվածություն (Claim supported by source)',
          kind: 'llm_judged',
          result: 'pass',
          detail: judgeRes.output.reason || 'Հարցը և պատասխանը լիովին հիմնավորված են աղբյուրի տեքստով:',
        });
      } else if (judgeRes.output.supportStatus === 'partially_supported') {
        checks.push({
          checkId: 'claim_supported',
          label: 'Փաստացի հիմնավորվածություն (Claim supported by source)',
          kind: 'llm_judged',
          result: 'warn',
          detail: `Մասամբ հիմնավորված: ${judgeRes.output.reason}`,
        });
      } else {
        checks.push({
          checkId: 'claim_supported',
          label: 'Փաստացի հիմնավորվածություն (Claim supported by source)',
          kind: 'llm_judged',
          result: 'fail',
          detail: `Անհիմն փաստ: ${judgeRes.output.reason}`,
        });
      }
    } catch (err: unknown) {
      console.warn('Claim judge check failed:', err);
      checks.push({
        checkId: 'claim_supported',
        label: 'Փաստացի հիմնավորվածություն (Claim judge)',
        kind: 'llm_judged',
        result: 'warn',
        detail: 'Չհաջողվեց կատարել դատավորի ստուգումը (LLM call error):',
      });
    }
  } else {
    checks.push({
      checkId: 'claim_supported',
      label: 'Փաստացի հիմնավորվածություն (Claim supported)',
      kind: 'llm_judged',
      result: 'fail',
      detail: 'Առաջադրանքը չունի վավեր ՓԱՍՏԱՑԻ աղբյուրի տեքստ ստուգման համար:',
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
    console.warn('Language judge check failed:', err);
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
    } catch (err: unknown) {
      console.warn(`Rule judge failed for ${rule.id}:`, err);
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
    methodRulesApplied: activeRules.map((r) => r.id),
    providerId: provider.providerId,
    modelId: options?.modelId || 'gemini-3.8-flash',
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
  options?: { modelId?: string }
): Promise<ItemTrace[]> {
  const traces: ItemTrace[] = [];
  for (const item of items) {
    const { trace } = await validateSingleItem(item, subject, grade, provider, options);
    traces.push(trace);
  }
  return traces;
}
