// Runs Code.gs in a Node vm against mocked Apps Script services (Sheet, Drive, Cache, Lock, Properties).
// Usage: node tests/server.test.js [path/to/Code.gs]   (default: src/Code.gs)
'use strict';
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');

const CODE = fs.readFileSync(process.argv[2] || 'src/Code.gs', 'utf8');
const HEADERS = ['ID', 'Title', 'Category', 'Company', 'Location', 'Work Mode', 'Salary', 'Source', 'Job URL',
  'Apply URL', 'Date Found', 'Match %', 'Hard Stop', 'Decision', 'Status', 'Package', 'Notes'];
const STATUSES = ['New', 'Needs Input', 'Ready', 'Applied', 'Closed', 'Skipped'];
const FOLDER = 'FAKE_FOLDER_ID_0001';       // fake id; the app reads the real one from Script Property FILES_FOLDER_ID
const FILES_HEADERS = ['JobID', 'Type', 'FileId', 'Date'];

function makeRows(n) {
  const rows = [];
  for (let i = 1; i <= n; i++) {
    const id = 'J' + String(i).padStart(3, '0');
    rows.push([
      id, 'Job title ' + i, i % 2 ? 'Backend' : 'Data', 'Company ' + i, 'City', i % 3 ? 'Remote' : 'Hybrid',
      '€' + (2000 + i * 10), 'LinkedIn', 'https://example.com/jobs/' + i,
      i % 4 === 0 ? 'SAME (Apply button on the Job URL page)' : 'https://example.com/apply/' + i,
      '2026-11-' + String(1 + (i % 25)).padStart(2, '0'), String(40 + i * 2),
      i === 3 ? 'Needs onsite 5 days' : (i === 4 ? 'To confirm: relocation required?' : ''),
      '', STATUSES[i % 6], 'CV+CL', 'T50 M26 D5. ملاحظات عربية طويلة للوظيفة رقم ' + i
    ]);
  }
  return rows;
}

function defaultDriveFiles() {
  return [
    { id: 'FILE_CV_OLD_0001', name: 'CV 2025.pdf', updated: 1000, parents: [FOLDER] },
    { id: 'FILE_CV_NEW_0002', name: 'CV 2026 (Backend).pdf', updated: 3000, parents: [FOLDER] },
    { id: 'FILE_CL_00000003', name: 'Cover letter ـ شركة الأمل.docx', updated: 2000, parents: [FOLDER] },
    { id: 'FILE_TRASHED_004', name: 'old.pdf', updated: 500, parents: [FOLDER], trashed: true },
    { id: 'FILE_ELSEWHERE_05', name: 'elsewhere.pdf', updated: 4000, parents: ['SOME_OTHER_FOLDER'] }
  ];
}

const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]';
const fmtDate = (d) => d.toISOString().slice(0, 10);

function setup(opts) {
  opts = opts || {};
  const log = { writes: [], filesOps: [], inserted: [], guideTouched: 0, displayReads: 0, flushes: 0 };
  const links = opts.links || {};     // "row,col" (1-based) -> url, Tracker only

  function makeSheet(name, headersIn, rowsIn) {
    const st = { headers: headersIn.slice(), data: rowsIn.map((r) => r.slice()) };
    const cell = (r, c) => (r === 1 ? st.headers[c - 1] : (st.data[r - 2] ? st.data[r - 2][c - 1] : ''));
    const isTracker = name === 'Tracker';
    const idCol = () => st.headers.indexOf('ID');
    const sheet = {
      getName: () => name,
      getLastRow: () => (st.headers.length ? st.data.length + 1 : 0),
      getLastColumn: () => st.headers.length,
      setFrozenRows: (n) => { log.filesOps.push({ op: 'setFrozenRows', sheet: name, n }); },
      getRange(r, c, nr, nc) {
        nr = nr || 1; nc = nc || 1;
        const range = {
          getDisplayValues() {
            log.displayReads++;
            if (opts.throwOnRead && isTracker) throw new Error('boom');
            const out = [];
            for (let i = 0; i < nr; i++) {
              const row = [];
              for (let j = 0; j < nc; j++) {
                const v = cell(r + i, c + j);
                row.push(isDate(v) ? fmtDate(v) : String(v === undefined ? '' : v));
              }
              out.push(row);
            }
            if (isTracker && opts.afterIdColumnRead && r === 2 && nc === 1 && c === idCol() + 1) opts.afterIdColumnRead(sheetApi);
            return out;
          },
          getDisplayValue() { const v = cell(r, c); return isDate(v) ? fmtDate(v) : String(v); },
          getRichTextValues() {
            const out = [];
            for (let i = 0; i < nr; i++) out.push([{ getLinkUrl: () => links[(r + i) + ',' + c] || null }]);
            return out;
          },
          setValue(v) {
            if (!isTracker) throw new Error('setValue only expected on Tracker');
            log.writes.push({ row: r, col: c, header: st.headers[c - 1], op: 'set', value: v, id: st.data[r - 2][idCol()] });
            st.data[r - 2][c - 1] = v;
          },
          clearContent() {
            if (!isTracker) throw new Error('clearContent only expected on Tracker');
            log.writes.push({ row: r, col: c, header: st.headers[c - 1], op: 'clear', id: st.data[r - 2][idCol()] });
            st.data[r - 2][c - 1] = '';
          },
          setValues(values) {
            if (isTracker) throw new Error('setValues on Tracker is forbidden');
            log.filesOps.push({ op: 'setValues', sheet: name, row: r, col: c, values: values.map((x) => x.slice()) });
            values.forEach((vals, i) => {
              if (r + i === 1) { st.headers = vals.slice(); }
              else { st.data[r + i - 2] = vals.slice(); }
            });
            return range;
          },
          setNumberFormat(f) { log.filesOps.push({ op: 'setNumberFormat', sheet: name, row: r, col: c, format: f }); return range; },
          setFontWeight(w) { log.filesOps.push({ op: 'setFontWeight', sheet: name, weight: w }); return range; }
        };
        return range;
      }
    };
    const sheetApi = {
      sortById(desc) { st.data.sort((a, b) => (desc ? -1 : 1) * a[idCol()].localeCompare(b[idCol()])); },
      data: () => st.data, headers: () => st.headers
    };
    return { sheet, sheetApi, st };
  }

  const tracker = makeSheet('Tracker', opts.headers || HEADERS, opts.rows || makeRows(27));
  const sheets = [{ name: 'Tracker', obj: tracker }, { name: 'Guide', obj: null }];
  if (opts.filesRows || opts.filesHeaders) {
    sheets.push({ name: 'Files', obj: makeSheet('Files', opts.filesHeaders || FILES_HEADERS, opts.filesRows || []) });
  }

  const guide = new Proxy({}, { get() { log.guideTouched++; throw new Error('Guide touched'); } });
  const ss = {
    getSheetByName: (n) => { const s = sheets.find((x) => x.name === n); return s ? (s.obj ? s.obj.sheet : guide) : null; },
    getNumSheets: () => sheets.length,
    insertSheet: (n, idx) => { log.inserted.push({ name: n, idx }); const obj = makeSheet(n, [], []); sheets.push({ name: n, obj }); return obj.sheet; }
  };

  const store = new Map();
  const cacheLog = { putAll: 0, removeAll: 0 };
  const cache = {
    get: (k) => (store.has(k) ? store.get(k) : null),
    getAll: (ks) => { const o = {}; ks.forEach((k) => { if (store.has(k)) o[k] = store.get(k); }); return o; },
    putAll: (o) => { cacheLog.putAll++; Object.keys(o).forEach((k) => { if (Buffer.byteLength(o[k], 'utf8') > 100 * 1024) throw new Error('value too large'); store.set(k, o[k]); }); },
    removeAll: (ks) => { cacheLog.removeAll++; ks.forEach((k) => store.delete(k)); }
  };
  let held = false;
  const lock = { tryLock: () => { if (opts.lockBusy) return false; held = true; return true; }, releaseLock: () => { held = false; } };
  const html = { calls: [] };
  const chain = { setTitle(t) { html.calls.push(['title', t]); return chain; }, addMetaTag(a, b) { html.calls.push(['meta', a, b]); return chain; } };

  // ---- Drive mock
  const driveFiles = opts.driveFiles || defaultDriveFiles();
  const folders = Object.assign({ [FOLDER]: true, OTHER_FOLDER: true }, opts.folders || {});
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const mkFolder = (id) => ({
    getId: () => id, getUrl: () => 'https://drive.google.com/drive/folders/' + id,
    getFiles: () => iter(driveFiles.filter((f) => !f.trashed && f.parents.includes(id)).map(mkFile))
  });
  const mkFile = (f) => ({
    getId: () => f.id, getName: () => f.name, getUrl: () => 'https://drive.google.com/file/d/' + f.id + '/view?usp=drivesdk',
    getMimeType: () => 'application/pdf', getLastUpdated: () => new Date(f.updated), isTrashed: () => !!f.trashed,
    getParents: () => iter(f.parents.map(mkFolder))
  });
  const DriveApp = {
    getFolderById: (id) => { if (opts.driveDown || !folders[id]) throw new Error('Folder not found'); return mkFolder(id); },
    getFileById: (id) => { if (opts.driveDown) throw new Error('down'); const f = driveFiles.find((x) => x.id === id); if (!f) throw new Error('File not found'); return mkFile(f); }
  };

  const props = Object.assign({ FILES_FOLDER_ID: FOLDER }, opts.props || {});   // Script Properties; set a key to null to unset it
  const ctx = vm.createContext({
    console: { warn() {}, error() {}, log() {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => (opts.noSpreadsheet ? null : ss), flush: () => { log.flushes++; } },
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => lock },
    HtmlService: { createHtmlOutputFromFile: (n) => { html.calls.push(['file', n]); return chain; } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null }) },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (d, tz, f) => { assert.strictEqual(f, 'yyyy-MM-dd'); return fmtDate(d); } },
    DriveApp
  });
  vm.runInContext(CODE, ctx);
  const call = (fn, ...args) => JSON.parse(JSON.stringify(ctx[fn](...args)));
  const filesSheet = () => { const s = sheets.find((x) => x.name === 'Files'); return s ? s.obj : null; };
  return { ctx, call, log, sheetApi: tracker.sheetApi, store, cacheLog, html, isLockHeld: () => held, filesSheet, trackerData: () => JSON.stringify(tracker.st.data) };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).split('\n').slice(0, 4).join('\n       ')); }
}
const arabic = (s) => /[؀-ۿ]/.test(s);

/* ======================================================================== V1 */
console.log('Code.gs — V1');

test('doGet serves Index with title and viewport', () => {
  const t = setup(); t.ctx.doGet();
  assert.deepStrictEqual(t.html.calls[0], ['file', 'Index']);
  assert(t.html.calls.some((c) => c[0] === 'meta' && c[1] === 'viewport'));
  assert(t.html.calls.some((c) => c[0] === 'title'));
});

test('getJobs returns all 27 jobs with parsed fields', () => {
  const t = setup(); const r = t.call('getJobs');
  assert.strictEqual(r.ok, true); assert.strictEqual(r.jobs.length, 27); assert.strictEqual(r.cached, false);
  const j1 = r.jobs[0];
  assert.strictEqual(j1.id, 'J001'); assert.strictEqual(j1.match, 42); assert.strictEqual(typeof j1.match, 'number');
  assert.strictEqual(j1.dateFound, '2026-11-02'); assert.strictEqual(j1.pkg, 'CV+CL');
  assert(j1.notes.startsWith('T50 M26 D5.'));
  assert.strictEqual(r.jobs[2].hardStopKind, 'stop'); assert.strictEqual(r.jobs[3].hardStopKind, 'confirm'); assert.strictEqual(r.jobs[0].hardStopKind, '');
  assert.strictEqual(r.jobs[3].applyUrl, 'SAME (Apply button on the Job URL page)');
  assert(!('row' in j1));
});

test('second getJobs is served from cache; forceRefresh bypasses it', () => {
  const t = setup(); t.call('getJobs'); const reads = t.log.displayReads;
  const r2 = t.call('getJobs'); assert.strictEqual(r2.cached, true); assert.strictEqual(t.log.displayReads, reads);
  const r3 = t.call('getJobs', true); assert.strictEqual(r3.cached, false); assert(t.log.displayReads > reads);
  assert.strictEqual(t.call('getJobs').cached, true);
});

test('setDecision Go writes exactly ONE cell: Decision of that ID (even after the Sheet is sorted)', () => {
  const t = setup(); t.call('getJobs');
  t.sheetApi.sortById(true);
  const r = t.call('setDecision', 'J005', 'Go');
  assert.strictEqual(r.ok, true); assert.strictEqual(r.job.id, 'J005'); assert.strictEqual(r.job.decision, 'Go');
  assert.strictEqual(t.log.writes.length, 1);
  const w = t.log.writes[0];
  assert.strictEqual(w.header, 'Decision'); assert.strictEqual(w.id, 'J005'); assert.strictEqual(w.value, 'Go');
  assert.strictEqual(t.log.guideTouched, 0);
  assert.strictEqual(t.log.filesOps.length, 0);
  const others = t.sheetApi.data().filter((row) => row[13] !== '');
  assert.strictEqual(others.length, 1); assert.strictEqual(others[0][0], 'J005');
});

test('write invalidates the cache; next getJobs shows the new Decision', () => {
  const t = setup(); t.call('getJobs'); assert.strictEqual(t.call('getJobs').cached, true);
  t.call('setDecision', 'J010', 'Skip');
  const r = t.call('getJobs'); assert.strictEqual(r.cached, false);
  assert.strictEqual(r.jobs.find((j) => j.id === 'J010').decision, 'Skip');
  assert(t.log.flushes >= 1);
});

test('Skip then Clear: Clear uses clearContent and returns empty decision', () => {
  const t = setup(); t.call('setDecision', 'J002', 'Skip');
  const r = t.call('setDecision', 'J002', '');
  assert.strictEqual(r.ok, true); assert.strictEqual(r.job.decision, '');
  assert.deepStrictEqual(t.log.writes.map((w) => w.op), ['set', 'clear']);
  assert(t.log.writes.every((w) => w.header === 'Decision'));
  assert.strictEqual(t.call('setDecision', 'J002', null).ok, true);
});

test('invalid Decision values are rejected and nothing is written', () => {
  const t = setup();
  ['go', 'GO', 'Skipped', ' Go', 'Go ', 'Applied', 'Go;DROP', '=1+1', 123, true, {}, ['Go'], 'Status'].forEach((v) => {
    const r = t.call('setDecision', 'J001', v);
    assert.strictEqual(r.ok, false, 'accepted ' + JSON.stringify(v)); assert.strictEqual(r.code, 'BAD_DECISION'); assert(arabic(r.error));
  });
  assert.strictEqual(t.log.writes.length, 0);
});

test('invalid IDs are rejected', () => {
  const t = setup();
  ['', '  ', undefined, null, 5, {}, 'J001\nJ002', '../x', 'J001;', 'a'.repeat(50)].forEach((v) => {
    const r = t.call('setDecision', v, 'Go'); assert.strictEqual(r.ok, false, JSON.stringify(v)); assert.strictEqual(r.code, 'BAD_ID');
  });
  assert.strictEqual(t.log.writes.length, 0);
});

test('unknown ID -> Arabic not-found error, nothing written', () => {
  const t = setup(); const r = t.call('setDecision', 'J999', 'Go');
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'NOT_FOUND'); assert(r.error.includes('J999'));
  assert.strictEqual(t.log.writes.length, 0);
});

test('duplicate ID -> refuses to write', () => {
  const rows = makeRows(5); rows[3][0] = 'J002';
  const t = setup({ rows }); const r = t.call('setDecision', 'J002', 'Go');
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'DUPLICATE'); assert.strictEqual(t.log.writes.length, 0);
});

test('ID re-check: rows move between find and write -> aborts, nothing written', () => {
  let fired = false;
  const t = setup({ afterIdColumnRead: (api) => { if (!fired) { fired = true; api.sortById(true); } } });
  const r = t.call('setDecision', 'J001', 'Go');
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'ID_CHANGED'); assert.strictEqual(t.log.writes.length, 0);
});

test('columns are found by header name, not position (reordered columns work)', () => {
  const order = HEADERS.map((_, i) => i).reverse();
  const headers = order.map((i) => HEADERS[i]);
  const rows = makeRows(6).map((r) => order.map((i) => r[i]));
  const t = setup({ headers, rows });
  const r = t.call('getJobs'); assert.strictEqual(r.ok, true); assert.strictEqual(r.jobs[0].id, 'J001'); assert.strictEqual(r.jobs[0].company, 'Company 1');
  assert.strictEqual(t.call('setDecision', 'J003', 'Go').ok, true);
  assert.strictEqual(t.log.writes[0].header, 'Decision'); assert.strictEqual(t.log.writes[0].id, 'J003');
});

test('extra columns after Q are ignored', () => {
  const headers = HEADERS.concat(['My extra']); const rows = makeRows(3).map((r) => r.concat(['x']));
  const t = setup({ headers, rows }); assert.strictEqual(t.call('getJobs').jobs.length, 3);
});

test('missing header -> clear Arabic error naming the column and the tab', () => {
  const headers = HEADERS.slice(); headers[headers.indexOf('Decision')] = 'Decison';
  const t = setup({ headers }); const r = t.call('getJobs');
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'MISSING_HEADER'); assert(r.error.includes('Decision') && r.error.includes('Tracker'));
  const w = t.call('setDecision', 'J001', 'Go'); assert.strictEqual(w.ok, false); assert.strictEqual(t.log.writes.length, 0);
});

test('Match % parsing: "85%", "85,5", "", garbage', () => {
  const rows = makeRows(4); rows[0][11] = '85%'; rows[1][11] = '85,5'; rows[2][11] = ''; rows[3][11] = 'n/a';
  const t = setup({ rows }); assert.deepStrictEqual(t.call('getJobs').jobs.map((j) => j.match), [85, 85.5, null, null]);
});

test('rows without an ID are skipped', () => {
  const rows = makeRows(4); rows[1][0] = '';
  assert.strictEqual(setup({ rows }).call('getJobs').jobs.length, 3);
});

test('hyperlink behind a label is used for URL cells; plain text stays text', () => {
  const rows = makeRows(4); rows[0][8] = 'Open posting'; rows[3][9] = 'SAME (Apply button on the Job URL page)';
  const t = setup({ rows, links: { '2,9': 'https://real.example/job', '5,10': 'http://insecure.example' } });
  const j = t.call('getJobs').jobs;
  assert.strictEqual(j[0].jobUrl, 'https://real.example/job');
  assert.strictEqual(j[3].applyUrl, 'SAME (Apply button on the Job URL page)');
});

test('large data is cached in chunks under 100 KB and round-trips exactly (emoji at boundaries)', () => {
  const rows = makeRows(600).map((r, i) => { r[16] = ('T50 M26 D5. ' + '😀ملاحظة طويلة جداً '.repeat(60)) + i; return r; });
  const t = setup({ rows }); const a = t.call('getJobs'); assert.strictEqual(a.cached, false);
  const chunks = [...t.store.keys()].filter((k) => /:\d+$/.test(k)).length; assert(chunks > 3, 'expected several chunks, got ' + chunks);
  const b = t.call('getJobs'); assert.strictEqual(b.cached, true); assert.deepStrictEqual(b.jobs, a.jobs);
  for (const v of t.store.values()) assert(!/[\uD800-\uDBFF]$/.test(v), 'chunk ends with a lone high surrogate');
});

test('an expired chunk is treated as a cache miss, not an error', () => {
  const t = setup(); t.call('getJobs'); t.store.delete([...t.store.keys()].find((k) => /:0$/.test(k)));
  const r = t.call('getJobs'); assert.strictEqual(r.ok, true); assert.strictEqual(r.cached, false);
});

test('lock busy: setDecision reports BUSY (Arabic), getJobs still answers without caching', () => {
  const t = setup({ lockBusy: true });
  const w = t.call('setDecision', 'J001', 'Go'); assert.strictEqual(w.ok, false); assert.strictEqual(w.code, 'BUSY'); assert.strictEqual(t.log.writes.length, 0);
  const r = t.call('getJobs'); assert.strictEqual(r.ok, true); assert.strictEqual(r.cached, false);
  assert.strictEqual(t.call('getJobs').cached, false);
});

test('lock is always released (success and failure)', () => {
  const t = setup(); t.call('setDecision', 'J001', 'Go'); assert.strictEqual(t.isLockHeld(), false);
  t.call('setDecision', 'J404', 'Go'); assert.strictEqual(t.isLockHeld(), false);
  t.call('getJobs', true); assert.strictEqual(t.isLockHeld(), false);
});

test('unexpected exception -> generic Arabic message, no stack leaked', () => {
  const r = setup({ throwOnRead: true }).call('getJobs');
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'UNEXPECTED'); assert(!/boom|at /.test(r.error));
});

test('script not bound to a spreadsheet -> clear Arabic error', () => {
  const r = setup({ noSpreadsheet: true }).call('getJobs'); assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'NO_SS');
});

test('Guide tab is never touched', () => {
  const t = setup(); t.call('getJobs'); t.call('setDecision', 'J001', 'Go'); t.call('setDecision', 'J001', '');
  assert.strictEqual(t.log.guideTouched, 0);
});

test('only doGet / getJobs / setDecision are public; helpers end with "_"', () => {
  const t = setup();
  const pub = Object.keys(t.ctx).filter((k) => typeof t.ctx[k] === 'function' && !k.endsWith('_')).sort();
  assert.deepStrictEqual(pub, ['doGet', 'getJobs', 'setDecision']);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
