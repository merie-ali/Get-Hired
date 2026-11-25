/**
 * Job vacancies — Web App  |  VERSION 1
 * -----------------------------------------------------------------------------
 * Container-bound script for the Google Sheet "Job vacancies"
 *
 * Rules this file enforces:
 *   - Tracker columns are located by the header text in row 1, never by position.
 *   - Rows are located by ID, never by row number (the Sheet may be sorted or filtered).
 *   - The ONLY thing this app ever writes is one Decision cell: "Go", "Skip" or empty.
 *   - Status and every other column are read-only here. The "Guide" tab is never touched.
 *   - Tracker headers, column order and IDs are never changed; no columns are added.
 *
 * Layout of this file:
 *   1. CONFIG and Arabic messages
 *   2. Web app entry point (doGet)
 *   3. Public API called from the browser (getJobs, setDecision)
 *   4. Tracker domain logic (read rows, find by ID, build job objects)
 *   5. Generic Sheet helpers (reusable for the Files / Chat tabs in V2 / V3)
 *   6. Cache helpers
 *   7. Response and error helpers
 *   8. Extension points for V2 and V3 (comments only, nothing implemented)
 *
 * Functions whose names end with "_" are private: google.script.run cannot call them.
 */

/* =============================================================================
 * 1. CONFIG
 * ========================================================================== */

var CONFIG = {
  APP_TITLE: 'الوظائف الشاغرة',

  TRACKER: {
    SHEET: 'Tracker',
    // client key -> header text in row 1 of Tracker. Do not reorder or rename headers in the Sheet.
    FIELDS: {
      id: 'ID',
      title: 'Title',
      category: 'Category',
      company: 'Company',
      location: 'Location',
      workMode: 'Work Mode',
      salary: 'Salary',
      source: 'Source',
      jobUrl: 'Job URL',
      applyUrl: 'Apply URL',
      dateFound: 'Date Found',
      match: 'Match %',
      hardStop: 'Hard Stop',
      decision: 'Decision',
      status: 'Status',
      pkg: 'Package',
      notes: 'Notes'
    },
    URL_FIELDS: ['jobUrl', 'applyUrl']
  },

  // Accepted by setDecision. Empty string means "clear".
  DECISIONS: ['Go', 'Skip'],

  CACHE: {
    KEY: 'tracker:jobs:v1',
    TTL_SEC: 60,          // short on purpose: edits made directly in the Sheet appear within a minute
    CHUNK_CHARS: 30000    // CacheService allows ~100 KB per value; Arabic text is 2-3 bytes per char
  },

  LOCK_WAIT_MS: 10000
};

// Messages shown in the UI. Arabic, with technical terms left in English.
var MSG = {
  NO_SS: 'تعذّر الوصول إلى ملف Google Sheet. تأكد أن السكربت مرتبط بالملف (من داخل الملف: Extensions > Apps Script).',
  NO_TRACKER: 'لم يتم العثور على تبويب «Tracker» في الملف.',
  EMPTY_TRACKER: 'تبويب «Tracker» فارغ ولا يحتوي على صف العناوين.',
  MISSING_HEADER: function (h) { return 'العمود «' + h + '» غير موجود في الصف الأول من تبويب Tracker.'; },
  BAD_ID: 'معرّف الوظيفة (ID) غير صالح.',
  BAD_DECISION: 'قيمة Decision غير صالحة. المسموح فقط: Go أو Skip أو فارغ.',
  NOT_FOUND: function (id) { return 'لم يتم العثور على الوظيفة «' + id + '». ربما حُذفت أو تغيّر معرّفها. اضغط تحديث ثم حاول مرة أخرى.'; },
  DUPLICATE: function (id) { return 'المعرّف «' + id + '» مكرر في تبويب Tracker. تم إيقاف الكتابة حفاظاً على بياناتك؛ صحّح التكرار في الملف أولاً.'; },
  ID_CHANGED: 'تغيّر ترتيب الصفوف أثناء العملية، لذلك لم يتم تعديل أي شيء. اضغط تحديث ثم حاول مرة أخرى.',
  BUSY: 'الملف مشغول بعملية أخرى. انتظر لحظات ثم حاول مرة أخرى.',
  UNEXPECTED: 'حدث خطأ غير متوقع. حاول مرة أخرى، وإن تكرر الخطأ فراجع سجل التنفيذ (Executions) في Apps Script.'
};

/* =============================================================================
 * 2. WEB APP ENTRY POINT
 * ========================================================================== */

function doGet() {
  // V2 / V3: if Index.html grows, split CSS/JS into separate .html files and switch to
  // HtmlService.createTemplateFromFile('Index') with an include_() helper.
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(CONFIG.APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* =============================================================================
 * 3. PUBLIC API (called from the browser through google.script.run)
 *    Every function returns { ok: true, ... } or { ok: false, code, error }.
 *    "error" is an Arabic message that is safe to show to the user.
 * ========================================================================== */

/**
 * Returns every job in Tracker.
 * @param {boolean} forceRefresh true = skip the cache and re-read the Sheet (Refresh button)
 * @return {{ok:boolean, jobs?:Object[], fetchedAt?:number, cached?:boolean, error?:string}}
 */
function getJobs(forceRefresh) {
  return run_(function () {
    var force = forceRefresh === true;

    if (!force) {
      var hit = cacheGet_();
      if (hit) return ok_({ jobs: hit.jobs, fetchedAt: hit.fetchedAt, cached: true });
    }

    // Read and fill the cache under the same lock a write uses. Otherwise a slow read could
    // put pre-write data into the cache just after setDecision invalidated it.
    var lock = LockService.getScriptLock();
    var locked = lock.tryLock(CONFIG.LOCK_WAIT_MS);
    try {
      if (locked && !force) {
        var again = cacheGet_();
        if (again) return ok_({ jobs: again.jobs, fetchedAt: again.fetchedAt, cached: true });
      }
      var snapshot = { jobs: readAllJobs_(), fetchedAt: Date.now() };
      if (locked) cachePut_(snapshot);   // if the lock was not obtained, still answer but do not cache
      return ok_({ jobs: snapshot.jobs, fetchedAt: snapshot.fetchedAt, cached: false });
    } finally {
      if (locked) lock.releaseLock();
    }
  });
}

/**
 * Writes the Decision cell of ONE job, found by ID.
 * @param {string} jobId    e.g. "J007"
 * @param {string} decision "Go", "Skip" or "" (clear). Anything else is rejected.
 * @return {{ok:boolean, job?:Object, error?:string}} the updated job, re-read from the Sheet
 */
function setDecision(jobId, decision) {
  return run_(function () {
    var id = normalizeId_(jobId);
    var value = normalizeDecision_(decision);

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) throw appError_('BUSY', MSG.BUSY);

    try {
      var sheet = getTrackerSheet_();
      var ctx = getContext_(sheet, CONFIG.TRACKER.FIELDS);

      var row = findRowById_(sheet, ctx, id);      // reads the ID column only

      // Re-check right before writing: the Sheet may have been sorted since we looked.
      var idNow = String(sheet.getRange(row, ctx.col.id + 1).getDisplayValue()).trim();
      if (idNow !== id) throw appError_('ID_CHANGED', MSG.ID_CHANGED);

      var cell = sheet.getRange(row, ctx.col.decision + 1);   // the one and only cell we write
      if (value === '') {
        cell.clearContent();
      } else {
        cell.setValue(value);
      }
      SpreadsheetApp.flush();

      return ok_({ job: readJobs_(sheet, ctx, row, 1)[0] });
    } finally {
      cacheClear_();          // invalidate on every write attempt, even a failed one
      lock.releaseLock();
    }
  });
}

/* =============================================================================
 * 4. TRACKER DOMAIN LOGIC
 * ========================================================================== */

function getTrackerSheet_() {
  var sheet = getSpreadsheet_().getSheetByName(CONFIG.TRACKER.SHEET);
  if (!sheet) throw appError_('NO_TRACKER', MSG.NO_TRACKER);
  return sheet;
}

function readAllJobs_() {
  var sheet = getTrackerSheet_();
  var ctx = getContext_(sheet, CONFIG.TRACKER.FIELDS);
  return readJobs_(sheet, ctx, 2, sheet.getLastRow() - 1);
}

/** Reads `numRows` rows starting at `firstRow` and returns job objects (rows without an ID are skipped). */
function readJobs_(sheet, ctx, firstRow, numRows) {
  if (numRows < 1) return [];
  // Display values: no Date objects ever reach the client.
  var values = sheet.getRange(firstRow, 1, numRows, ctx.lastCol).getDisplayValues();
  var links = readLinkFallbacks_(sheet, ctx, firstRow, numRows);
  var jobs = [];
  for (var i = 0; i < values.length; i++) {
    var job = rowToJob_(values[i], ctx, links, i);
    if (job.id) jobs.push(job);
  }
  return jobs;
}

function rowToJob_(row, ctx, links, i) {
  var job = {};
  Object.keys(CONFIG.TRACKER.FIELDS).forEach(function (key) {
    var v = row[ctx.col[key]];
    job[key] = (v === null || v === undefined) ? '' : String(v).trim();
  });

  // If a URL cell shows a label instead of the URL but carries a hyperlink, use the hyperlink.
  CONFIG.TRACKER.URL_FIELDS.forEach(function (key) {
    var fallback = links[key] && links[key][i];
    if (!isHttps_(job[key]) && isHttps_(fallback)) job[key] = fallback;
  });

  job.match = parseMatch_(job.match);                 // number or null
  job.hardStopKind = hardStopKind_(job.hardStop);     // '' | 'stop' | 'confirm'
  return job;
}

/** Hyperlinks behind URL cells (rich text). Failure here must never break loading. */
function readLinkFallbacks_(sheet, ctx, firstRow, numRows) {
  var out = {};
  CONFIG.TRACKER.URL_FIELDS.forEach(function (key) {
    out[key] = null;
    try {
      var rich = sheet.getRange(firstRow, ctx.col[key] + 1, numRows, 1).getRichTextValues();
      out[key] = rich.map(function (r) {
        var u = r[0] && r[0].getLinkUrl();
        return u ? String(u) : '';
      });
    } catch (err) {
      console.warn('Link fallback unavailable for ' + key + ': ' + err);
    }
  });
  return out;
}

/** "85", "85%", "85,5" -> number; anything else -> null. Works on display strings. */
function parseMatch_(s) {
  if (s === '' || s === null || s === undefined) return null;
  var n = parseFloat(String(s).replace('%', '').replace(',', '.').trim());
  return isFinite(n) ? n : null;
}

/** '' = no hard stop, 'confirm' = "To confirm: ..." (a question, not an exclusion), 'stop' = possible exclusion. */
function hardStopKind_(s) {
  if (!s) return '';
  return /^to confirm:/i.test(s) ? 'confirm' : 'stop';
}

function isHttps_(s) {
  return typeof s === 'string' && /^https:\/\//i.test(s.trim());
}

function normalizeId_(jobId) {
  var id = (typeof jobId === 'string') ? jobId.trim() : '';
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(id)) throw appError_('BAD_ID', MSG.BAD_ID);
  return id;
}

/** Whitelist: "Go", "Skip" or empty. Everything else is rejected, not "fixed". */
function normalizeDecision_(decision) {
  if (decision === null || decision === undefined || decision === '') return '';
  if (typeof decision === 'string' && CONFIG.DECISIONS.indexOf(decision) !== -1) return decision;
  throw appError_('BAD_DECISION', MSG.BAD_DECISION);
}

/** 1-based row number of the job with this ID. Reads only the ID column. */
function findRowById_(sheet, ctx, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw appError_('NOT_FOUND', MSG.NOT_FOUND(id));
  var ids = sheet.getRange(2, ctx.col.id + 1, lastRow - 1, 1).getDisplayValues();
  var found = -1;
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === id) {
      if (found !== -1) throw appError_('DUPLICATE', MSG.DUPLICATE(id));
      found = i;
    }
  }
  if (found === -1) throw appError_('NOT_FOUND', MSG.NOT_FOUND(id));
  return found + 2;
}

/* =============================================================================
 * 5. GENERIC SHEET HELPERS (reuse these for the "Files" and "Chat" tabs later)
 * ========================================================================== */

function getSpreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw appError_('NO_SS', MSG.NO_SS);
  return ss;
}

/**
 * Maps header names (row 1) to zero-based column indexes.
 * @param {Sheet} sheet
 * @param {Object} fields  clientKey -> header text; every header listed here must exist
 * @return {{lastCol:number, col:Object}} col[clientKey] = zero-based index
 */
function getContext_(sheet, fields) {
  var lastCol = sheet.getLastColumn();
  if (sheet.getLastRow() < 1 || lastCol < 1) throw appError_('EMPTY_TRACKER', MSG.EMPTY_TRACKER);

  var headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var index = Object.create(null);
  headers.forEach(function (h, i) {
    h = String(h).trim();
    if (h && !(h in index)) index[h] = i;
  });

  var col = {};
  Object.keys(fields).forEach(function (key) {
    var header = fields[key];
    if (!(header in index)) throw appError_('MISSING_HEADER', MSG.MISSING_HEADER(header));
    col[key] = index[header];
  });
  return { lastCol: lastCol, col: col };
}

/* =============================================================================
 * 6. CACHE (chunked, because one cache value is limited to ~100 KB)
 * ========================================================================== */

function cacheGet_() {
  try {
    var cache = CacheService.getScriptCache();
    var n = parseInt(cache.get(CONFIG.CACHE.KEY + ':n'), 10);
    if (!n || n < 1) return null;

    var keys = [];
    for (var i = 0; i < n; i++) keys.push(CONFIG.CACHE.KEY + ':' + i);
    var parts = cache.getAll(keys);

    var json = '';
    for (var j = 0; j < keys.length; j++) {
      var p = parts[keys[j]];
      if (p === null || p === undefined) return null;   // a chunk expired: treat as a miss
      json += p;
    }
    return JSON.parse(json);
  } catch (err) {
    console.warn('Cache read failed: ' + err);
    return null;
  }
}

function cachePut_(snapshot) {
  try {
    var json = JSON.stringify(snapshot);
    var items = {};
    var n = 0;
    var pos = 0;
    while (pos < json.length) {
      var end = Math.min(pos + CONFIG.CACHE.CHUNK_CHARS, json.length);
      var last = json.charCodeAt(end - 1);
      if (end < json.length && last >= 0xD800 && last <= 0xDBFF) end--;   // never split an emoji pair
      items[CONFIG.CACHE.KEY + ':' + n] = json.substring(pos, end);
      n++;
      pos = end;
    }
    items[CONFIG.CACHE.KEY + ':n'] = String(n);
    CacheService.getScriptCache().putAll(items, CONFIG.CACHE.TTL_SEC);
  } catch (err) {
    console.warn('Cache write failed: ' + err);   // caching is an optimisation, never a requirement
  }
}

function cacheClear_() {
  try {
    var cache = CacheService.getScriptCache();
    var n = parseInt(cache.get(CONFIG.CACHE.KEY + ':n'), 10) || 0;
    var keys = [CONFIG.CACHE.KEY + ':n'];
    for (var i = 0; i < n; i++) keys.push(CONFIG.CACHE.KEY + ':' + i);
    cache.removeAll(keys);
  } catch (err) {
    console.warn('Cache clear failed: ' + err);
  }
}

/* =============================================================================
 * 7. RESPONSE AND ERROR HELPERS
 * ========================================================================== */

function ok_(payload) {
  payload.ok = true;
  return payload;
}

function appError_(code, message) {
  var e = new Error(message);
  e.code = code;
  e.isAppError = true;
  return e;
}

/** Wraps a public function: known errors -> Arabic message, unknown errors -> logged + generic message. */
function run_(fn) {
  try {
    return fn();
  } catch (err) {
    if (err && err.isAppError) return { ok: false, code: err.code, error: err.message };
    console.error(err && err.stack ? err.stack : String(err));
    return { ok: false, code: 'UNEXPECTED', error: MSG.UNEXPECTED };
  }
}

/* =============================================================================
 * 8. EXTENSION POINTS — NOT IMPLEMENTED IN VERSION 1
 * =============================================================================
 *
 * V2 — CV and cover-letter files
 *   - CONFIG.FILES = { SHEET: 'Files', FIELDS: { jobId: 'JobID', type: 'Type', fileId: 'FileId', date: 'Date' },
 *                      FOLDER_PROP: 'FILES_FOLDER_ID' }   // folder id kept in Script Properties
 *   - Create the NEW tab "Files" on first use (never touch Tracker). Reuse getContext_(sheet, CONFIG.FILES.FIELDS).
 *   - Public functions, same envelope as above:  getFiles(jobId), attachFile(jobId, type, ...), and
 *     setDecision-style locking (LockService) for every write.
 *   - appsscript.json: add the narrowest Drive scope that works (e.g. drive.file) and replace
 *     spreadsheets.currentonly only if a new tab cannot be created with it.
 *   - Client: Index.html has Hooks.cardActions and Hooks.detailSections ready for the "open file" buttons.
 *
 * V3 — chat with Claude
 *   - API key: PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY'). Never sent to the client.
 *   - CONFIG.CHAT = { SHEET: 'Chat', FIELDS: { ts: 'Timestamp', jobId: 'JobID', role: 'Role', text: 'Text' } }
 *   - Public functions: chatHistory(jobId), chatSend(jobId, text). The server builds the prompt, calls
 *     UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', ...) and appends both turns to the "Chat" tab.
 *   - appsscript.json: add https://www.googleapis.com/auth/script.external_request.
 *   - Treat Sheet content in prompts as untrusted data, exactly like the UI does.
 */
