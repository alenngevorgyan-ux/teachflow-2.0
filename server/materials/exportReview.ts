import type { MaterialReview } from '../../shared/types.js';
import { repository } from '../store/repository.js';
import { reviewStatus } from './reviewService.js';
import { loadWorkingCopy } from './workingCopy.js';

const STATUS_HY: Record<string, string> = {
  pass: 'անցել է',
  fail: 'ձախողվել է',
  needs_review: 'պահանջում է որոշում',
  not_evaluated: 'չի ստուգվել',
};

/** The corrected copy at the current revision. The original upload is never modified. */
export async function exportReviewDocx(review: MaterialReview): Promise<Buffer> {
  const w = await loadWorkingCopy(review);
  return w.export();
}

export function correctedFileName(review: MaterialReview): string {
  const base = review.fileName.replace(/\.docx$/i, '');
  return `${base} (ուղղված${reviewStatus(review).final ? '' : ', սևագիր'}).docx`;
}

/**
 * The separate change list that goes with the corrected copy: what changed
 * and why, what is still open, and every limitation of this review.
 */
export async function buildChangeList(review: MaterialReview): Promise<string> {
  const w = await loadWorkingCopy(review);
  const status = reviewStatus(review);
  const items = review.segmentation?.items ?? [];
  const itemNo = (id: string) => items.find((i) => i.id === id)?.number ?? id;
  const L: string[] = [];

  L.push('TeachFlow — փոփոխությունների ցանկ');
  L.push('');
  L.push(`Ֆայլ՝ ${review.fileName} (SHA-256 ${review.fileSha256})`);
  L.push(`Տարբերակ՝ ${review.revision}`);
  L.push(`Առարկա՝ ${review.subject}, ${review.grade}-րդ դասարան`);
  L.push('');
  if (status.final) {
    L.push('Կարգավիճակ՝ բոլոր ստուգումներն անցել են այս տարբերակի համար:');
  } else {
    L.push('Կարգավիճակ՝ ՍԵՎԱԳԻՐ — կան չստուգված կամ չլուծված կետեր:');
    for (const r of status.reasons) L.push(`  • ${r}`);
  }
  L.push('');

  L.push('Օգտագործված աղբյուրներ (միայն ընտրվածները)՝');
  if (review.selectedSources.length === 0) L.push('  — ընտրված չեն. բովանդակային ստուգումները չեն կատարվել:');
  for (const sel of review.selectedSources) {
    const s = repository.getSource(sel.sourceId);
    const who = s?.confirmation ? `հաստատել է՝ ${s.confirmation.confirmedByName} (նշված անուն, ոչ ստուգված ինքնություն)` : 'հաստատում չկա';
    L.push(`  • ${s?.title ?? sel.sourceId}, տարբերակ ${sel.version} — ${sel.purpose === 'program' ? 'ծրագիր/չափորոշիչ' : 'ՓԱՍՏԱՑԻ'}; ${who}`);
  }
  L.push('');

  const accepted = review.suggestions.filter((s) => s.status === 'accepted');
  L.push(`Կատարված փոփոխություններ (${accepted.length})՝`);
  if (accepted.length === 0) L.push('  — չկան:');
  for (const [n, s] of accepted.entries()) {
    L.push(`  ${n + 1}. Հարց ${itemNo(s.itemId)}${s.editedByTeacher ? ' (տեքստը խմբագրել է ուսուցիչը)' : ''}`);
    for (const p of s.group.patches) {
      const para = w.doc.paragraphs.find((x) => x.id === p.paragraphId);
      L.push(`     «${p.expected}» → «${p.replacement}» (պարբերություն ${para ? para.index + 1 : p.paragraphId})`);
    }
    if (s.keyChange) L.push(`     Նոր ճիշտ պատասխան՝ ${s.keyChange.join(', ')}`);
    L.push(`     Պատճառ՝ ${s.rationale}`);
    for (const e of s.evidence ?? []) L.push(`     Աղբյուր՝ ${e.chunkId}${e.page ? `, էջ ${e.page}` : ''}: «${e.text}»`);
    L.push(`     Վերստուգում՝ ${s.recheck === 'done' ? 'կատարված' : 'դեռ չի կատարվել'}`);
  }
  L.push('');

  const rejected = review.suggestions.filter((s) => s.status === 'rejected');
  if (rejected.length) {
    L.push('Մերժված առաջարկներ (համապատասխան ստուգումների արդյունքը չի փոխվել)՝');
    for (const s of rejected) L.push(`  • Հարց ${itemNo(s.itemId)}: ${s.rationale}`);
    L.push('');
  }

  L.push('Բաց կետեր՝');
  let open = 0;
  for (const item of items) {
    const r = review.results.find((x) => x.itemId === item.id);
    if (!r) { L.push(`  • Հարց ${item.number}: չի ստուգվել:`); open++; continue; }
    if (r.stale || r.revision !== review.revision) { L.push(`  • Հարց ${item.number}: ստուգումը հնացել է:`); open++; }
    for (const c of r.checks) {
      if (c.status === 'pass') continue;
      L.push(`  • Հարց ${item.number} · ${c.checkId} · ${STATUS_HY[c.status]}: ${c.detail}`);
      open++;
    }
  }
  if (open === 0) L.push('  — չկան:');
  if (review.segmentation?.problems.length) {
    L.push('  Բաժանման ժամանակ չընդունված մասեր՝');
    for (const p of review.segmentation.problems) L.push(`    – ${p}`);
  }
  L.push('');

  L.push('Սահմանափակումներ՝');
  for (const p of review.preservation) L.push(`  • ${p.note}${p.textChecked ? '' : ' (անձնական տվյալների ստուգում չի կատարվել)'}`);
  const unchecked = review.privacy.uncheckable;
  if (unchecked.length) L.push(`  • Չկարդացված մասեր (անձնական տվյալների ստուգում չի կատարվել)՝ ${unchecked.map((u) => u.part).join(', ')}`);
  L.push('  • Էջի դասավորությունը TeachFlow-ը չի ստուգում. տեքստի երկարության փոփոխությունը կարող է տեղաշարժել աղյուսակներն ու էջերի սահմանները: Բացեք ֆայլը Word-ում և ստուգեք:');
  L.push('  • TeachFlow-ի նախադիտումը պարբերություններով է և Word-ի ճշգրիտ պատկերը չէ:');
  L.push('  • Ուղղումները փոխում են միայն տեքստը. ձևավորումը վերցվում է փոփոխված հատվածի առաջին հատվածից:');
  L.push('');
  return L.join('\n');
}
