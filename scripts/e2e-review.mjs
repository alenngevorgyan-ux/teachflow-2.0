// Deterministic end-to-end UI run against the labelled FIXTURE server
// (rule-based provider, synthetic sources and document). Drives the real UI in
// Chrome, downloads the outputs over HTTP and inspects the DOCX.
//
//   node scripts/e2e-review.mjs [baseUrl] [outDir]
//
// Requires Google Chrome and a FIXTURE server (see scripts/fixture-env.ts).
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:3100';
const OUT = process.argv[3] ?? 'docs/e2e';
const SHOTS = path.join('docs/screenshots/after');
const FIXTURE = 'docs/fixtures/Թեստ_Ավարայր_7-րդ դասարան (FIXTURE) v2.docx';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const log = [];
const step = (msg) => {
  log.push(msg);
  console.log(msg);
};
const fail = (msg) => {
  step(`FAIL: ${msg}`);
  fs.writeFileSync(path.join(OUT, 'e2e-log.txt'), log.join('\n') + '\n');
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('pageerror', (e) => step(`page error: ${e.message}`));

async function clickButton(text, { within } = {}) {
  const ok = await page.evaluate(
    (t, w) => {
      const root = w ? document.querySelector(w) : document;
      const el = [...root.querySelectorAll('button, a.tf-btn, label.tf-btn')].find((b) => b.textContent.trim() === t && !b.disabled && b.getAttribute('aria-disabled') !== 'true');
      if (el) el.click();
      return !!el;
    },
    text,
    within
  );
  if (!ok) fail(`button «${text}» not found or disabled`);
}
async function waitText(text, timeout = 15000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text).catch(() => fail(`text «${text}» did not appear`));
}
async function waitIdle() {
  await page.waitForFunction(() => !document.body.innerText.includes('Ընթացքի մեջ է…'), { timeout: 20000 }).catch(() => fail('operation did not finish'));
  await sleep(300);
}
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// 1. Materials list and upload
await page.goto(`${BASE}/#/materialReview`, { waitUntil: 'networkidle0' });
await waitText('FIXTURE ՄԻՋԱՎԱՅՐ');
step('fixture banner visible');
await shot('01-materials-list-1440');
const input = await page.$('input[type=file]');
await input.uploadFile(FIXTURE);
await waitText('Ընտրված ֆայլ');
await clickButton('Վերբեռնել');
await waitText('Նյութի ստուգում');
await page.waitForFunction(() => location.hash.startsWith('#/materials/mat-'));
const materialId = await page.evaluate(() => location.hash.split('/')[2]);
step(`uploaded -> ${materialId}; URL ${await page.evaluate(() => location.hash)}`);
await shot('02-uploaded-1440');

// 2. Structure: propose, find the wrong item, correct it, confirm
await clickButton('Առաջարկել կառուցվածքը');
await waitIdle();
await waitText('Կառուցվածքն առաջարկված է');
step('structure proposed');
await shot('03-structure-proposed-1440');
// Question 3 is an open question whose instruction line was taken as a single option.
const fixed = await page.evaluate(() => {
  const items = [...document.querySelectorAll('.tf-structure-item')];
  const q3 = items.find((el) => el.textContent.includes('Հարց 3'));
  if (!q3) return 'no q3';
  const select = q3.querySelector('select');
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(select, 'open');
  select.dispatchEvent(new Event('change', { bubbles: true }));
  const remove = [...q3.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Հեռացնել տարբերակը');
  if (!remove) return 'no remove button';
  remove.click();
  return 'ok';
});
if (fixed !== 'ok') fail(`structure correction: ${fixed}`);
await waitText('Կան չպահպանված ուղղումներ');
await clickButton('Պահպանել ուղղումները');
await waitIdle();
step('structure corrected by the teacher (question 3 -> open, wrong option removed) and saved');

// 3. Without sources: confirm structure and check -> structural checks only
await clickButton('Հաստատել կառուցվածքը');
await waitIdle();
await waitText('Կառուցվածքը հաստատված է');
await clickButton('Ստուգել');
await waitIdle();
// The default "needs attention" filter shows a prominent not-evaluated count; switch to that filter.
await page.select('.tf-panel-head select', 'not_evaluated');
await sleep(200);
const noSourceStates = await page.evaluate(() => document.querySelector('.tf-panel').innerText);
if (!noSourceStates.includes('Ընտրված չէ հաստատված ՓԱՍՏԱՑԻ աղբյուր')) fail('content checks without sources were not reported as not evaluated');
step('without sources: content checks reported not evaluated, structural checks ran');
await shot('04-no-sources-checked-1440');
await page.select('.tf-panel-head select', 'actionable');

// 4. Select the FIXTURE sources
const picked = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll('#sources-title ~ div input[type=checkbox]')].filter((b) => !b.disabled);
  boxes.forEach((b) => b.click());
  return boxes.length;
});
if (picked < 2) fail(`expected two confirmed FIXTURE sources, got ${picked}`);
await clickButton('Պահպանել ընտրությունը');
await waitIdle();
step(`selected ${picked} confirmed FIXTURE sources`);

// 5. Check with sources: question 2 has a wrong key with evidence
await clickButton('Ստուգել');
await waitIdle();
await waitText('Խնդիր');
const panel = await page.evaluate(() => document.querySelector('.tf-panel').innerText);
if (!panel.includes('Հարց 2')) fail('question 2 finding not shown');
step('checks ran: question 2 flagged');
// Select the finding: the document highlights the question, its options and its key entry.
await page.evaluate(() => [...document.querySelectorAll('.tf-finding-title')].find((b) => b.textContent.includes('Հարց 2'))?.click());
await sleep(300);
const marks = await page.evaluate(() => [...document.querySelectorAll('.tf-paper mark')].map((m) => m.textContent));
step(`selected finding highlights: ${JSON.stringify(marks)}`);
if (!marks.includes('2-գ')) fail('the key entry of question 2 is not highlighted');
await shot('05-findings-1440');

// 6. Suggest, reject (finding stays failed), suggest again, accept (linked key edit), re-check
await clickButton('Առաջարկել ուղղումներ');
await waitIdle();
await waitText('Առաջարկվող ուղղում');
await shot('06-proposal-1440');
await clickButton('Մերժել առաջարկը');
await waitIdle();
const afterReject = await (await fetch(`${BASE}/api/materials/${materialId}`)).json();
const q2Reject = afterReject.review.results.find((r) => r.itemId === 'item-2');
if (!q2Reject.checks.some((c) => c.status === 'fail')) fail('rejecting turned a failed check into a pass');
step(`rejected: question 2 still has failed checks (${q2Reject.checks.filter((c) => c.status === 'fail').map((c) => c.checkId).join(', ')})`);
await clickButton('Առաջարկել ուղղումներ');
await waitIdle();
await waitText('Առաջարկվող ուղղում');
const staleRevision = (await (await fetch(`${BASE}/api/materials/${materialId}`)).json()).review.revision;
await clickButton('Ընդունել ուղղումը');
await waitIdle();
const afterAccept = await (await fetch(`${BASE}/api/materials/${materialId}`)).json();
const accepted = afterAccept.review.suggestions.find((s) => s.status === 'accepted');
if (!accepted || accepted.recheck !== 'done') fail('accepted fix was not re-checked');
if (!afterAccept.review.results.every((r) => !r.stale)) fail('results not fresh after accept');
const rechecked = afterAccept.review.results.filter((r) => r.revision === afterAccept.review.revision).map((r) => r.itemId);
step(`re-checked at the new revision (items keyed in the edited key line): ${rechecked.join(', ')}; untouched item kept: ${afterAccept.review.results.filter((r) => r.revision !== afterAccept.review.revision).map((r) => r.itemId).join(', ') || '-'}`);
step(`accepted linked key fix «${accepted.group.patches.map((p) => `${p.expected}→${p.replacement}`).join(', ')}», key now ${JSON.stringify(afterAccept.structure.answerKey.find((k) => k.itemId === 'item-2').optionLabels)}; re-check done at ${afterAccept.review.revision}`);
await shot('07-accepted-1440');

// 7. A stale decision (old revision) and a repeated decision are refused (409)
const stale = await fetch(`${BASE}/api/materials/${materialId}/suggestions/${accepted.id}/decision`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ decision: 'accept', expectedRevision: staleRevision }),
});
step(`repeated/stale accept -> HTTP ${stale.status}`);
if (stale.status !== 409) fail('stale decision was not refused with 409');

// 8. Reload: same revision, sources and decisions
await page.reload({ waitUntil: 'networkidle0' });
await waitText('Նյութի ստուգում');
const afterReload = await (await fetch(`${BASE}/api/materials/${materialId}`)).json();
const revShown = await page.evaluate((rev) => document.body.innerText.includes(rev), afterAccept.review.revision);
if (!revShown || afterReload.review.revision !== afterAccept.review.revision) fail('reload did not restore the revision');
step(`reload restored revision ${afterReload.review.revision}, ${afterReload.review.selectedSources.length} sources, decisions ${afterReload.review.suggestions.map((s) => s.status).join('/')}`);

// 9. Downloads: corrected, original, report
const hrefs = await page.evaluate(() => [...document.querySelectorAll('a.tf-btn[download]')].map((a) => a.getAttribute('href')));
step(`download links: ${JSON.stringify([...new Set(hrefs)])}`);
for (const [name, url] of [
  ['corrected.docx', `/api/materials/${materialId}/export.docx`],
  ['original.docx', `/api/materials/${materialId}/original.docx`],
  ['changes.txt', `/api/materials/${materialId}/changes.txt`],
]) {
  const res = await fetch(`${BASE}${url}`);
  if (!res.ok) fail(`${name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(OUT, name), buf);
  step(`downloaded ${name} (${buf.length} bytes; status header ${res.headers.get('x-teachflow-status') ?? '-'}; sha256 ${res.headers.get('x-teachflow-sha256') ?? '-'})`);
}

// 10. Responsive screenshots and overflow
for (const [w, h] of [[1440, 900], [1024, 768], [390, 844]]) {
  await page.setViewport({ width: w, height: h });
  await page.goto(`${BASE}/#/materials/${materialId}`, { waitUntil: 'networkidle0' });
  await waitText('Նյութի ստուգում');
  await shot(`10-workbench-${w}`);
  step(`workbench ${w}px: horizontal overflow ${await overflow()}px`);
  await page.goto(`${BASE}/#/materialReview`, { waitUntil: 'networkidle0' });
  await shot(`11-materials-${w}`);
  step(`materials ${w}px: horizontal overflow ${await overflow()}px`);
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle0' });
  await shot(`12-home-${w}`);
  step(`home ${w}px: horizontal overflow ${await overflow()}px`);
}
// 200% zoom at a 1440 px window = a 720 px CSS viewport at device scale 2.
await page.setViewport({ width: 720, height: 450, deviceScaleFactor: 2 });
await page.goto(`${BASE}/#/materials/${materialId}`, { waitUntil: 'networkidle0' });
await waitText('Նյութի ստուգում');
await shot('13-workbench-zoom200');
step(`200% zoom: horizontal overflow ${await overflow()}px`);
const menu = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-controls') === 'tf-sidebar');
  return b ? getComputedStyle(b).display : 'missing';
});
step(`200% zoom: navigation menu button display=${menu}`);

// 11. Keyboard: the menu drawer opens and closes with Escape, focus returns
await page.setViewport({ width: 390, height: 844 });
await page.goto(`${BASE}/#/materials/${materialId}`, { waitUntil: 'networkidle0' });
await page.focus('button[aria-controls="tf-sidebar"]');
await page.keyboard.press('Enter');
await sleep(250);
const openState = await page.evaluate(() => document.querySelector('.tf-shell').dataset.navOpen);
await page.keyboard.press('Escape');
await sleep(250);
const afterEsc = await page.evaluate(() => [document.querySelector('.tf-shell').dataset.navOpen, document.activeElement?.getAttribute('aria-controls')]);
step(`keyboard drawer: open=${openState}, after Escape open=${afterEsc[0]}, focus on ${afterEsc[1]}`);
await page.goto(`${BASE}/#/materials/${materialId}`, { waitUntil: 'networkidle0' });
await shot('14-mobile-drawer-closed-390');

fs.writeFileSync(path.join(OUT, 'e2e-log.txt'), log.join('\n') + '\n');
await browser.close();
step('E2E OK');
