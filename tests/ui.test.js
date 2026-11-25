// Drives Index.html in headless Chrome with a stubbed google.script.run.
// Usage: node tests/ui.test.js [src/Index.html] [tests/screens]
// Browser: your installed Google Chrome (channel 'chrome'); override with CHROME_PATH=/path/to/chrome. NO_SANDBOX=1 only inside containers.
'use strict';
const { chromium } = require('playwright-core');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const HTML = process.argv[2] || 'src/Index.html';
const OUT = process.argv[3] || 'tests/screens';
fs.mkdirSync(OUT, { recursive: true });
// In production the viewport meta is added by Code.gs (addMetaTag). Locally we add it to a temp copy so mobile emulation is faithful.
const PAGE = path.resolve(OUT, '_page.html');
fs.writeFileSync(PAGE, fs.readFileSync(HTML, 'utf8').replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'));

const STATUSES = ['New', 'Needs Input', 'Ready', 'Applied', 'Closed', 'Skipped'];
function job(i) {
  const id = 'J' + String(i).padStart(3, '0');
  const hs = i === 3 ? 'Requires onsite 5 days a week' : (i === 4 ? 'To confirm: relocation to Cluj required?' : '');
  return {
    id, title: 'Senior Engineer ' + i + (i % 5 === 0 ? ' (Remote)' : ''), category: i % 2 ? 'Backend' : 'Data',
    company: i % 7 === 0 ? 'شركة الأمل ' + i : 'Company ' + i, location: 'City', workMode: i % 3 ? 'Remote' : 'Hybrid',
    salary: i % 4 ? '€' + (2000 + i * 10) : '', source: 'LinkedIn', jobUrl: 'https://example.com/jobs/' + i,
    applyUrl: i % 4 === 0 ? 'SAME (Apply button on the Job URL page)' : 'https://example.com/apply/' + i,
    dateFound: '2026-11-' + String(1 + (i % 25)).padStart(2, '0'), match: i === 9 ? null : 40 + i * 2,
    hardStop: hs, hardStopKind: i === 3 ? 'stop' : (i === 4 ? 'confirm' : ''),
    decision: i === 6 ? 'Go' : (i === 8 ? 'Skip' : ''), status: STATUSES[i % 6], pkg: 'CV+CL',
    notes: 'T50 M26 D5. ملاحظات عربية للوظيفة رقم ' + i + '\nسطر ثانٍ من الملاحظات مع English words.'
  };
}
const JOBS = []; for (let i = 1; i <= 27; i++) JOBS.push(job(i));
JOBS.push({ ...job(28), title: '<img src=x onerror="window.__xss=1">', company: '<b>Evil</b> & Co', category: '<u>Cat</u>', status: '<i>x</i>',
  notes: '<script>window.__xss=2</script>\n<svg onload="window.__xss=4">', jobUrl: 'javascript:window.__xss=3', applyUrl: 'data:text/html,<script>window.__xss=5</script>', match: 99 });
JOBS.push({ ...job(29), title: 'Insecure link job', jobUrl: 'http://insecure.example/x', applyUrl: 'https://ok.example/apply?a=1&b=2', match: 98 });
JOBS.push({ ...job(30), title: 'No links job', jobUrl: '', applyUrl: '', match: 97 });

const STUB = (jobs) => `
(function(){
  window.__calls = [];
  window.__srv = { jobs: ${JSON.stringify(jobs)}, delay: 120, failNext: false, failIds: {} };
  function handle(name, args) {
    var s = window.__srv;
    if (name === 'getJobs') {
      if (s.failNext) { s.failNext = false; return { ok: false, code: 'X', error: 'تعذّر قراءة الملف (اختبار).' }; }
      return { ok: true, jobs: JSON.parse(JSON.stringify(s.jobs)), fetchedAt: Date.now(), cached: args[0] !== true };
    }
    if (name === 'setDecision') {
      if (s.failIds[args[0]]) return { ok: false, code: 'BUSY', error: 'الملف مشغول (اختبار).' };
      var j = s.jobs.find(function (x) { return x.id === args[0]; });
      if (!j) return { ok: false, error: 'not found' };
      j.decision = args[1] || '';
      return { ok: true, job: JSON.parse(JSON.stringify(j)) };
    }
    return { ok: false, error: 'unknown' };
  }
  function runner(ok, fail) {
    return new Proxy({}, { get: function (_, name) {
      if (name === 'withSuccessHandler') return function (f) { return runner(f, fail); };
      if (name === 'withFailureHandler') return function (f) { return runner(ok, f); };
      return function () {
        var args = Array.prototype.slice.call(arguments);
        window.__calls.push([name].concat(args));
        setTimeout(function () { try { ok(handle(name, args)); } catch (e) { fail(e); } }, window.__srv.delay);
      };
    }});
  }
  window.google = { script: { run: runner(function () {}, function () {}) } };
})();`;

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 5).join('\n       ')); }
}

(async () => {
  const launchOpts = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
  if (process.env.NO_SANDBOX) launchOpts.args = ['--no-sandbox'];
  const browser = await chromium.launch(launchOpts);

  async function open(opts) {
    opts = opts || {};
    const ctx = await browser.newContext({
      viewport: opts.viewport || { width: 390, height: 844 }, colorScheme: opts.dark ? 'dark' : 'light',
      deviceScaleFactor: 2, isMobile: !!opts.mobile, hasTouch: !!opts.mobile
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(STUB(opts.jobs || JOBS));
    if (opts.preScript) await page.addInitScript(opts.preScript);
    await page.goto(require('url').pathToFileURL(PAGE).href);   // works with relative paths and on Windows
    if (!opts.noWait) await page.waitForSelector('.card', { timeout: 5000 });
    return { page, ctx, errors };
  }
  const cardIds = (page) => page.$$eval('.card', (els) => els.map((e) => e.getAttribute('data-job-id')));
  const countText = (page) => page.$eval('#count', (e) => e.textContent);

  console.log('Index.html');

  await test('loading state shows first, then cards; controls appear', async () => {
    const { page, ctx, errors } = await open({ noWait: true, preScript: 'window.__slow = true;' });
    await page.evaluate(() => { window.__srv.delay = 600; });
    await page.reload(); // the stub re-runs; delay set again below
    await page.waitForSelector('.state .spinner', { timeout: 3000 });
    assert((await page.textContent('#state')).includes('جارٍ تحميل'));
    assert.strictEqual(await page.isHidden('#controls'), true);
    await page.waitForSelector('.card', { timeout: 5000 });
    assert.strictEqual(await page.isVisible('#controls'), true);
    assert.strictEqual(await page.isHidden('#state'), true);
    assert.deepStrictEqual(errors, []); await ctx.close();
  });

  await test('home: counters by Status, sorted by Match % desc by default, null match last', async () => {
    const { page, ctx, errors } = await open();
    const counters = await page.$$eval('.counter', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
    assert(counters[0].startsWith('30'), counters[0]);
    const byLabel = Object.fromEntries(counters.map((c) => { const [n, ...l] = c.split(' '); return [l.join(' '), Number(n)]; }));
    ['New', 'Needs Input', 'Ready', 'Applied', 'Closed', 'Skipped'].forEach((s) => assert(s in byLabel, 'missing counter ' + s));
    assert.strictEqual(Object.values(byLabel).slice(1).reduce((a, b) => a + b, 0), 30);
    const ids = await cardIds(page);
    assert.strictEqual(ids.length, 30);
    assert.deepStrictEqual(ids.slice(0, 3), ['J028', 'J029', 'J030']);   // 99, 98, 97
    assert.strictEqual(ids[ids.length - 1], 'J009');                       // null match last
    assert.strictEqual(await countText(page), 'عرض 30 من 30 وظيفة');
    assert.deepStrictEqual(errors, []); await ctx.close();
  });

  await test('untrusted content never executes or becomes markup', async () => {
    const { page, ctx, errors } = await open();
    assert.strictEqual(await page.evaluate(() => window.__xss), undefined);
    assert.strictEqual(await page.$('img[src="x"]'), null);
    assert.strictEqual(await page.$('.card b'), null);
    assert.strictEqual(await page.$('.card u'), null);
    const title = await page.$eval('[data-job-id="J028"] .title-btn', (e) => e.textContent);
    assert.strictEqual(title, '<img src=x onerror="window.__xss=1">');
    await page.click('[data-job-id="J028"] .title-btn');
    await page.waitForSelector('dialog[open]');
    assert.strictEqual(await page.$('dialog script'), null);
    assert.strictEqual(await page.$('dialog svg'), null);
    const notes = await page.$eval('.notes-text', (e) => e.textContent);
    assert(notes.includes('<script>window.__xss=2</script>') && notes.includes('<svg onload'));
    assert.strictEqual(await page.evaluate(() => window.__xss), undefined);
    assert.deepStrictEqual(errors, []); await ctx.close();
  });

  await test('links: only https opens; javascript:/data:/http: and plain text are never links', async () => {
    const { page, ctx } = await open();
    const bad = await page.$$eval('a', (as) => as.filter((a) => !/^https:\/\//.test(a.getAttribute('href') || '') || a.rel !== 'noopener noreferrer' || a.target !== '_blank').length);
    assert.strictEqual(bad, 0);
    const hrefs28 = await page.$$eval('[data-job-id="J028"] a', (as) => as.map((a) => a.href));
    assert.deepStrictEqual(hrefs28, []);                                   // javascript: + data: => no links at all
    assert.strictEqual(await page.$$eval('[data-job-id="J028"] .btn.disabled', (e) => e.length), 1);
    assert.deepStrictEqual(await page.$$eval('[data-job-id="J029"] a', (as) => as.map((a) => a.href)), ['https://ok.example/apply?a=1&b=2']);
    // "SAME (...)" apply text on J004 -> no Apply button on the card
    const j4 = await page.$$eval('[data-job-id="J004"] a', (as) => as.map((a) => a.textContent));
    assert.deepStrictEqual(j4, ['فتح الوظيفة']);
    await ctx.close();
  });

  await test('card shows required info and the right badges', async () => {
    const { page, ctx } = await open();
    const c3 = await page.$eval('[data-job-id="J003"]', (e) => e.innerText);
    ['Senior Engineer 3', 'Company 3', 'City', 'Hybrid', '€2030', '46%', 'Hard Stop'].forEach((t) => assert(c3.includes(t), 'J003 missing ' + t));
    assert.strictEqual(await page.$eval('[data-job-id="J003"] .badge.red', (e) => e.textContent), 'Hard Stop');
    assert.strictEqual(await page.$('[data-job-id="J004"] .badge.red'), null);                 // "To confirm:" is not red
    assert.strictEqual(await page.$eval('[data-job-id="J004"] .badge.blue', (e) => e.textContent), 'To confirm');
    assert.strictEqual(await page.$eval('[data-job-id="J001"] .badge.yellow', (e) => e.textContent), 'Needs Input');   // 1 % 6 = 1 -> Needs Input
    assert.strictEqual(await page.$('[data-job-id="J002"] .badge.yellow'), null);
    assert.strictEqual(await page.$eval('[data-job-id="J009"] .match-num', (e) => e.textContent), '—');
    await ctx.close();
  });

  await test('filters: Status, Category, Work Mode, min Match %, Decision, Hard Stop, search, combined, reset', async () => {
    const { page, ctx } = await open({ viewport: { width: 1280, height: 900 } });
    assert.strictEqual(await page.isVisible('#filterPanel'), true);                                // open by default on desktop
    const expect = (pred) => JOBS.filter(pred).length;
    const n = async () => (await cardIds(page)).length;

    await page.selectOption('#fStatus', 'Needs Input');
    assert.strictEqual(await n(), expect((j) => j.status === 'Needs Input'));
    await page.selectOption('#fStatus', '__all__');

    await page.selectOption('#fCategory', 'Data');
    assert.strictEqual(await n(), expect((j) => j.category === 'Data'));
    await page.selectOption('#fCategory', '__all__');

    await page.selectOption('#fWorkMode', 'Hybrid');
    assert.strictEqual(await n(), expect((j) => j.workMode === 'Hybrid'));
    await page.selectOption('#fWorkMode', '__all__');

    await page.fill('#fMin', '80');
    assert.strictEqual(await n(), expect((j) => j.match !== null && j.match >= 80));
    await page.fill('#fMin', '');

    await page.selectOption('#fDecision', '__none__'); assert.strictEqual(await n(), expect((j) => j.decision === ''));
    await page.selectOption('#fDecision', 'Go');       assert.deepStrictEqual(await cardIds(page), ['J006']);
    await page.selectOption('#fDecision', 'Skip');     assert.deepStrictEqual(await cardIds(page), ['J008']);
    await page.selectOption('#fDecision', '__all__');

    await page.selectOption('#fHardStop', 'yes'); assert.deepStrictEqual((await cardIds(page)).sort(), ['J003', 'J004']);
    await page.selectOption('#fHardStop', 'no');  assert.strictEqual(await n(), 28);
    await page.selectOption('#fHardStop', '__all__');

    await page.fill('#q', 'Company 12'); await page.waitForTimeout(300);
    assert.deepStrictEqual(await cardIds(page), ['J012']);
    await page.fill('#q', 'الأمل'); await page.waitForTimeout(300);
    assert.deepStrictEqual((await cardIds(page)).sort(), ['J007', 'J014', 'J021']);
    await page.fill('#q', 'رقم 5'); await page.waitForTimeout(300);                                   // search inside Notes, multi-token
    assert.strictEqual((await cardIds(page)).includes('J005'), true);
    await page.fill('#q', 'senior 15 remote'); await page.waitForTimeout(300);                          // Title tokens AND
    assert.deepStrictEqual(await cardIds(page), ['J015']);

    await page.fill('#q', ''); await page.waitForTimeout(300);
    await page.selectOption('#fStatus', 'Needs Input'); await page.selectOption('#fCategory', 'Backend'); await page.fill('#fMin', '60');
    assert.strictEqual(await n(), expect((j) => j.status === 'Needs Input' && j.category === 'Backend' && j.match !== null && j.match >= 60));
    assert.strictEqual(await page.textContent('#filterBadge'), '3');

    await page.click('#resetFilters');
    assert.strictEqual(await n(), 30); assert.strictEqual(await page.isHidden('#filterBadge'), true);
    await ctx.close();
  });

  await test('clicking a counter filters by Status and syncs the select; clicking again clears', async () => {
    const { page, ctx } = await open();
    await page.click('.counter:has-text("Ready")');
    assert.strictEqual(await page.$eval('#fStatus', (e) => e.value), 'Ready');
    const ids = await page.$$eval('.card', (els) => els.map((e) => e.getAttribute('data-job-id')));
    assert(ids.length > 0 && ids.every((id) => JOBS.find((j) => j.id === id).status === 'Ready'));
    await page.click('.counter[aria-pressed="true"]');
    assert.strictEqual((await cardIds(page)).length, 30);
    await ctx.close();
  });

  await test('sort: Match % asc/desc and Date Found asc/desc (empty values last)', async () => {
    const { page, ctx } = await open();
    await page.selectOption('#sort', 'match-asc');
    let ids = await cardIds(page); assert.strictEqual(ids[0], 'J001'); assert.strictEqual(ids[ids.length - 1], 'J009');
    await page.selectOption('#sort', 'date-desc');
    let dates = await page.$$eval('.card', (els) => els.map((e) => e.getAttribute('data-job-id')));
    const d = (id) => JOBS.find((j) => j.id === id).dateFound;
    for (let i = 1; i < dates.length; i++) assert(d(dates[i - 1]) >= d(dates[i]), 'date-desc broken at ' + i);
    await page.selectOption('#sort', 'date-asc');
    dates = await cardIds(page);
    for (let i = 1; i < dates.length; i++) assert(d(dates[i - 1]) <= d(dates[i]), 'date-asc broken at ' + i);
    await ctx.close();
  });

  await test('empty-filter state appears with a working reset button', async () => {
    const { page, ctx } = await open();
    await page.fill('#q', 'zzzz-nothing'); await page.waitForTimeout(300);
    assert.strictEqual(await page.$$eval('.card', (e) => e.length), 0);
    assert((await page.textContent('#state')).includes('لا توجد وظائف مطابقة'));
    await page.click('#state button'); assert.strictEqual((await cardIds(page)).length, 30);
    assert.strictEqual(await page.isHidden('#state'), true);
    await ctx.close();
  });

  await test('empty Tracker shows the empty-list state', async () => {
    const { page, ctx } = await open({ jobs: [], noWait: true });
    await page.waitForFunction(() => document.getElementById('state').textContent.includes('لا توجد وظائف بعد'));
    assert.strictEqual(await page.$$eval('.card', (e) => e.length), 0); await ctx.close();
  });

  await test('Go / Skip / Clear call setDecision(id, value) only; UI updates from the returned job', async () => {
    const { page, ctx, errors } = await open();
    await page.click('[data-job-id="J010"] .seg-btn.go');
    await page.waitForSelector('[data-job-id="J010"][data-decision="Go"]');
    assert.strictEqual(await page.$eval('[data-job-id="J010"] .seg-btn.go', (e) => e.getAttribute('aria-pressed')), 'true');
    assert((await page.textContent('#toast')).includes('Go'));
    await page.click('[data-job-id="J010"] .seg-btn.skip');
    await page.waitForSelector('[data-job-id="J010"][data-decision="Skip"]');
    await page.click('[data-job-id="J010"] .seg-btn.clear');
    await page.waitForSelector('[data-job-id="J010"][data-decision=""]');
    assert.strictEqual(await page.$eval('[data-job-id="J010"] .seg-btn.clear', (e) => e.disabled), true);   // nothing to clear
    const calls = await page.evaluate(() => window.__calls.filter((c) => c[0] === 'setDecision'));
    assert.deepStrictEqual(calls, [['setDecision', 'J010', 'Go'], ['setDecision', 'J010', 'Skip'], ['setDecision', 'J010', '']]);
    // Status was never part of any call
    assert.strictEqual(await page.evaluate(() => window.__calls.every((c) => c.length <= 3)), true);
    assert.deepStrictEqual(errors, []); await ctx.close();
  });

  await test('while saving the card is locked; a failed save shows an Arabic error and changes nothing', async () => {
    const { page, ctx } = await open();
    await page.evaluate(() => { window.__srv.failIds['J011'] = true; window.__srv.delay = 500; });
    await page.click('[data-job-id="J011"] .seg-btn.go');
    assert.strictEqual(await page.$eval('[data-job-id="J011"]', (e) => e.classList.contains('busy')), true);
    await page.waitForFunction(() => document.getElementById('toast').classList.contains('error'));
    assert((await page.textContent('#toast')).includes('الملف مشغول'));
    assert.strictEqual(await page.$eval('[data-job-id="J011"]', (e) => e.getAttribute('data-decision')), '');
    assert.strictEqual(await page.$eval('[data-job-id="J011"]', (e) => e.classList.contains('busy')), false);
    await ctx.close();
  });

  await test('detail view: all 16 fields, full multi-line Notes, score chips, hard-stop callout, close with Esc / backdrop / button', async () => {
    const { page, ctx } = await open({ viewport: { width: 390, height: 844 }, mobile: true });
    await page.click('[data-job-id="J003"] .title-btn');
    await page.waitForSelector('dialog[open]');
    const labels = await page.$$eval('dialog dt', (e) => e.map((x) => x.textContent));
    assert.deepStrictEqual(labels, ['ID', 'Title', 'Category', 'Company', 'Location', 'Work Mode', 'Salary', 'Source', 'Job URL', 'Apply URL', 'Date Found', 'Match %', 'Hard Stop', 'Decision', 'Status', 'Package']);
    const txt = await page.$eval('dialog', (e) => e.innerText);
    assert(txt.includes('سطر ثانٍ من الملاحظات مع English words.'));
    assert(txt.includes('Tasks 50') && txt.includes('Minimum 26') && txt.includes('Differentiators 5'));
    assert(txt.includes('Requires onsite 5 days a week') && txt.includes('استبعاد محتمل'));
    assert.strictEqual(await page.$$eval('dialog .notes-text', (e) => e[0].textContent.includes('\n')), true);
    await page.screenshot({ path: path.join(OUT, 'mobile-detail.png') });

    await page.keyboard.press('Escape'); await page.waitForSelector('dialog:not([open])', { state: 'attached' });
    await page.click('[data-job-id="J004"] .title-btn'); await page.waitForSelector('dialog[open]');
    assert((await page.$eval('dialog', (e) => e.innerText)).includes('سؤال بانتظار تأكيدك'));
    await page.click('#detailClose'); await page.waitForSelector('dialog:not([open])', { state: 'attached' });
    assert.strictEqual(await page.evaluate(() => document.body.classList.contains('modal-open')), false);
    await ctx.close();
  });

  await test('desktop: clicking the backdrop closes the detail dialog', async () => {
    const { page, ctx } = await open({ viewport: { width: 1280, height: 900 } });
    await page.click('[data-job-id="J005"] .title-btn'); await page.waitForSelector('dialog[open]');
    assert.strictEqual(await page.evaluate(() => document.body.classList.contains('modal-open')), true);
    await page.mouse.click(5, 5);
    await page.waitForSelector('dialog:not([open])', { state: 'attached' });
    assert.strictEqual(await page.evaluate(() => document.body.classList.contains('modal-open')), false);
    await ctx.close();
  });

  await test('decision buttons inside the detail view write and refresh both the dialog and the card', async () => {
    const { page, ctx } = await open();
    await page.click('[data-job-id="J012"] .title-btn'); await page.waitForSelector('dialog[open]');
    await page.click('dialog .seg-btn.go');
    await page.waitForSelector('dialog .seg-btn.go.on');
    assert.strictEqual(await page.$eval('[data-job-id="J012"].card', (e) => e.getAttribute('data-decision')), 'Go');
    assert.strictEqual(await page.$eval('dialog dd:nth-of-type(1)', () => true), true);
    const dec = await page.$$eval('dialog .field', (rows) => rows.find((r) => r.querySelector('dt').textContent === 'Decision').querySelector('dd').textContent);
    assert.strictEqual(dec, 'Go');
    await ctx.close();
  });

  await test('Refresh button re-reads with force=true, shows progress, and reports the time', async () => {
    const { page, ctx } = await open();
    await page.evaluate(() => { window.__srv.delay = 400; window.__srv.jobs[0].title = 'Changed in the Sheet'; });
    await page.click('#refresh');
    assert.strictEqual(await page.$eval('#refresh', (e) => e.disabled && e.classList.contains('spin')), true);
    await page.waitForFunction(() => !document.getElementById('refresh').disabled);
    assert.deepStrictEqual(await page.evaluate(() => window.__calls.filter((c) => c[0] === 'getJobs')), [['getJobs', false], ['getJobs', true]]);
    assert((await page.textContent('body')).includes('Changed in the Sheet'));
    assert((await page.textContent('#updated')).startsWith('آخر قراءة من الملف'));
    await ctx.close();
  });

  await test('load error shows an Arabic message with Retry; refresh error keeps the old list', async () => {
    const { page, ctx } = await open({ noWait: true, preScript: 'window.__srv.failNext = true;' });
    await page.waitForSelector('#state[data-kind="error"]');
    assert((await page.textContent('#state')).includes('تعذّر قراءة الملف'));
    await page.click('#state button'); await page.waitForSelector('.card');
    await page.evaluate(() => { window.__srv.failNext = true; });
    await page.click('#refresh'); await page.waitForFunction(() => document.getElementById('toast').classList.contains('error'));
    assert.strictEqual((await cardIds(page)).length, 30);
    await ctx.close();
  });

  await test('layout: no horizontal overflow on mobile; RTL; 44px touch targets', async () => {
    const { page, ctx } = await open({ mobile: true });
    assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.strictEqual(await page.evaluate(() => document.documentElement.dir), 'rtl');
    const small = await page.$$eval('.seg-btn, .btn, .counter', (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 43).length);
    assert.strictEqual(small, 0);
    await ctx.close();
  });

  await test('filter panel is collapsed on mobile and toggles', async () => {
    const { page, ctx } = await open({ mobile: true });
    assert.strictEqual(await page.isHidden('#filterPanel'), true);
    await page.click('#filterToggle'); assert.strictEqual(await page.isVisible('#filterPanel'), true);
    assert.strictEqual(await page.getAttribute('#filterToggle', 'aria-expanded'), 'true');
    await ctx.close();
  });

  await test('source has no HTML-string injection APIs', async () => {
    const src = fs.readFileSync(HTML, 'utf8');
    ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function'].forEach((s) => assert(!src.includes(s), 'found ' + s));
  });

  // Screenshots for visual review
  const shots = [
    ['mobile-light', { mobile: true }], ['mobile-dark', { mobile: true, dark: true }],
    ['desktop-light', { viewport: { width: 1280, height: 900 } }], ['desktop-dark', { viewport: { width: 1280, height: 900 }, dark: true }]
  ];
  for (const [name, o] of shots) {
    const { page, ctx } = await open(o);
    if (o.mobile) { await page.click('#filterToggle'); await page.selectOption('#fHardStop', 'no'); await page.selectOption('#fHardStop', '__all__'); }
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: false });
    await ctx.close();
  }
  { // detail on desktop dark
    const { page, ctx } = await open({ viewport: { width: 1280, height: 900 }, dark: true });
    await page.click('[data-job-id="J004"] .title-btn'); await page.waitForSelector('dialog[open]');
    await page.screenshot({ path: path.join(OUT, 'desktop-detail-dark.png') }); await ctx.close();
  }

  { // mobile detail scrolled to Notes
    const { page, ctx } = await open({ mobile: true });
    await page.click('[data-job-id="J007"] .title-btn'); await page.waitForSelector('dialog[open]');
    await page.evaluate(() => { const b = document.getElementById('detailBody'); b.scrollTop = b.scrollHeight; });
    await page.screenshot({ path: path.join(OUT, 'mobile-detail-notes.png') }); await ctx.close();
  }

  await browser.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
