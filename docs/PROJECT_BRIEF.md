# Job Vacancies Web App — Project Brief (condensed)

Hand-off of a project designed and built in a chat with Claude: V1 and V2 exist, V3 is planned. Short always-loaded
rules: `CLAUDE.md`. This file: context, reasoning, original prompt. Code/comments/commits/docs in English; app UI in
Arabic; explain things to the owner in Arabic.

## 0. Privacy — overrides everything

Tracked files (code, comments, tests, fixtures, docs, commit messages, screenshots) must hold **zero personal data**.
The owner wants even the first commit clean, because the repo may become public. Never write: Sheet / Drive folder / file /
script / deployment IDs, deployed URLs, the owner's name, e-mail, city, employer, CV or letter content, real job data, API
keys or tokens, real exports (CSV/XLSX/PDF/DOCX) or screenshots of real data.

| Value | Lives in |
|---|---|
| Drive folder ID | Script Property `FILES_FOLDER_ID` (code default `''`) |
| Anthropic API key (V3) | Script Property `ANTHROPIC_API_KEY` |
| Sheet | not needed: container-bound (`getActiveSpreadsheet`) |
| `scriptId` | `.clasp.json` (git-ignored); repo has only `.clasp.example.json` |
| Time zone | `src/appsscript.json`; the owner decides the value, don't copy it into docs/tests |

Real-looking ID about to be committed → stop and tell the owner. Leaked key → revoke it first, clean history second (§10).

## 1. The project

Google Apps Script **Web App**, container-bound to the Sheet "Job vacancies" (tab **Tracker** = one job per row). The owner
uses an Arabic, mobile-first UI instead of opening the Sheet. Deployed: **Execute as me, access only myself**. Stack:
`Code.gs` (V8), one `Index.html` (inline CSS + vanilla JS, no framework, no build), `appsscript.json`. The Sheet **mirrors a
master file kept elsewhere**, so its structure is never altered.

| Version | Scope | Status |
|---|---|---|
| V1 | counters, cards, filters/search/sort, detail view, Go/Skip/Clear (Decision only), Refresh + short cache | done, tested, deployed |
| V2 | CV / Cover Letter files from a Drive folder, linked via new tab `Files` | done, tested; reference implementation exists (§9) |
| V3 | chat with Claude in the UI (Anthropic API via `UrlFetchApp`), history in new tab `Chat` | planned only |

## 2. Non-negotiable rules

1. **Never use row numbers** (the owner sorts/filters the Sheet). Find rows by **ID**.
2. **Map columns by header name** from row 1, never by position.
3. **Decision** is `""`, `"Go"` or `"Skip"`; the server whitelists exactly these.
4. Go / Skip / Clear write **only the Decision cell**. Flow: lock → read ID column → find row → **re-check the ID** → write
   one cell → return the job re-read from the Sheet. `LockService` always.
5. **Status is maintained elsewhere: never written.** Same for every other Tracker column.
6. Tab **Guide** (documentation): never read, never write.
7. Never rename headers, reorder columns, change IDs or add columns in Tracker. New data → **new tabs** (`Files`, `Chat`),
   appended after existing tabs.
8. Sheet content is **untrusted** (external job ads; also Drive file names and, in V3, LLM output). No `innerHTML`,
   `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`: `textContent`/DOM nodes only. Open only
   `https://` links with `rel="noopener noreferrer"`.
9. API keys only in Script Properties; never in client code or in any response to the client.
10. Arabic RTL, responsive (mobile-first), light/dark following the device; technical terms and Sheet values stay English.
11. Ambiguity → **choose the simplest option, don't ask** (owner's standing instruction).
12. Server reads with `getDisplayValues()` (no `Date` objects reach the client); Match % parsed to a number.

## 3. Data model

**Tracker** (row 1 = header; A..Q in this order, but code must not depend on order):
`ID | Title | Category | Company | Location | Work Mode | Salary | Source | Job URL | Apply URL | Date Found | Match % | Hard Stop | Decision | Status | Package | Notes`

| Field | Handling |
|---|---|
| ID | `J001`…, stable, never reused; regex `^[A-Za-z0-9._-]{1,40}$`; rows without ID skipped; duplicate ID blocks writes |
| Title, Category, Company, Location, Work Mode, Salary, Source | free text, untrusted |
| Job URL | link only if valid `https://`; if the cell shows a label but has a hyperlink, use the rich-text link (`getRichTextValues().getLinkUrl()`; failure never breaks loading) |
| Apply URL | link **or** text like `SAME (Apply button on the Job URL page)`; link only if it starts with `https://`, else no button |
| Date Found | real date shown `yyyy-mm-dd`; read as display text; sorts as text; empty last |
| Match % | `"85"`, `"85%"`, `"85,5"` → number, else `null` (shows `—`, sorts last, fails any min-Match filter > 0) |
| Hard Stop | empty = none; starts with `To confirm:` (case-insens.) = a **question**, not an exclusion (`hardStopKind='confirm'`, blue badge); else possible exclusion (`'stop'`, red badge) |
| Decision | `""`/`Go`/`Skip`; the only writable column |
| Status | New, Needs Input, Ready, Applied, Closed, Skipped; read-only; unknown values still get a counter, empty → "— بدون —"; `Needs Input` = yellow badge |
| Package | free text, read-only |
| Notes | mostly Arabic, multi-line; starts with score like `T50 M26 D5.` (**T**asks / **M**inimum requirements / **D**ifferentiators); shown in full, unchanged, plus score chips |

Job object to the client: one key per field (`id,title,category,company,location,workMode,salary,source,jobUrl,applyUrl,
dateFound,match,hardStop,decision,status,pkg,notes`) + `hardStopKind`.

**`Files`** (V2, created on first link): `JobID | Type | FileId | Date`; append-only; `Type` ∈ {`CV`,`Cover Letter`}; Date is a
real date formatted `yyyy-mm-dd`; several files per job; exact duplicates (job+type+file) refused; no unlink in the UI.
**`Chat`** (V3): `Timestamp | JobID | Role | Text`, created lazily via `getOrCreateTab_`.

## 4. Server (`Code.gs`)

Layout: 1 CONFIG + `MSG` (Arabic) · 2 `doGet` · 3 public API · 4 Tracker domain · 5 Files domain · 6 generic Sheet helpers ·
7 cache · 8 response/error helpers · 9 V3 extension notes. Names ending in `_` are private.

**Public API** — every function returns `{ok:true,…}` or `{ok:false, code, error}` (`error` = safe Arabic text):

| Function | Returns | Notes |
|---|---|---|
| `getJobs(force)` | `{jobs, fetchedAt, cached}` | 60 s cache; `true` bypasses it |
| `setDecision(jobId, decision)` | `{job}` | rule 4; cache cleared in `finally` on **every** attempt, even failed |
| `getFiles(force)` (V2) | `{links, folder:{url,files[]}, fetchedAt, cached}` | `links[]={jobId,type,fileId,date,name,url,inFolder}`; missing `Files` tab → `[]`, reading never creates it |
| `linkFile(jobId, type, fileRef)` (V2) | `{link}` | flow below |

`doGet` serves `Index` with a title and `addMetaTag('viewport','width=device-width, initial-scale=1')`. `run_(fn)` wraps every
public function: `appError_(code,msg)` → `{ok:false,code,error}`; anything else is logged and returned as `UNEXPECTED` with a
generic message (no internals leak). Codes: `NO_SS NO_TRACKER EMPTY_TAB MISSING_HEADER BAD_ID BAD_DECISION NOT_FOUND DUPLICATE
ID_CHANGED BUSY UNEXPECTED` + V2 `NO_FOLDER BAD_TYPE BAD_FILE_REF NO_FILE FILE_TRASHED NOT_IN_FOLDER DUP_LINK`.

**Mechanisms to preserve**
- `getContext_(sheet, fields)`: row 1 → header→index map; Arabic `MISSING_HEADER`/`EMPTY_TAB`; first duplicate header wins.
  Used for Tracker, Files, Chat.
- `findRowById_` reads only the ID column; explicit `NOT_FOUND`/`DUPLICATE`.
- Whitelist validation (`normalizeId_`, `normalizeDecision_`, `normalizeFileType_`): reject, never "fix".
- Lock: `getScriptLock().tryLock(10000)`, failure → `BUSY`; writes only under the lock.
- Cache (`CacheService`): keys `tracker:jobs:v1`, `files:v1`; TTL 60 s (direct Sheet edits show within a minute); values in
  **30,000-char chunks** (100 KB limit, Arabic = 2–3 bytes/char), never splitting a surrogate pair; expired chunk = miss;
  cache errors never break a request. A miss reads **and fills under the same lock a write uses**, otherwise a slow read could
  re-cache pre-write data; no lock → answer uncached.
- `getOrCreateTab_(name, headers)`: creates after all tabs, bold frozen header, only if missing/empty; a tab with wrong headers
  → `MISSING_HEADER`, nothing written.

**`linkFile` order (validate everything before the first write):** (1) validate job ID, type, `fileRef` — a bare ID
`^[A-Za-z0-9_-]{10,100}$` or an `https://drive|docs.google.com/…/d/<id>` or `…/open|uc?id=<id>` URL, ≤ 2000 chars · (2) lock
(`BUSY`) · (3) job exists in Tracker (read-only) · (4) folder from Script Property `FILES_FOLDER_ID` (fallback
`CONFIG.FILES.FOLDER_ID = ''`), `NO_FOLDER` on Drive error · (5) file exists, not trashed, **direct child of the folder** (no
sub-folders/shortcuts) · (6) `getOrCreateTab_('Files')`, `getContext_`, refuse duplicates, append one row sized to the last
column, set Date format, flush · (7) return link (`name`,`url` from Drive, `inFolder:true`); `finally`: clear `files:v1`, release
lock. Guarantees: Tracker never written (tests compare snapshots); Drive read-only (never create/move/rename/share); the
folder is listed **once** (≤ 300 direct children, newest first) and names/URLs come from that listing; links whose file left the
folder return `inFolder:false` with no name.

**Manifest:** `timeZone` (owner), `runtimeVersion V8`, `exceptionLogging STACKDRIVER`, `webapp {executeAs USER_DEPLOYING,
access MYSELF}`, scopes: `spreadsheets.currentonly` (V1) + `drive.readonly` (V2) + `script.external_request` (V3). After any
scope change the owner runs a function once from the editor to re-authorize, then deploys a new version. The app runs "as me",
so the owner's account needs access to the Drive folder.

## 5. Client (`Index.html`)

One file, inline CSS, one `'use strict'` IIFE.
- `state = {jobs, byId, loaded, loading, fetchedAt, cached, filters, sort, saving:Set, openId}`.
- `Api`: the only `google.script.run` caller; promise wrapper that **always resolves** `{ok,…}` (transport failure or malformed
  response → Arabic error).
- `h(tag,{cls,text,auto,attrs,on},kids)` builds DOM with `textContent` only; `auto:true` wraps text in `<bdi>`.
  `safeHttpsUrl` (https only, no whitespace, `new URL`); `linkEl` adds `target=_blank rel="noopener noreferrer"
  referrerpolicy=no-referrer`.
- **Home:** Status counters (All first; click toggles the Status filter and syncs the select; `Needs Input` highlighted) →
  filter panel (collapsed on mobile, open on desktop; badge counts active filters; reset button) → sort → count line
  (`عرض N من M وظيفة`) → cards grid (1/2/3 columns).
- **Filters** (client-side): Status, Category, Work Mode, Decision (all/none/Go/Skip), Hard Stop (all/yes/no), min Match %,
  search. **Search:** lower-case + Arabic normalization (strip diacritics/tatweel, `أإآ`→`ا`, `ى`→`ي`); split on spaces; **all
  tokens** must appear in `Title + Company + Notes`. **Sort:** Match % desc (default)/asc, Date Found desc/asc; null/empty always
  last; tie-breakers: the other key, then ID numerically.
- **Card:** title (opens detail), company, chips (Location, Work Mode, Salary), Match % + bar, badges (red Hard Stop / blue To
  confirm / Status, yellow for Needs Input), buttons "فتح الوظيفة" (primary; disabled with hint without a valid https Job URL),
  "تقديم" (only if Apply URL is https), "تفاصيل", Decision segmented Go/Skip/Clear (Clear disabled when empty).
- **Detail:** `<dialog>` (full-screen on phones, centered on desktop; Esc, ✕, backdrop-click on desktop). All 16 fields (ID…
  Package) as `dt/dd`, valid URLs as links, Hard Stop callout (red "استبعاد محتمل (Hard Stop)" / blue "سؤال بانتظار تأكيدك —
  ليس استبعاداً"), score chips, full multi-line Notes (RTL block; leading `T50 M26 D5.` isolated LTR), Decision buttons, and an
  `.ext` container for extensions. The toast moves into the open dialog so it stays above the modal.
- **Decision flow:** ignore if unchanged; if a save/refresh is running → "please wait"; mark saving (card `.busy`, buttons
  disabled); call `setDecision`; **update the UI only from the returned job**; on error show the Arabic message and change
  nothing; restore focus via `data-fk`.
- **Refresh:** `getJobs(true)`, spinning disabled button, "آخر قراءة من الملف: HH:MM (من الذاكرة المؤقتة)" line, toast on
  success; a failed refresh keeps the old list + error toast; blocked while a save is in flight.
- **States:** loading (spinner, controls hidden), load error + retry, empty Tracker, empty filter result + reset. An exception
  in a handler must never leave the page stuck on "loading".

**Extension points (V2/V3 plug in here, not into the core):**
`Hooks = {cardActions:[], detailSections:[], onLoad:[]}` — `cardActions(job,rowEl)` adds card buttons;
`detailSections(job,containerEl)` adds a dialog section; `onLoad(force)` loads extra data and may return a
`Promise<string|null>` (error message or null) — on a forced Refresh a reported error replaces the plain "refreshed" toast.
Hooks run in try/catch; `refreshDetail()` re-renders the open dialog. V3's chat panel = a `detailSections` hook (+ `onLoad`).

**V2 client module (Files):** `Files` state = `byJob` Map (jobId → links in Sheet order, last = newest), `folderFiles`,
`folderUrl`, `loaded`, `error`. `Files.load(force)` resolves `null` or an Arabic error string, never rejects, never toasts.
First-load failure → jobs still work; the Files section shows the error + Retry; a later failed refresh keeps the files on
screen. Cards show `CV` / `Cover Letter` buttons only when linked, opening the **newest** of each type. Detail "الملفات":
linked files newest first (type chip, name link, date, "outside folder" mark if `inFolder:false`) + attach form: Type select,
select of the folder's files, `dir=ltr` input for a Drive link/ID, button "ربط الملف بالوظيفة", hint (add the file to the folder
in Drive, then Refresh), link to open the folder. **A pasted value wins over the dropdown** and is sent as typed; empty input →
error toast, no call; button locked while saving (double-click = one request); form rebuilt empty after success. **Safe link:**
use the server `url` only if `https` on a `*.google.com` host, else rebuild `https://drive.google.com/open?id=<validated id>`,
else show the name unlinked. On phones the file row shows type + date first, name below.

**Bugs found and fixed — keep them fixed**
- Bidi: English text in RTL cards was left-aligned and `Match %` rendered as `% Match` → `<bdi>` isolation (`auto:true`,
  `setBidiText` for dialog title/company), `<bdi dir="ltr">Match %</bdi>` in labels, `&lrm;` in sort `<option>`s, LTR isolation of
  the Notes score lead.
- Toast text: compute the message first, then append the job ID (a ternary/`+` precedence bug showed the wrong text).
- Production gets the viewport meta from `doGet`; tests must inject it into a temp copy of the page.
- On mobile the dialog is full-screen, so backdrop-click-to-close is desktop-only.
- The "refreshed" toast must not hide a Files error → await the hooks' promises before choosing the toast.
- Touch targets ≥ 44 px; no horizontal overflow at 390 px.

## 6. Testing

Two suites, fake data only (`Company 7`, `CV - Jane Doe.pdf`, a made-up city), in `tests/`, not in the Apps Script project.
- **Server** (`node tests/server.test.js src/Code.gs`, ~43 tests): `Code.gs` runs in a Node `vm` with in-memory mocks —
  `SpreadsheetApp` (Tracker; a **Guide** tab behind a `Proxy` that counts any access; optional `Files` tab; `insertSheet`,
  `getNumSheets`; rich-text links), `CacheService` (rejects values > 100 KB), `LockService`, `PropertiesService`, `Session`,
  `Utilities`, `DriveApp` (folders, parents, trashed), `console`. Covers: header mapping (reordered/extra columns, missing
  header → Arabic error); Match %/Hard Stop parsing; rich-text link fallback; whitelists (IDs, decisions, types, file refs);
  `setDecision` writes exactly one cell, survives re-sorting, re-checks the ID, handles `DUPLICATE`/`NOT_FOUND`/`ID_CHANGED`,
  never touches other columns or Guide, clears the cache even on failure; `BUSY`; lock always released; cache (chunking over
  100 KB, emoji pairs intact, expiry, force, invalidation); no internals leaked; V2: `getFiles` never creates the tab, `linkFile`
  happy path, every refusal leaves the spreadsheet unchanged, Tracker snapshot equality, 300-file cap, Script Property
  override, Drive down ≠ V1 broken. *Gotcha:* arrays from the `vm` realm fail `deepStrictEqual` → compare via `JSON.stringify`.
- **UI** (`node tests/ui.test.js src/Index.html tests/screens`, ~31 tests): headless Chrome via Playwright with a **stubbed
  `google.script.run`** (`addInitScript` Proxy supporting `withSuccessHandler/withFailureHandler`; answers from `window.__srv`
  with switches `failNext`, `failIds`, `failFilesNext`, `failLink`, `delay`; logs every call in `window.__calls`). Covers:
  loading → cards; counters and default sort; XSS payloads never become markup; https-only links with `rel`; badges; every
  filter + combinations + Arabic search + reset; all sorts; empty states; Go/Skip/Clear call only `setDecision(id,value)` and
  update from the returned job; busy lock and failed-save toast; detail view (16 fields, Notes, chips, callouts, closing);
  Refresh forces a re-read; load error + Retry; mobile layout (no overflow, RTL, 44 px, filter toggle); no HTML-string APIs in
  the source; V2: files load once with jobs, newest-per-type buttons, Files section, linking, pasted link wins, empty input,
  refusals, double-click guard, hostile file names/URLs, Files failure ≠ jobs broken (+ Retry), Refresh re-reads files, mobile.
  Screenshots (mobile/desktop × light/dark) go to the git-ignored `tests/screens/` and are reviewed by eye.
  The scripts still point at the original sandbox's Playwright and Chrome paths — adjust them locally.
- **Done = both suites green + screenshots checked.**

## 7. Deployment and updates

Manual: Sheet → Extensions → Apps Script → paste the 3 files (enable "Show appsscript.json manifest file") → Deploy → New
deployment → Web app → Execute as **Me**, access **Only myself** → authorize. Update: Deploy → Manage deployments → pencil →
**New version** → Deploy (URL unchanged). Pre-check from Deploy → Test deployments (`/dev` URL: latest saved code, owner only).

clasp (recommended): `npm i -g @google/clasp && clasp login` (enable the Apps Script API first) · `clasp clone <SCRIPT_ID>
--rootDir src` (creates git-ignored `.clasp.json`) · `clasp push` (pushes `src/` only; **overwrites** the remote project) ·
`clasp deployments` · `clasp deploy -i <DEPLOYMENT_ID> -d "vX.Y"`. Commands change between versions: check `clasp --help`. The
repo is the source of truth: never edit in the browser editor; if it happened, `clasp pull` first.

Layout: `src/` (Code.gs, Index.html, appsscript.json) · `tests/` · `docs/PROJECT_BRIEF.md` · `CLAUDE.md` · `README.md` ·
`CHANGELOG.md` · `.clasp.example.json` · `.gitignore` (at least `.clasp.json`, `.clasprc.json`, `.env*`, `node_modules/`,
`tests/screens/`, `reference/`, `*.csv`, `*.xlsx`, `*.pdf`, `*.docx`).

## 8. Roadmap — the migration plan the owner chose

The **first pushed commit is sanitized V1**; V2 and V3 are developed on top, so no private data is ever in history.

**Step 0 — clean V1 baseline.** Take the V1 files the owner provides → remove personal data (the Sheet ID in the `Code.gs`
header comment; anything matching §0; agree on `timeZone` with the owner — it only hints at a region, changing it changes date
formatting) → create the skeleton of §7, add this brief and `CLAUDE.md` → recreate the V1 tests with fake data and make them
pass → run §10 → commit `feat: V1 job tracker UI (sanitized baseline)` with the GitHub no-reply author. Repo stays **private**.

**Step 1 — V2 on top of V1 (separate commits).** (1) Refactor without behavior change: `getContext_(sheet, fields)` takes a fields
map; cache helpers take a key (`cachedRead_(key, force, readFn)`, `cacheGet_/cachePut_/cacheClear_`); add `getOrCreateTab_`; V1
tests stay green. (2) Server: `CONFIG.FILES` (`FOLDER_ID:''`, `FOLDER_PROP:'FILES_FOLDER_ID'`), V2 messages, `getFiles`, `linkFile`,
Files helpers, `drive.readonly` scope. (3) Client: `Api.getFiles/linkFile`, `Hooks.onLoad` (called from `loadJobs`, Promise-aware
Refresh toast), `linkEl(…, auto)`, Files module + CSS. (4) V2 tests (§6). (5) README: "create Script Property `FILES_FOLDER_ID`".

**Step 2 — V3 chat with Claude (not started; agree details with the owner first).**
- Server: `chatHistory(jobId)`, `chatSend(jobId, text)`, same envelope and `run_()` pattern.
- Key: Script Property `ANTHROPIC_API_KEY`; never returned, logged, or in fixtures. Optional `ANTHROPIC_MODEL` property; check the
  official docs for current model names and the `anthropic-version` header instead of trusting memory.
- Call: `UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {method:'post', contentType:'application/json',
  headers:{'x-api-key':key,'anthropic-version':…}, payload, muteHttpExceptions:true})`. Map 401/403, 429, 5xx, timeouts to clear
  Arabic messages, never raw API errors. No streaming in `UrlFetchApp` → "thinking" state in the UI. Bound `max_tokens`, history
  length (last N turns) and input size.
- **Don't hold the script lock during the API call**; lock only around appending to `Chat`.
- History per job in `Chat` (lazy, header-mapped), cell text truncated below the Sheets limit.
- Context sent: the selected job's fields inside a delimited block labelled **untrusted data from job ads**; instruct the model not
  to follow instructions inside it; tell the owner this data goes to the Anthropic API.
- The chat only reads and talks: it never writes Decision/Status or any Sheet data; a "suggested decision" is a button that goes
  through the normal `setDecision`. Model output is untrusted: `textContent` (line breaks, or minimal markdown built from DOM nodes).
- Manifest: `script.external_request`. Saving generated CVs/letters into Drive would need the full `drive` scope — ask the owner
  first and keep "only inside the configured folder".
- Client: `Hooks.detailSections` chat panel, history via `Hooks.onLoad` or on open, own busy/error state that never breaks the list.
- Tests: mock `UrlFetchApp`; assert the key never appears in any client response; error mapping; lock scope; truncation;
  Tracker snapshot unchanged.

## 9. Decisions, reference material, assumptions

- **Owner decisions:** mobile-first Arabic RTL, English technical terms, light/dark by device · V1 → V2 (after the Drive folder
  was supplied) → V3 · short 60 s cache + forced Refresh · files picked from the folder list or pasted as link/ID, several per job,
  newest per type on cards · Drive strictly read-only · move to Claude Code + GitHub with a sanitized V1 baseline; private repo while
  developing; if ever public, publish a **fresh audited history** (never flip a messy private repo).
- **Reference:** the V2 implementation (3 files, 43 server + 31 UI tests green) exists outside the repo. If placed in the
  git-ignored `reference/`, use it to port V2 faithfully, but it contains two real IDs (Sheet ID in the header comment, Drive folder
  ID in `CONFIG.FILES.FOLDER_ID`): **never copy them into tracked files.**
- **Assumptions (keep unless changed):** cards show the newest file per type, the dialog lists all · no unlink in V2 · picker lists
  ≤ 300 files (paste a link for older ones) · known statuses are listed even at count 0 · "To confirm:" Hard Stop = question, not
  exclusion · the Notes score prefix is optional (absent → plain Notes).

## 10. Hygiene checklist (before every commit/push)

1. Keep `~/.forbidden.txt` **outside the repo**, one sensitive literal per line (Sheet/folder/script IDs, name, e-mail, city). Run
   `git grep -nIF -f ~/.forbidden.txt` (working tree) and `git rev-list --all | xargs git grep -nIF -f ~/.forbidden.txt` (history):
   both must print nothing. Put the first in `.git/hooks/pre-commit`.
2. Author: `git config user.name "<pseudonym>"`, `user.email "<id>+<user>@users.noreply.github.com"`; enable "Block command line
   pushes that expose my email".
3. Enable secret scanning + push protection.
4. Fixtures: invented values only; screenshots git-ignored.
5. Leak → revoke/rotate keys now; `git filter-repo` or a fresh repo for history. A Drive folder ID isn't a password, but it becomes
   a credential if the folder is shared with "anyone with the link". Don't publish the Web App URL / deployment ID either.

## 11. Working with the owner

Small commits (`feat:`/`fix:`/`test:`/`docs:`/`refactor:`), one feature per branch, tag each released version · run both suites
before any `clasp push`; check UI changes visually (mobile + desktop, light + dark) · simplest design that satisfies §2; no new
dependencies or build step without asking · never touch the owner's real Sheet/Drive/live deployment unless asked; use fake data ·
update this file in the same commit that changes described behavior.

## Appendix — the original V1 prompt (verbatim; only the Sheet ID → `<SHEET_ID>` and the time zone → `<TIME_ZONE>` were replaced)

```text
You are an expert Google Apps Script developer. Build a Web App interface for a Google Sheet that tracks job openings, so I can work with the data through a UI instead of opening the Sheet directly. Implement VERSION 1 ONLY now, but structure the code so versions 2 and 3 can be added later without a rewrite.

## Context
- The file is a Google Sheet named "Job vacancies" (ID: <SHEET_ID>). Use a container-bound script (Extensions > Apps Script) with SpreadsheetApp.getActiveSpreadsheet().
- Tab "Tracker": row 1 is a fixed header; each following row is one job (currently 27). Columns A..Q in order:
  ID | Title | Category | Company | Location | Work Mode | Salary | Source | Job URL | Apply URL | Date Found | Match % | Hard Stop | Decision | Status | Package | Notes
- ID (J001, J002...) is stable and never reused. It is the row key. Never rely on row numbers, because I may sort or filter the Sheet.
- Date Found is a real date (displayed yyyy-mm-dd); Match % is a number. Prefer getDisplayValues() on the server so no Date objects reach the client, and parse Match % to a number.
- Decision: empty, "Go" or "Skip". I set it myself. Status: New, Needs Input, Ready, Applied, Closed, Skipped. Status is maintained elsewhere, so the UI must not write it.
- A non-empty Hard Stop means a possible exclusion. If it starts with "To confirm:", it is a question needing my confirmation, not an exclusion.
- Notes is mostly Arabic and starts with a score breakdown like "T50 M26 D5." (tasks / minimum requirements / differentiators).
- Job URL is a link. Apply URL may be a link or a text such as "SAME (Apply button on the Job URL page)", so only render it as a link if it starts with https://.
- The tab "Guide" is documentation. Do not touch it.
- This Sheet mirrors a master file kept elsewhere. Never rename headers, reorder columns, change IDs, or add columns to Tracker. Any new data goes into NEW tabs.

## Version 1 (build now)
1. Home screen: counters by Status, then a job list as cards (mobile-first), sorted by Match % descending by default.
2. Filters and search: Status, Category, Work Mode, minimum Match %, Decision (empty / Go / Skip), has Hard Stop (yes/no), and free-text search over Title, Company and Notes. Sort by Match % or Date Found.
3. Job card: title, company, location, work mode, salary, Match %, a red badge for Hard Stop, a yellow badge for Status "Needs Input", and buttons to open the job and apply links.
4. Detail view: all fields and the full Notes.
5. Buttons Go / Skip / Clear write ONLY to the Decision column. Write by ID: read column A, find the row, re-check that the ID still matches, write, and return the updated job. Use LockService. Accept only "Go", "Skip" or empty on the server.
6. Refresh button. Short CacheService caching, invalidated on every write.

## Technical and security requirements
- Files: Code.gs, Index.html (HtmlService; CSS and JS may be inlined or included) and appsscript.json (timeZone <TIME_ZONE>, minimal OAuth scopes).
- Deploy as Web App: Execute as me, access only myself.
- Arabic RTL UI, responsive, readable font, light/dark following the device. Technical terms and field values stay in English.
- Sheet content is untrusted (it comes from external job ads): never inject it with innerHTML; use textContent; open only https:// links with rel="noopener noreferrer".
- Map columns by header name read from row 1, not by hard-coded column numbers.
- Small server functions (getJobs, setDecision), clear Arabic error messages, a loading state and an empty-list state.

## Later (do NOT implement now, but leave a clean place for them)
- V2: CV and cover-letter files: a Drive folder plus a new tab "Files" (JobID, Type, FileId, Date) to link files to jobs and open them from the job card.
- V3: a chat with Claude inside the UI through the Anthropic API using UrlFetchApp. The API key lives in Script Properties, never in client code. Chat history is stored in a new tab "Chat".

## Deliverables
- Complete, copy-ready files.
- Step-by-step deployment (Extensions > Apps Script > Deploy > New deployment > Web app) and how to update the deployment after edits.
- A short test checklist: set Go on one job and confirm only its Decision cell changes; apply filters; test on mobile.
- List any assumptions you made at the end. If something is ambiguous, choose the simplest option instead of asking.
```
