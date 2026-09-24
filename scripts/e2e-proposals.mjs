// Dumps what the last fixture E2E review actually proposed and accepted
// (from .fixture-data), for docs/e2e/proposals.txt.   node scripts/e2e-proposals.mjs
import fs from 'fs';
const id = /mat-[a-z0-9]+-[a-z0-9]+/.exec(fs.readFileSync('docs/e2e/e2e-log.txt', 'utf8'))[0];
const store = JSON.parse(fs.readFileSync('.fixture-data/teachflow_store.json', 'utf8'));
const r = store.materialReviews.find((x) => x.id === id);
const out = [`review ${id}  revision ${r.revision}  accepted groups ${r.acceptedGroups.length}`];
for (const s of r.suggestions) {
  out.push(`suggestion ${s.id}  status=${s.status}  item=${s.itemId}  keyChange=${JSON.stringify(s.keyChange ?? null)}  keyBefore=${JSON.stringify(s.keyBefore ?? null)}  recheck=${s.recheck ?? '-'}  model=${s.model.providerId}/${s.model.modelId}`);
  for (const p of s.group.patches) out.push(`  text patch ${p.id}: paragraph ${p.paragraphId} [${p.start},${p.end}) ${JSON.stringify(p.expected)} -> ${JSON.stringify(p.replacement)} (base ${p.baseRevision})`);
}
for (const g of r.acceptedGroups) out.push(`accepted group ${g.id}: ${g.patches.length} patch(es) in ${[...new Set(g.patches.map((p) => p.paragraphId))].join(', ')}`);
for (const k of r.answerKey) out.push(`answer key ${k.itemId}: ${JSON.stringify(k.optionLabels)} (${k.origin}${k.span ? `, ${k.span.paragraphId} [${k.span.start},${k.span.end})` : ''})`);
fs.writeFileSync('docs/e2e/proposals.txt', out.join('\n') + '\n');
console.log(out.join('\n'));
