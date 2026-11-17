// Browser smoke test of dist/index.html. pdf.js CDN requests are served from node_modules.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '..');
const SHOTS = process.env.SHOTS || '/tmp';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'ru-RU', acceptDownloads: true });
  await ctx.route('https://cdnjs.cloudflare.com/**', (route) => {
    const url = route.request().url();
    const file = url.endsWith('pdf.worker.min.js') ? 'pdf.worker.min.js' : 'pdf.min.js';
    route.fulfill({ path: path.join(root, 'node_modules/pdfjs-dist/build', file), contentType: 'text/javascript' });
  });
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await ctx.route('https://fonts.gstatic.com/**', (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto('file://' + path.join(root, 'dist/index.html'));
  await page.waitForSelector('.stamp', { timeout: 20000 });
  console.log('sample stamp:', await page.textContent('.stamp'), '| rows:', await page.locator('tbody tr').count());
  await page.screenshot({ path: SHOTS + '/1-sample-ru.png', fullPage: false });

  // Upload two of our own files
  await page.setInputFiles('#file-input', [path.join(root, 'test/fixtures/us_checking.pdf'), path.join(root, 'test/fixtures/us_checking_broken.pdf')]);
  await page.waitForFunction(() => document.querySelectorAll('.stamp').length === 2, null, { timeout: 20000 });
  const stamps = await page.locator('.stamp').allTextContents();
  console.log('stamps after upload:', stamps, '| sample banner hidden:', await page.locator('#sample-banner').isHidden());
  console.log('fix panel:', (await page.locator('.fix').first().innerText()).split('\n').slice(0, 2).join(' / '));
  console.log('chain:', await page.locator('#chain').innerText());
  await page.screenshot({ path: SHOTS + '/2-mismatch.png', fullPage: false });
  await page.locator('.fix [data-act="fix-amount"]').click();
  await page.waitForTimeout(200);
  console.log('stamps after fix:', await page.locator('.stamp').allTextContents());

  // Edit an amount inline
  const cell = page.locator('#statements article').first().locator('[data-edit="amount"]').first();
  await cell.click();
  await cell.press('Control+A');
  await cell.type('-150,00');
  await cell.press('Enter');
  await page.waitForTimeout(200);
  console.log('after manual edit stamp:', await page.locator('.stamp').first().textContent(), '| first check:', await page.locator('#statements article').first().locator('.chk').first().innerText());

  // Export xlsx (standalone download)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dl-btn')]);
  const out = SHOTS + '/' + dl.suggestedFilename();
  await dl.saveAs(out);
  console.log('downloaded:', dl.suggestedFilename(), fs.statSync(out).size, 'bytes');
  await page.check('#fmt-beancount', { force: true });
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#dl-btn')]);
  await dl2.saveAs(SHOTS + '/' + dl2.suggestedFilename());
  console.log('downloaded:', dl2.suggestedFilename());

  // English + dark + mobile
  await page.click('#lang-btn');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: SHOTS + '/3-en-dark.png', fullPage: false });
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'en-US' });
  await m.route('https://cdnjs.cloudflare.com/**', (route) => {
    const url = route.request().url();
    const file = url.endsWith('pdf.worker.min.js') ? 'pdf.worker.min.js' : 'pdf.min.js';
    route.fulfill({ path: path.join(root, 'node_modules/pdfjs-dist/build', file), contentType: 'text/javascript' });
  });
  await m.route('https://fonts.**', (r) => r.abort());
  const mp = await m.newPage();
  mp.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
  await mp.goto('file://' + path.join(root, 'dist/index.html'));
  await mp.waitForSelector('.stamp', { timeout: 20000 });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log('mobile horizontal overflow px:', overflow, '| stamp:', await mp.textContent('.stamp'));
  await mp.screenshot({ path: SHOTS + '/4-mobile-en.png', fullPage: false });
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
