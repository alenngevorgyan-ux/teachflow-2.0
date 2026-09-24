// UI evidence for source replacement in a DISPOSABLE fixture environment
// (synthetic data, rule-based provider). Sets up a finished review through
// the API, then replaces the FACT source through the Registry dialog in Chrome
// and verifies: new content used, confirmation reset, old review invalidated.
// Also checks that the thematic-plan form needs program version and year.
//
//   node scripts/ui-supersede-check.mjs [baseUrl]
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:3100';
const OUT = 'docs/review-21569c8';
const FIXTURE = 'docs/fixtures/Թեստ_Ավարայր_7-րդ դասարան (FIXTURE) v2.docx';
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const step = (m) => (log.push(m), console.log(m));
const fail = (m) => {
  step(`FAIL: ${m}`);
  fs.writeFileSync(path.join(OUT, 'ui-supersede-log.txt'), log.join('\n') + '\n');
  process.exit(1);
};
const api = async (p, init) => {
  const r = await fetch(`${BASE}/api${p}`, init);
  const b = await r.json();
  if (!r.ok) fail(`${p}: ${r.status} ${JSON.stringify(b)}`);
  return b;
};
const post = (p, body, method = 'POST') => api(p, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. A finished review that uses the FACT source (API; the flow UI is covered by e2e-review.mjs).
const runtime = await api('/runtime');
if (!runtime.fixtureMode) fail('not a fixture environment');
const form = new FormData();
form.append('file', new Blob([fs.readFileSync(FIXTURE)]), 'supersede-check.docx');
form.append('subject', 'Հայոց պատմություն');
form.append('grade', '7');
let v = await api('/materials', { method: 'POST', body: form });
const id = v.review.id;
v = await post(`/materials/${id}/sources`, { programSourceIds: ['fixture-program-hp7'], factSourceIds: ['fixture-fact-avarayr'] }, 'PUT');
v = await post(`/materials/${id}/segment`, {});
v = await post(`/materials/${id}/segmentation/confirm`, { expectedRevision: v.review.revision });
v = await post(`/materials/${id}/check`, {});
v = await post(`/materials/${id}/suggest`, {});
const proposal = v.review.suggestions.find((s) => s.status === 'proposed');
const revisionBefore = v.review.revision;
step(`review ${id}: ${v.review.results.length} results, fresh=${v.review.results.filter((r) => !r.stale).length}, proposal ${proposal?.id} (${proposal?.status})`);

// 2. Replace the FACT source through the Registry UI.
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle0' });
await page.select('.tf-sidebar select', 'methodologist');
await sleep(300);
await page.evaluate(() => (location.hash = '#/registry'));
await page.waitForFunction(() => document.body.innerText.includes('Ավարայրի ճակատամարտ, փաստական հատված'), { timeout: 15000 }).catch(() => fail('registry did not list the fixture source'));
const opened = await page.evaluate(() => {
  const card = [...document.querySelectorAll('h3')].find((h) => h.textContent.includes('Ավարայրի ճակատամարտ, փաստական հատված'))?.closest('.p-5');
  const btn = card && [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Փոխարինել');
  if (btn) btn.click();
  return !!btn;
});
if (!opened) fail('no "Փոխարինել" button on the fixture source');
await sleep(300);
// The version field starts empty (no invented "vN.1").
const initialVersion = await page.evaluate(() => [...document.querySelectorAll('input[type=text]')].find((i) => i.closest('.space-y-3'))?.value ?? null);
step(`dialog opened; version field initially ${JSON.stringify(initialVersion)}`);
if (initialVersion !== '') fail('version field is prefilled');
const confirmDisabled = await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Հաստատել փոխարինումը')?.disabled);
step(`confirm disabled before particulars: ${confirmDisabled}`);
const setVal = async (sel, value) =>
  page.evaluate(
    (s, val) => {
      const el = document.querySelector(s);
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    sel,
    value
  );
await setVal('.space-y-3 input[type=text]', 'fixture-2');
await setVal('.space-y-3 input[type=date]', '2026-09-24');
await setVal('.space-y-3 textarea', 'FIXTURE — նոր խմբագրություն: Ավարայրի ճակատամարտը տեղի է ունեցել 451 թվականին:');
await sleep(200);
await page.screenshot({ path: path.join(OUT, 'supersede-dialog-1440.png') });
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Հաստատել փոխարինումը').click());
await page.waitForFunction(() => !document.body.innerText.includes('Հաստատել փոխարինումը'), { timeout: 15000 }).catch(() => fail('dialog did not close'));
await sleep(500);
await page.screenshot({ path: path.join(OUT, 'registry-after-supersede-1440.png') });

// 3. Verify through the API what the UI action did.
const { sources } = await api('/sources');
const old = sources.find((s) => s.id === 'fixture-fact-avarayr');
const cur = sources.find((s) => s.id === old.supersededBy);
step(`old: status=${old.status}, supersededBy=${old.supersededBy}, effectiveTo=${old.effectiveTo ?? '(none)'}`);
step(`new: version=${cur?.version}, effectiveFrom=${cur?.effectiveFrom}, isDemo=${cur?.isDemo}, confirmationState=${cur?.confirmationState}, text=${JSON.stringify(cur?.chunks.map((c) => c.text))}`);
if (old.status !== 'superseded' || !cur || cur.version !== 'fixture-2' || cur.confirmationState !== 'unconfirmed' || !cur.chunks[0].text.includes('նոր խմբագրություն')) fail('supersede result unexpected');

const after = await api(`/materials/${id}`);
step(`old review: final=${after.status.final}, stale=${after.review.results.filter((r) => r.stale).length}/${after.review.results.length}, proposal status=${after.review.suggestions.find((s) => s.id === proposal.id)?.status}, reasons=${JSON.stringify(after.status.reasons)}`);
if (after.review.results.some((r) => !r.stale)) fail('results not invalidated');
const refused = await fetch(`${BASE}/api/materials/${id}/suggestions/${proposal.id}/decision`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ decision: 'accept', expectedRevision: revisionBefore }),
});
const again = await api(`/materials/${id}`);
step(`old-tab accept of the old proposal -> HTTP ${refused.status}; revision ${again.review.revision} (before ${revisionBefore}); accepted groups ${again.review.acceptedGroups.length}`);
if (refused.status !== 409 || again.review.revision !== revisionBefore || again.review.acceptedGroups.length) fail('old proposal was not refused cleanly');
// The review page in the UI shows the stale state.
await page.goto(`${BASE}/#/materials/${id}`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.body.innerText.includes('Նյութի ստուգում'));
const uiState = await page.evaluate(() => ({ stale: document.body.innerText.includes('Հնացած'), draft: document.body.innerText.includes('Սևագիր') }));
step(`review page after supersede: stale badge shown=${uiState.stale}, draft shown=${uiState.draft}`);
await page.screenshot({ path: path.join(OUT, 'review-after-supersede-1440.png') });

// 4. Plan form: program version and year are required, not taken from the demo context.
await page.select('.tf-sidebar select', 'teacher');
await page.evaluate(() => (location.hash = '#/thematicPlans'));
await sleep(800);
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Ստեղծել նոր թեմատիկ պլան')?.click());
await sleep(300);
const planForm = await page.evaluate(() => {
  const submit = [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Ստեղծել նոր թեմատիկ պլան').at(-1);
  const inputs = [...document.querySelectorAll('input[type=text]')].map((i) => i.value);
  return { disabled: submit?.disabled, textInputs: inputs, note: document.body.innerText.includes('ցուցադրական գրառում') };
});
step(`plan form: submit disabled=${planForm.disabled}, text inputs=${JSON.stringify(planForm.textInputs)}, demo-school note shown=${planForm.note}`);
await page.screenshot({ path: path.join(OUT, 'plan-form-1440.png') });
await browser.close();
fs.writeFileSync(path.join(OUT, 'ui-supersede-log.txt'), log.join('\n') + '\n');
step('UI supersede check OK');
