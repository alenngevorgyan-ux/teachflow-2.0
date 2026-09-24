// Screenshots and horizontal-overflow check of the main routes on the normal
// dev server (demo data, labelled in the UI). node scripts/screens-audit.mjs [base]
import fs from 'fs';
import puppeteer from 'puppeteer-core';
const BASE = process.argv[2] ?? 'http://localhost:3000';
const OUT = 'docs/screenshots/after/screens';
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
const routes = [
  ['workspace', 'teacher'],
  ['thematicPlans', 'teacher'],
  ['reports', 'teacher'],
  ['registry', 'methodologist'],
  ['aboutData', 'teacher'],
];
for (const [w, h] of [[1440, 900], [390, 844]]) {
  await page.setViewport({ width: w, height: h });
  for (const [route, role] of routes) {
    await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle0' });
    if (role !== 'teacher') {
      await page.evaluate((r) => {
        const sel = [...document.querySelectorAll('.tf-sidebar select')][0];
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, r);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }, role);
      await new Promise((r) => setTimeout(r, 300));
    }
    await page.evaluate((r) => { location.hash = `#/${r}`; }, route);
    await new Promise((r) => setTimeout(r, 1500));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.screenshot({ path: `${OUT}/${route}-${w}.png` });
    console.log(`${route} ${w}px overflow ${overflow}px`);
  }
}
await browser.close();
