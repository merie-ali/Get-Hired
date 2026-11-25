/**
 * Job vacancies — Web App  |  VERSION 2  (V1 job UI + V2 CV / cover-letter files)
 * -----------------------------------------------------------------------------
 * Container-bound script for the Google Sheet "Job vacancies".
 *
 * Rules this file enforces:
 *   - Tracker columns are located by the header text in row 1, never by position.
 *   - Rows are located by ID, never by row number (the Sheet may be sorted or filtered).
 *   - In Tracker the ONLY thing ever written is one Decision cell: "Go", "Skip" or empty.
 *     Status and every other Tracker column are read-only. The "Guide" tab is never touched.
 *   - Tracker headers, column order and IDs are never changed; no columns are added.
 *   - V2 data lives in a NEW tab "Files" (JobID | Type | FileId | Date). The app only appends rows to it.
 *   - Drive is read-only (scope drive.readonly): files are never created, moved, renamed or shared.
 *     A file can be linked only if it sits directly inside the configured Drive folder
 *     (not in a sub-folder, not trashed, not a shortcut).
 *
 * Layout of this file:
 *   1. CONFIG and Arabic messages
 *   2. Web app entry point (doGet)
 *   3. Public API called from the browser (getJobs, setDecision, getFiles, linkFile)
 *   4. Tracker domain logic (read rows, find by ID, build job objects)
 *   5. Files domain logic (V2: Drive folder, "Files" tab, link validation)
 *   6. Generic Sheet helpers (also reusable for the Chat tab in V3)
 *   7. Cache helpers
 *   8. Response and error helpers
 *   9. Extension points for V3 (comments only, nothing implemented)
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

  // V2: CV and cover-letter files.
  FILES: {
    SHEET: 'Files',                       // NEW tab, created on the first link. Never part of Tracker.
    // client key -> header text. Order here = column order when the tab is created.
    FIELDS: { jobId: 'JobID', type: 'Type', fileId: 'FileId', date: 'Date' },
    TYPES: ['CV', 'Cover Letter'],        // accepted by linkFile
    // Drive folder that holds the files. Set the Script Property FILES_FOLDER_ID to your folder's ID
    // (Project Settings > Script Properties). Keep this default EMPTY in the repository.
    FOLDER_ID: '',
    FOLDER_PROP: 'FILES_FOLDER_ID',
    MAX_FOLDER_FILES: 300,                // direct children listed in the picker (newest first)
    SHORTCUT_MIME: 'application/vnd.google-apps.shortcut',   // a shortcut may point outside the folder
    CACHE_KEY: 'files:v1'
  },

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
  EMPTY_TAB: function (tab) { return 'تبويب «' + tab + '» فارغ ولا يحتوي على صف العناوين.'; },
  MISSING_HEADER: function (h, tab) { return 'العمود «' + h + '» غير موجود في الصف الأول من تبويب «' + tab + '».'; },
  BAD_ID: 'معرّف الوظيفة (ID) غير صالح.',
  BAD_DECISION: 'قيمة Decision غير صالحة. المسموح فقط: Go أو Skip أو فارغ.',
  NOT_FOUND: function (id) { return 'لم يتم العثور على الوظيفة «' + id + '». ربما حُذفت أو تغيّر معرّفها. اضغط تحديث ثم حاول مرة أخرى.'; },
  DUPLICATE: function (id) { return 'المعرّف «' + id + '» مكرر في تبويب Tracker. تم إيقاف الكتابة حفاظاً على بياناتك؛ صحّح التكرار في الملف أولاً.'; },
  ID_CHANGED: 'تغيّر ترتيب الصفوف أثناء العملية، لذلك لم يتم تعديل أي شيء. اضغط تحديث ثم حاول مرة أخرى.',
  BUSY: 'الملف مشغول بعملية أخرى. انتظر لحظات ثم حاول مرة أخرى.',
  UNEXPECTED: 'حدث خطأ غير متوقع. حاول مرة أخرى، وإن تكرر الخطأ فراجع سجل التنفيذ (Executions) في Apps Script.',

  // V2 (Files)
  NO_FOLDER: 'تعذّر فتح مجلد الملفات في Drive. تأكد من معرّف المجلد ومن أن حسابك يملك صلاحية الوصول إليه.',
  BAD_TYPE: 'نوع الملف غير صالح. المسموح فقط: CV أو Cover Letter.',
  BAD_FILE_REF: 'لم أتعرّف على الملف. اختر ملفاً من القائمة، أو الصق رابط Drive كاملاً أو معرّف الملف.',
  NO_FILE: 'تعذّر الوصول إلى هذا الملف في Drive. ربما حُذف أو لا تملك صلاحية عليه.',
  FILE_TRASHED: 'هذا الملف موجود في سلة المحذوفات.',
  SHORTCUT: 'هذا اختصار (shortcut) وليس الملف نفسه. انقل الملف الأصلي إلى المجلد ثم اضغط تحديث وحاول مرة أخرى.',
  NOT_IN_FOLDER: 'هذا الملف ليس داخل مجلد الملفات المخصص. انقله إلى المجلد ثم اضغط تحديث وحاول مرة أخرى.',
  DUP_LINK: 'هذا الملف مربوط بهذه الوظيفة بالفعل بنفس النوع.'
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
    var r = cachedRead_(CONFIG.CACHE.KEY, forceRefresh === true, function () {
      return { jobs: readAllJobs_() };
    });
    return ok_({ jobs: r.data.jobs, fetchedAt: r.data.fetchedAt, cached: r.cached });
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
      cacheClear_(CONFIG.CACHE.KEY);   // invalidate on every write attempt, even a failed one
      lock.releaseLock();
    }
  });
}

/**
 * V2. Returns the file links stored in the "Files" tab, and the files currently inside the Drive folder
 * (used for names, links and the picker). If the "Files" tab does not exist yet, links is [].
 * @param {boolean} forceRefresh true = skip the cache (Refresh button)
 * @return {{ok:boolean, links?:Object[], folder?:{url:string, files:Object[]}, fetchedAt?:number, cached?:boolean, error?:string}}
 */
function getFiles(forceRefresh) {
  return run_(function () {
    var r = cachedRead_(CONFIG.FILES.CACHE_KEY, forceRefresh === true, readFilesSnapshot_);
    return ok_({ links: r.data.links, folder: r.data.folder, fetchedAt: r.data.fetchedAt, cached: r.cached });
  });
}

/**
 * V2. Links a Drive file to a job by appending ONE row to the "Files" tab.
 * Nothing in Tracker or Drive is modified.
 * @param {string} jobId   e.g. "J007" (must exist in Tracker)
 * @param {string} type    "CV" or "Cover Letter"
 * @param {string} fileRef a Drive file ID, or a Drive / Docs link containing it
 * @return {{ok:boolean, link?:Object, error?:string}}
 */
function linkFile(jobId, type, fileRef) {
  return run_(function () {
    var id = normalizeId_(jobId);
    var fileType = normalizeFileType_(type);
    var fileId = extractDriveId_(fileRef);

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) throw appError_('BUSY', MSG.BUSY);

    try {
      // 1. The job must exist in Tracker (read-only look-up by ID).
      var tracker = getTrackerSheet_();
      findRowById_(tracker, getContext_(tracker, CONFIG.TRACKER.FIELDS), id);

      // 2. The file must exist, not be trashed or a shortcut, and sit directly inside the configured folder.
      var folder = getFilesFolder_();
      var file = openLinkableFile_(fileId, folder);

      // 3. Only now touch the sheet: create the "Files" tab on first use, refuse exact duplicates, append.
      var sheet = getOrCreateTab_(CONFIG.FILES.SHEET, filesHeaders_());
      var ctx = getContext_(sheet, CONFIG.FILES.FIELDS);
      if (isAlreadyLinked_(sheet, ctx, id, fileType, fileId)) throw appError_('DUP_LINK', MSG.DUP_LINK);

      var now = new Date();
      var row = [];
      for (var i = 0; i < ctx.lastCol; i++) row.push('');
      row[ctx.col.jobId] = id;
      row[ctx.col.type] = fileType;
      row[ctx.col.fileId] = fileId;
      row[ctx.col.date] = now;

      var r = sheet.getLastRow() + 1;
      sheet.getRange(r, 1, 1, ctx.lastCol).setValues([row]);
      sheet.getRange(r, ctx.col.date + 1).setNumberFormat('yyyy-mm-dd');
      SpreadsheetApp.flush();

      return ok_({
        link: {
          jobId: id, type: fileType, fileId: fileId,
          date: Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
          name: file.getName(), url: file.getUrl(), inFolder: true
        }
      });
    } finally {
      cacheClear_(CONFIG.FILES.CACHE_KEY);   // invalidate on every attempt, even a failed one
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
 * 5. FILES DOMAIN LOGIC (V2)
 * ========================================================================== */

function filesHeaders_() {
  return Object.keys(CONFIG.FILES.FIELDS).map(function (k) { return CONFIG.FILES.FIELDS[k]; });
}

/** Everything the UI needs in one read: the link rows from "Files" plus the files inside the Drive folder. */
function readFilesSnapshot_() {
  var folder = getFilesFolder_();
  var folderFiles = listFolderFiles_(folder);
  var byId = Object.create(null);
  folderFiles.forEach(function (f) { byId[f.id] = f; });

  var links = readFileLinks_().map(function (l) {
    var f = byId[l.fileId];
    l.name = f ? f.name : '';          // names come from the single folder listing, not one Drive call per link
    l.url = f ? f.url : '';
    l.inFolder = !!f;
    return l;
  });
  return { links: links, folder: { url: folder.getUrl(), files: folderFiles } };
}

function getFilesFolder_() {
  var id = PropertiesService.getScriptProperties().getProperty(CONFIG.FILES.FOLDER_PROP) || CONFIG.FILES.FOLDER_ID;
  try {
    return DriveApp.getFolderById(String(id).trim());
  } catch (err) {
    console.error('Files folder unavailable: ' + err);
    throw appError_('NO_FOLDER', MSG.NO_FOLDER);
  }
}

/**
 * Direct children of the folder that can be linked (not trashed, not shortcuts), newest first, capped.
 * The first MAX_FOLDER_FILES files Drive returns are kept, then sorted; older files can still be pasted as a link.
 */
function listFolderFiles_(folder) {
  var out = [];
  var it = folder.getFiles();
  while (it.hasNext() && out.length < CONFIG.FILES.MAX_FOLDER_FILES) {
    var f = it.next();
    if (f.isTrashed()) continue;
    var mime = f.getMimeType();
    if (mime === CONFIG.FILES.SHORTCUT_MIME) continue;
    out.push({
      id: f.getId(),
      name: f.getName(),
      url: f.getUrl(),
      mime: mime,
      updated: f.getLastUpdated().getTime()
    });
  }
  out.sort(function (a, b) { return b.updated - a.updated; });
  return out;
}

/** Rows of the "Files" tab. A missing tab means no links yet; reading never creates it. */
function readFileLinks_() {
  var sheet = getSpreadsheet_().getSheetByName(CONFIG.FILES.SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var ctx = getContext_(sheet, CONFIG.FILES.FIELDS);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, ctx.lastCol).getDisplayValues();
  var links = [];
  values.forEach(function (row) {
    var l = {};
    Object.keys(CONFIG.FILES.FIELDS).forEach(function (k) {
      var v = row[ctx.col[k]];
      l[k] = (v === null || v === undefined) ? '' : String(v).trim();
    });
    if (l.jobId && l.fileId) links.push(l);
  });
  return links;
}

function isAlreadyLinked_(sheet, ctx, jobId, type, fileId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  var values = sheet.getRange(2, 1, lastRow - 1, ctx.lastCol).getDisplayValues();
  return values.some(function (row) {
    return String(row[ctx.col.jobId]).trim() === jobId &&
           String(row[ctx.col.type]).trim() === type &&
           String(row[ctx.col.fileId]).trim() === fileId;
  });
}

/** Whitelist: "CV" or "Cover Letter". Everything else is rejected, not "fixed". */
function normalizeFileType_(type) {
  if (typeof type === 'string' && CONFIG.FILES.TYPES.indexOf(type) !== -1) return type;
  throw appError_('BAD_TYPE', MSG.BAD_TYPE);
}

/** Accepts a bare Drive ID or a Drive / Docs link that contains one. Anything else is rejected. */
function extractDriveId_(ref) {
  var s = (typeof ref === 'string') ? ref.trim() : '';
  if (s && s.length <= 2000) {
    if (/^[A-Za-z0-9_-]{10,100}$/.test(s)) return s;
    var m = /^https:\/\/(?:drive|docs)\.google\.com\/(?:[^?#]*\/)?d\/([A-Za-z0-9_-]{10,100})(?:[\/?#]|$)/.exec(s) ||
            /^https:\/\/drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([A-Za-z0-9_-]{10,100})(?:[&#]|$)/.exec(s);
    if (m) return m[1];
  }
  throw appError_('BAD_FILE_REF', MSG.BAD_FILE_REF);
}

/** The file must exist, not be trashed, not be a shortcut, and have the configured folder as a direct parent. */
function openLinkableFile_(fileId, folder) {
  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (err) {
    throw appError_('NO_FILE', MSG.NO_FILE);
  }
  if (file.isTrashed()) throw appError_('FILE_TRASHED', MSG.FILE_TRASHED);
  if (file.getMimeType() === CONFIG.FILES.SHORTCUT_MIME) throw appError_('SHORTCUT', MSG.SHORTCUT);

  var folderId = folder.getId();
  var parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === folderId) return file;
  }
  throw appError_('NOT_IN_FOLDER', MSG.NOT_IN_FOLDER);
}

/* =============================================================================
 * 6. GENERIC SHEET HELPERS (also reusable for the "Chat" tab in V3)
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
  if (sheet.getLastRow() < 1 || lastCol < 1) throw appError_('EMPTY_TAB', MSG.EMPTY_TAB(sheet.getName()));

  var headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var index = Object.create(null);
  headers.forEach(function (h, i) {
    h = String(h).trim();
    if (h && !(h in index)) index[h] = i;
  });

  var col = {};
  Object.keys(fields).forEach(function (key) {
    var header = fields[key];
    if (!(header in index)) throw appError_('MISSING_HEADER', MSG.MISSING_HEADER(header, sheet.getName()));
    col[key] = index[header];
  });
  return { lastCol: lastCol, col: col };
}

/**
 * Returns the tab with this name, creating it (after all existing tabs, so Tracker stays first)
 * with a bold, frozen header row if it does not exist or is completely empty.
 */
function getOrCreateTab_(name, headers) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name, ss.getNumSheets());
  if (sheet.getLastRow() === 0 && sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/* =============================================================================
 * 7. CACHE (chunked, because one cache value is limited to ~100 KB)
 * ========================================================================== */

/**
 * Cached read used by the public read functions. `readFn` returns a plain object; fetchedAt is added to it.
 * Returns { data, cached }.
 */
function cachedRead_(key, force, readFn) {
  if (!force) {
    var hit = cacheGet_(key);
    if (hit) return { data: hit, cached: true };
  }

  // Read and fill the cache under the same lock a write uses. Otherwise a slow read could
  // put pre-write data into the cache just after a write invalidated it.
  var lock = LockService.getScriptLock();
  var locked = lock.tryLock(CONFIG.LOCK_WAIT_MS);
  try {
    if (locked && !force) {
      var again = cacheGet_(key);
      if (again) return { data: again, cached: true };
    }
    var data = readFn();
    data.fetchedAt = Date.now();
    if (locked) cachePut_(key, data);   // if the lock was not obtained, still answer but do not cache
    return { data: data, cached: false };
  } finally {
    if (locked) lock.releaseLock();
  }
}

function cacheGet_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var n = parseInt(cache.get(key + ':n'), 10);
    if (!n || n < 1) return null;

    var keys = [];
    for (var i = 0; i < n; i++) keys.push(key + ':' + i);
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

function cachePut_(key, snapshot) {
  try {
    var json = JSON.stringify(snapshot);
    var items = {};
    var n = 0;
    var pos = 0;
    while (pos < json.length) {
      var end = Math.min(pos + CONFIG.CACHE.CHUNK_CHARS, json.length);
      var last = json.charCodeAt(end - 1);
      if (end < json.length && last >= 0xD800 && last <= 0xDBFF) end--;   // never split an emoji pair
      items[key + ':' + n] = json.substring(pos, end);
      n++;
      pos = end;
    }
    items[key + ':n'] = String(n);
    CacheService.getScriptCache().putAll(items, CONFIG.CACHE.TTL_SEC);
  } catch (err) {
    console.warn('Cache write failed: ' + err);   // caching is an optimisation, never a requirement
  }
}

function cacheClear_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var n = parseInt(cache.get(key + ':n'), 10) || 0;
    var keys = [key + ':n'];
    for (var i = 0; i < n; i++) keys.push(key + ':' + i);
    cache.removeAll(keys);
  } catch (err) {
    console.warn('Cache clear failed: ' + err);
  }
}

/* =============================================================================
 * 8. RESPONSE AND ERROR HELPERS
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
 * 9. EXTENSION POINTS — NOT IMPLEMENTED YET
 * =============================================================================
 *
 * V3 — chat with Claude
 *   - API key: PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY'). Never sent to the client.
 *   - CONFIG.CHAT = { SHEET: 'Chat', FIELDS: { ts: 'Timestamp', jobId: 'JobID', role: 'Role', text: 'Text' } }
 *     The tab is created on first use with getOrCreateTab_(); read it with getContext_() like "Files".
 *   - Public functions, same { ok, error } envelope and the same run_() / LockService pattern:
 *     chatHistory(jobId), chatSend(jobId, text). The server builds the prompt, calls
 *     UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', ...) and appends both turns to the "Chat" tab.
 *     Do not hold the script lock during the API call; lock only around appending to "Chat".
 *   - appsscript.json: add https://www.googleapis.com/auth/script.external_request.
 *   - Treat Sheet content in prompts as untrusted data, exactly like the UI does.
 *   - If V3 should save generated CVs / letters into the Drive folder, that needs the full "drive" scope
 *     instead of drive.readonly; keep the "only inside this folder" rule from openLinkableFile_().
 *   - Client: Index.html has Hooks.detailSections (a chat panel) and Hooks.onLoad (load history).
 */
