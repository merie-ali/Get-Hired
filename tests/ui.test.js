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

// V2 fixtures: Drive folder contents and existing rows of the "Files" tab.
const F1 = '1AbCdEfGhIjKlMnOpQrStUv', F2 = '2BcDeFgHiJkLmNoPqRsTuVw', F3 = '3CdEfGhIjKlMnOpQrStUvWx', F4 = '4DeFgHiJkLmNoPqRsTuVwXy';
const drive = (id) => 'https://drive.google.com/file/d/' + id + '/view';
const FOLDER_URL = 'https://drive.google.com/drive/folders/FAKE_FOLDER_ID_0001';
const FILES = {
  folderFiles: [
    { id: F1, name: 'CV - Jane Doe.pdf', url: drive(F1), mime: 'application/pdf', updated: '2026-11-20' },
    { id: F2, name: 'Cover Letter - Company 1.docx', url: drive(F2), mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', updated: '2026-11-21' },
    { id: F3, name: 'السيرة الذاتية - نسخة عربية.pdf', url: drive(F3), mime: 'application/pdf', updated: '2026-11-22' },
    { id: F4, name: '<img src=x onerror="window.__xss=7">.pdf', url: drive(F4), mime: 'application/pdf', updated: '2026-11-23' }
  ],
  links: [
    { jobId: 'J001', type: 'CV', fileId: F1, date: '2026-11-20', name: 'CV - Jane Doe.pdf', url: drive(F1), inFolder: true },
    { jobId: 'J001', type: 'Cover Letter', fileId: F2, date: '2026-11-21', name: 'Cover Letter - Company 1.docx', url: drive(F2), inFolder: true },
    { jobId: 'J001', type: 'CV', fileId: F3, date: '2026-11-22', name: 'السيرة الذاتية - نسخة عربية.pdf', url: drive(F3), inFolder: true },
    { jobId: 'J002', type: 'CV', fileId: F1, date: '2026-11-20', name: 'CV - Jane Doe.pdf', url: drive(F1), inFolder: true },
    { jobId: 'J003', type: 'Cover Letter', fileId: F4, date: '2026-11-23', name: '<img src=x onerror="window.__xss=7">.pdf', url: 'javascript:window.__xss=8', inFolder: true },
    { jobId: 'J005', type: 'CV', fileId: 'GoneFileId0123456789', date: '2026-10-01', name: '', url: '', inFolder: false }
  ]
};

const STUB = (jobs, files) => `
(function(){
  window.__calls = [];
  window.__srv = { jobs: ${JSON.stringify(jobs)}, files: ${JSON.stringify(files)}, folderUrl: ${JSON.stringify(FOLDER_URL)}, delay: 120, failNext: false, failIds: {}, failFilesNext: false, failLink: false };
  function fileIdOf(ref) {
    ref = String(ref || '').trim();
    var m = ref.match(/\\/d\\/([A-Za-z0-9_-]{10,})/) || ref.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
    if (m) return m[1];
    return /^[A-Za-z0-9_-]{10,}$/.test(ref) ? ref : '';
  }
  function handle(name, args) {
    var s = window.__srv;
    if (name === 'getFiles') {
      if (s.failFilesNext) { s.failFilesNext = false; return { ok: false, code: 'X', error: 'تعذّر قراءة مجلد الملفات (اختبار).' }; }
      return { ok: true, links: JSON.parse(JSON.stringify(s.files.links)), folder: { url: s.folderUrl, files: JSON.parse(JSON.stringify(s.files.folderFiles)) }, fetchedAt: Date.now(), cached: args[0] !== true };
    }
    if (name === 'linkFile') {
      var jobId = args[0], type = args[1], id = fileIdOf(args[2]);
      if (s.failLink) return { ok: false, code: 'BUSY', error: 'الملف مشغول (اختبار).' };
      if (type !== 'CV' && type !== 'Cover Letter') return { ok: false, error: 'نوع غير صالح' };
      if (!s.jobs.some(function (x) { return x.id === jobId; })) return { ok: false, error: 'الوظيفة غير موجودة' };
      var f = s.files.folderFiles.find(function (x) { return x.id === id; });
      if (!f) return { ok: false, code: 'NOT_IN_FOLDER', error: 'هذا الملف ليس داخل المجلد المحدد (اختبار).' };
      if (s.files.links.some(function (l) { return l.jobId === jobId && l.type === type && l.fileId === id; })) return { ok: false, error: 'هذا الملف مرتبط بهذه الوظيفة مسبقاً.' };
      var link = { jobId: jobId, type: type, fileId: id, date: '2026-11-25', name: f.name, url: f.url, inFolder: true };
      s.files.links.push(link);
      return { ok: true, link: JSON.parse(JSON.stringify(link)) };
    }
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
    await page.addInitScript(STUB(opts.jobs || JOBS, opts.files || FILES));
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

  // ---------------------------------------------------------------- V2: files
  console.log('V2 files');
  const linkCalls = (page) => page.evaluate(() => window.__calls.filter((c) => c[0] === 'linkFile'));
  const openDetailOf = async (page, id) => { await page.click('[data-job-id="' + id + '"] .title-btn'); await page.waitForSelector('dialog[open] .files'); };

  await test('V2: files load once with the jobs (getFiles(false)); cards show CV / Cover Letter buttons only when linked', async () => {
    const { page, ctx, errors } = await open();
    await page.waitForFunction(() => document.querySelector('[data-job-id="J001"] a.btn[title]'));
    assert.deepStrictEqual(await page.evaluate(() => window.__calls.filter((c) => c[0] === 'getFiles')), [['getFiles', false]]);
    const labels = (id) => page.$$eval('[data-job-id="' + id + '"] .links a', (as) => as.map((a) => a.textContent));
    assert.deepStrictEqual(await labels('J001'), ['فتح الوظيفة', 'تقديم', 'CV', 'Cover Letter']);
    assert.deepStrictEqual((await labels('J002')).slice(-1), ['CV']);
    assert.strictEqual((await labels('J002')).includes('Cover Letter'), false);
    assert.strictEqual((await labels('J004')).includes('CV'), false);                      // no files linked
    await ctx.close();
    assert.deepStrictEqual(errors, []);
  });

  await test('V2: card buttons open the NEWEST file of each type, as safe https links', async () => {
    const { page, ctx } = await open();
    await page.waitForSelector('[data-job-id="J001"] a.btn[title]');
    const hrefs = await page.$$eval('[data-job-id="J001"] a.btn[title]', (as) => as.map((a) => [a.textContent, a.href, a.title, a.rel, a.target]));
    assert.deepStrictEqual(hrefs, [
      ['CV', drive(F3), 'السيرة الذاتية - نسخة عربية.pdf', 'noopener noreferrer', '_blank'],      // J001 has two CVs: F1 then F3 (newer)
      ['Cover Letter', drive(F2), 'Cover Letter - Company 1.docx', 'noopener noreferrer', '_blank']
    ]);
    await ctx.close();
  });

  await test('V2: detail shows linked files newest first, type chip, date, "outside folder" mark, and the attach form', async () => {
    const { page, ctx, errors } = await open({ viewport: { width: 1280, height: 900 } });
    await openDetailOf(page, 'J001');
    const rows = await page.$$eval('dialog .file-row', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
    assert.strictEqual(rows.length, 3);
    assert(rows[0].startsWith('CV') && rows[0].includes('السيرة الذاتية') && rows[0].includes('2026-11-22'), rows[0]);
    assert(rows[2].includes('CV - Jane Doe.pdf'), rows[2]);
    assert.deepStrictEqual(await page.$$eval('dialog .attach select:first-of-type option', (o) => o.map((x) => x.value)), ['CV', 'Cover Letter']);
    const opts = await page.$$eval('dialog .attach select:nth-of-type(2) option', (o) => o.map((x) => x.value));
    assert.deepStrictEqual(opts, ['', F1, F2, F3, F4]);
    assert.strictEqual(await page.$eval('dialog .attach input', (e) => e.dir), 'ltr');
    assert.strictEqual(await page.$eval('dialog .attach a.btn', (e) => e.href), FOLDER_URL);

    await page.keyboard.press('Escape'); await page.waitForSelector('dialog:not([open])', { state: 'attached' });
    await page.click('[data-job-id="J004"] .title-btn'); await page.waitForSelector('dialog[open] .files');
    assert((await page.textContent('dialog .files')).includes('لا توجد ملفات مرتبطة'));
    await page.keyboard.press('Escape'); await page.waitForSelector('dialog:not([open])', { state: 'attached' });
    await openDetailOf(page, 'J005');
    assert((await page.textContent('dialog .files .file-row')).includes('خارج المجلد'));
    assert.deepStrictEqual(errors, []); await ctx.close();
  });

  await test('V2: linking from the folder list calls linkFile(jobId, type, fileId) only; dialog and card update; Tracker calls untouched', async () => {
    const { page, ctx, errors } = await open({ viewport: { width: 1280, height: 900 } });
    await openDetailOf(page, 'J010');
    await page.selectOption('dialog .attach select:first-of-type', 'Cover Letter');
    await page.selectOption('dialog .attach select:nth-of-type(2)', F2);
    await page.click('dialog .attach button.primary');
    await page.waitForSelector('dialog .file-row');
    assert.deepStrictEqual(await linkCalls(page), [['linkFile', 'J010', 'Cover Letter', F2]]);
    assert((await page.textContent('dialog .file-row')).includes('Cover Letter - Company 1.docx'));
    assert((await page.textContent('#toast')).includes('J010'));
    assert.strictEqual(await page.$eval('[data-job-id="J010"] a.btn[title]', (a) => a.textContent), 'Cover Letter');
    assert.strictEqual(await page.evaluate(() => window.__calls.filter((c) => c[0] === 'setDecision').length), 0);
    assert.strictEqual(await page.$eval('[data-job-id="J010"]', (e) => e.getAttribute('data-decision')), '');
    // the form is reset after success
    assert.strictEqual(await page.$eval('dialog .attach select:nth-of-type(2)', (e) => e.value), '');
    assert.deepStrictEqual(errors, []); await ctx.close();
  });

  await test('V2: a pasted link wins over the dropdown and is sent as typed; empty input is rejected without a server call', async () => {
    const { page, ctx } = await open({ viewport: { width: 1280, height: 900 } });
    await openDetailOf(page, 'J011');
    await page.click('dialog .attach button.primary');
    assert.strictEqual(await page.$eval('#toast', (e) => e.classList.contains('error')), true);
    assert.deepStrictEqual(await linkCalls(page), []);
    await page.selectOption('dialog .attach select:nth-of-type(2)', F1);
    await page.fill('dialog .attach input', 'https://docs.google.com/document/d/' + F3 + '/edit?usp=sharing');
    await page.click('dialog .attach button.primary');
    await page.waitForSelector('dialog .file-row');
    assert.deepStrictEqual(await linkCalls(page), [['linkFile', 'J011', 'CV', 'https://docs.google.com/document/d/' + F3 + '/edit?usp=sharing']]);
    assert((await page.textContent('dialog .file-row')).includes('السيرة الذاتية'));    // F3, not the dropdown's F1
    await ctx.close();
  });

  await test('V2: server refusals (not in folder, duplicate, busy) show the Arabic message and add nothing', async () => {
    const { page, ctx, errors } = await open({ viewport: { width: 1280, height: 900 } });
    await openDetailOf(page, 'J012');
    await page.fill('dialog .attach input', 'ZZZZZZZZZZZZZZZZZZZZ');
    await page.click('dialog .attach button.primary');
    await page.waitForFunction(() => document.getElementById('toast').classList.contains('error') && document.getElementById('toast').textContent.includes('ليس داخل المجلد'));
    assert.strictEqual(await page.$$eval('dialog .file-row', (r) => r.length), 0);
    assert.strictEqual(await page.$eval('dialog .attach button.primary', (b) => b.disabled), false);       // can retry

    await page.evaluate(() => { window.__srv.failLink = true; });
    await page.fill('dialog .attach input', F1);
    await page.click('dialog .attach button.primary');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('الملف مشغول'));
    assert.strictEqual(await page.$$eval('dialog .file-row', (r) => r.length), 0);

    await page.evaluate(() => { window.__srv.failLink = false; });
    await page.click('dialog .attach button.primary'); await page.waitForSelector('dialog .file-row');
    await page.fill('dialog .attach input', F1);                                                            // same job + type + file again
    await page.click('dialog .attach button.primary');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('مرتبط بهذه الوظيفة مسبقاً'));
    assert.strictEqual(await page.$$eval('dialog .file-row', (r) => r.length), 1);
    assert.deepStrictEqual(errors, []); await ctx.close();
  });

  await test('V2: double-clicking "link" sends one request (button locked while saving)', async () => {
    const { page, ctx } = await open({ viewport: { width: 1280, height: 900 } });
    await openDetailOf(page, 'J013');
    await page.evaluate(() => { window.__srv.delay = 500; });
    await page.fill('dialog .attach input', F1);
    await page.dblclick('dialog .attach button.primary');
    await page.waitForSelector('dialog .file-row');
    assert.strictEqual((await linkCalls(page)).length, 1);
    await ctx.close();
  });

  await test('V2: file names / URLs from Drive or the Sheet never become markup or script; bad URLs fall back to a safe Drive link', async () => {
    const { page, ctx } = await open();
    await page.waitForSelector('[data-job-id="J003"] a.btn[title]');
    assert.strictEqual(await page.evaluate(() => window.__xss), undefined);
    assert.strictEqual(await page.$('img[src="x"]'), null);
    // J003: javascript: url from the server is ignored; the safe URL is rebuilt from the validated file ID
    assert.strictEqual(await page.$eval('[data-job-id="J003"] a.btn[title]', (a) => a.href), 'https://drive.google.com/open?id=' + F4);
    await openDetailOf(page, 'J003');
    assert.strictEqual(await page.$eval('dialog .file-row .file-link', (a) => a.textContent), '<img src=x onerror="window.__xss=7">.pdf');
    assert.strictEqual(await page.$('dialog .files img'), null);
    const opt = await page.$$eval('dialog .attach select:nth-of-type(2) option', (o) => o.map((x) => x.textContent));
    assert(opt.includes('<img src=x onerror="window.__xss=7">.pdf'));
    assert.strictEqual(await page.evaluate(() => window.__xss), undefined);
    // J005: file no longer in the folder and without a name -> shows the ID, still a safe link
    await page.keyboard.press('Escape'); await page.waitForSelector('dialog:not([open])', { state: 'attached' });
    await openDetailOf(page, 'J005');
    assert.strictEqual(await page.$eval('dialog .file-row a.file-link', (a) => a.textContent), 'GoneFileId0123456789');
    const bad = await page.$$eval('a', (as) => as.filter((a) => !/^https:\/\//.test(a.getAttribute('href') || '') || a.rel !== 'noopener noreferrer').length);
    assert.strictEqual(bad, 0);
    await ctx.close();
  });

  await test('V2: the "open folder" link is shown only for an https link on a google.com host', async () => {
    const hostile = ['javascript:window.__xss=9', 'http://drive.google.com/drive/folders/FAKE_FOLDER_ID_0001',
      'https://drive.google.com.evil.example/drive/folders/FAKE_FOLDER_ID_0001', 'https://evil.example/drive/folders/FAKE_FOLDER_ID_0001'];
    for (const url of hostile) {
      const { page, ctx, errors } = await open({ viewport: { width: 1280, height: 900 }, preScript: 'window.__srv.folderUrl = ' + JSON.stringify(url) + ';' });
      await openDetailOf(page, 'J001');
      assert.strictEqual(await page.$('dialog .attach a'), null, 'folder link rendered for ' + url);
      assert.strictEqual(await page.evaluate(() => window.__xss), undefined);
      assert.deepStrictEqual(errors, []); await ctx.close();
    }
    const good = 'https://drive.google.com/drive/u/0/folders/FAKE_FOLDER_ID_0002';
    const { page, ctx } = await open({ viewport: { width: 1280, height: 900 }, preScript: 'window.__srv.folderUrl = ' + JSON.stringify(good) + ';' });
    await openDetailOf(page, 'J001');
    assert.strictEqual(await page.$eval('dialog .attach a.btn', (a) => a.href), good);
    assert.strictEqual(await page.$eval('dialog .attach a.btn', (a) => a.rel), 'noopener noreferrer');
    await ctx.close();
  });

  await test('V2: Files tab/folder failure does not break the jobs; detail shows an error with Retry that recovers', async () => {
    const { page, ctx, errors } = await open({ preScript: 'window.__srv.failFilesNext = true;' });
    assert.strictEqual((await cardIds(page)).length, 30);
    assert.strictEqual(await page.$('[data-job-id="J001"] a.btn[title]'), null);
    await page.click('[data-job-id="J001"] .title-btn'); await page.waitForSelector('dialog[open] .files');
    assert((await page.textContent('dialog .files')).includes('تعذّر قراءة مجلد الملفات'));
    assert.strictEqual(await page.$('dialog .attach'), null);                                             // no form without data
    await page.click('dialog .files button');
    await page.waitForSelector('dialog .file-row');
    assert.strictEqual(await page.$$eval('dialog .file-row', (r) => r.length), 3);
    assert.strictEqual(await page.$$eval('[data-job-id="J001"] a.btn[title]', (a) => a.length), 2);
    // decisions still work while Files had failed
    assert.deepStrictEqual(errors.filter((e) => !/Failed to load resource/.test(e)), []); await ctx.close();
  });

  await test('V2: Refresh also re-reads files (getFiles(true)); a failed refresh keeps the files already shown', async () => {
    const { page, ctx } = await open();
    await page.waitForSelector('[data-job-id="J001"] a.btn[title]');
    await page.evaluate(() => { window.__srv.files.links.push({ jobId: 'J020', type: 'CV', fileId: 'ReFreshedFile0123456', date: '2026-11-25', name: 'Added in Drive.pdf', url: 'https://drive.google.com/file/d/ReFreshedFile0123456/view', inFolder: true }); });
    await page.click('#refresh');
    await page.waitForSelector('[data-job-id="J020"] a.btn[title]');
    assert.deepStrictEqual(await page.evaluate(() => window.__calls.filter((c) => c[0] === 'getFiles')), [['getFiles', false], ['getFiles', true]]);
    await page.evaluate(() => { window.__srv.failFilesNext = true; });
    await page.click('#refresh');
    await page.waitForFunction(() => document.getElementById('toast').classList.contains('error'));
    assert.strictEqual(await page.$$eval('[data-job-id="J001"] a.btn[title]', (a) => a.length), 2);
    assert.strictEqual(await page.$$eval('[data-job-id="J020"] a.btn[title]', (a) => a.length), 1);
    await ctx.close();
  });

  await test('V2: mobile layout - no horizontal overflow with files on cards and in the dialog; 44px targets', async () => {
    const { page, ctx } = await open({ mobile: true });
    await page.waitForSelector('[data-job-id="J001"] a.btn[title]');
    assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.tap('[data-job-id="J001"] .title-btn'); await page.waitForSelector('dialog[open] .files');
    assert.strictEqual(await page.evaluate(() => { const d = document.getElementById('detailBody'); return d.scrollWidth <= d.clientWidth + 1; }), true);
    const small = await page.$$eval('dialog .files .btn, dialog .files select, dialog .files input, dialog .files button', (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 43).length);
    assert.strictEqual(small, 0);
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

  { // V2: card with CV / Cover Letter buttons (mobile light) and the Files section (mobile light, desktop dark)
    const { page, ctx } = await open({ mobile: true });
    await page.waitForSelector('[data-job-id="J001"] a.btn[title]');
    await page.$eval('[data-job-id="J001"]', (e) => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, 'v2-mobile-card.png') });
    await page.tap('[data-job-id="J001"] .title-btn'); await page.waitForSelector('dialog[open] .files');
    await page.evaluate(() => { const b = document.getElementById('detailBody'); b.scrollTop = b.scrollHeight; });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, 'v2-mobile-files.png') }); await ctx.close();
  }
  {
    const { page, ctx } = await open({ viewport: { width: 1280, height: 900 }, dark: true });
    await page.click('[data-job-id="J003"] .title-btn'); await page.waitForSelector('dialog[open] .files');
    await page.evaluate(() => { const b = document.getElementById('detailBody'); b.scrollTop = b.scrollHeight; });
    await page.screenshot({ path: path.join(OUT, 'v2-desktop-dark-files.png') }); await ctx.close();
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
