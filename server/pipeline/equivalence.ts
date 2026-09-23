import fs from 'fs';
import path from 'path';
import { EquivalenceJudgeSchema } from '../../shared/schemas.js';
import { AssessmentItem, CheckResult } from '../../shared/types.js';
import { IModelProvider } from '../providers/modelProvider.js';

export async function checkVariantEquivalence(
  items: AssessmentItem[],
  provider: IModelProvider,
  options?: { modelId?: string }
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const itemsA = items.filter((i) => i.variant === 'A');
  const itemsB = items.filter((i) => i.variant === 'B');

  // 1. Deterministic check: Item count equivalence
  if (itemsA.length !== itemsB.length) {
    results.push({
      checkId: 'variant_item_count_match',
      label: 'Առաջադրանքների քանակի հավասարություն (Item count parity)',
      kind: 'deterministic',
      result: 'fail',
      detail: `Տարբերակ Ա-ն ունի ${itemsA.length} հարց, իսկ Տարբերակ Բ-ն՝ ${itemsB.length} հարց:`,
    });
  } else {
    results.push({
      checkId: 'variant_item_count_match',
      label: 'Առաջադրանքների քանակի հավասարություն (Item count parity)',
      kind: 'deterministic',
      result: 'pass',
      detail: `Երկու տարբերակներն էլ ունեն նույն քանակությամբ հարցեր (${itemsA.length}):`,
    });
  }

  // 2. Deterministic check: Item type distribution match
  const countTypes = (list: AssessmentItem[]) => {
    const map: Record<string, number> = {};
    for (const item of list) {
      map[item.type] = (map[item.type] || 0) + 1;
    }
    return map;
  };
  const typesA = countTypes(itemsA);
  const typesB = countTypes(itemsB);
  let typesMatch = true;
  const allTypeKeys = Array.from(new Set([...Object.keys(typesA), ...Object.keys(typesB)]));
  for (const t of allTypeKeys) {
    if ((typesA[t] || 0) !== (typesB[t] || 0)) {
      typesMatch = false;
      break;
    }
  }

  if (!typesMatch) {
    results.push({
      checkId: 'variant_type_distribution',
      label: 'Առաջադրանքների տեսակների համապատասխանություն (Type distribution)',
      kind: 'deterministic',
      result: 'warn',
      detail: `Տեսակների բաշխումը տարբերվում է. Տարբերակ Ա: ${JSON.stringify(typesA)}, Տարբերակ Բ: ${JSON.stringify(typesB)}:`,
    });
  } else {
    results.push({
      checkId: 'variant_type_distribution',
      label: 'Առաջադրանքների տեսակների համապատասխանություն (Type distribution)',
      kind: 'deterministic',
      result: 'pass',
      detail: 'Առաջադրանքների տեսակները (ընտրովի, կարճ, բաց) լիովին համաչափ են:',
    });
  }

  // 3. Deterministic check: Difficulty distribution match
  const countDiff = (list: AssessmentItem[]) => {
    const map: Record<string, number> = {};
    for (const item of list) {
      map[item.difficulty] = (map[item.difficulty] || 0) + 1;
    }
    return map;
  };
  const diffA = countDiff(itemsA);
  const diffB = countDiff(itemsB);
  let diffMatch = true;
  for (const d of ['basic', 'medium', 'advanced']) {
    if ((diffA[d] || 0) !== (diffB[d] || 0)) {
      diffMatch = false;
      break;
    }
  }

  if (!diffMatch) {
    results.push({
      checkId: 'variant_difficulty_distribution',
      label: 'Բարդության մակարդակների բաշխվածություն (Difficulty distribution)',
      kind: 'deterministic',
      result: 'warn',
      detail: `Բարդության մակարդակների բաշխվածությունը տարբեր է. Տարբերակ Ա: ${JSON.stringify(diffA)}, Տարբերակ Բ: ${JSON.stringify(diffB)}:`,
    });
  } else {
    results.push({
      checkId: 'variant_difficulty_distribution',
      label: 'Բարդության մակարդակների բաշխվածություն (Difficulty distribution)',
      kind: 'deterministic',
      result: 'pass',
      detail: 'Բարդության մակարդակները (հիմնական, միջին, առաջադեմ) նույնական են երկու տարբերակներում:',
    });
  }

  // 4. LLM Judge on overall cognitive comparable difficulty
  if (itemsA.length > 0 && itemsB.length > 0) {
    try {
      const promptTemplatePath = path.resolve(
        process.cwd(),
        'server/prompts/equivalence_judge.v1.txt'
      );
      let prompt = fs.readFileSync(promptTemplatePath, 'utf-8');
      const formatVariant = (list: AssessmentItem[]) =>
        list
          .map(
            (i, idx) =>
              `${idx + 1}. [${i.type} / ${i.difficulty}] ${i.stem} (Ճիշտ: ${i.answerKey})`
          )
          .join('\n');

      prompt = prompt
        .replace('{{variantA}}', formatVariant(itemsA))
        .replace('{{variantB}}', formatVariant(itemsB));

      const judgeRes = await provider.generateStructured(prompt, EquivalenceJudgeSchema, {
        modelId: options?.modelId,
        temperature: 0.0,
        actionName: 'variantEquivalenceJudge',
      });

      results.push({
        checkId: 'variant_llm_psychometric_equivalence',
        label: 'Մանկավարժական և ճանաչողական համարժեքություն (Psychometric equivalence)',
        kind: 'llm_judged',
        result: judgeRes.output.result,
        detail: `${judgeRes.output.detail} (Բարդություն: ${judgeRes.output.difficultyComparison}; Բովանդակություն: ${judgeRes.output.contentBalance})`,
      });
    } catch (err: unknown) {
      console.warn('Equivalence judge call failed:', err);
    }
  }

  return results;
}
