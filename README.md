# Job Vacancies Web App

A Google Apps Script web app, container-bound to a Google Sheet, that gives an Arabic, RTL, mobile-first UI over a
job-tracking Sheet: Status counters, filters and search, job cards, a detail view, Go / Skip decisions and (V2) CV /
Cover Letter files from a Drive folder. No framework, no build step.

| Path | What |
|---|---|
| `src/` | the Apps Script project: `Code.gs`, `Index.html`, `appsscript.json` |
| `tests/` | server and UI test suites, see [TESTING.md](TESTING.md) |
| `docs/PROJECT_BRIEF.md` | full context: data model, API contract, rules, roadmap |
| `CHANGELOG.md` | what changed in each version |

## What the app is allowed to change
- **Tracker tab:** only the `Decision` cell of one job (`Go`, `Skip` or empty), found by ID. Nothing else, ever.
- **Files tab (V2):** created on the first link; the app only appends rows (`JobID | Type | FileId | Date`).
- **Drive:** read-only (`drive.readonly`). Files are never created, moved, renamed or shared.

## Setup and deployment
1. **Code.** With [clasp](https://github.com/google/clasp) (enable the Apps Script API in your Google account first):
   ```bash
   npm i -g @google/clasp
   clasp login
   cp .clasp.example.json .clasp.json   # put your script ID in it; .clasp.json is git-ignored
   clasp push                           # pushes src/ and overwrites the online project
   ```
   The repository is the source of truth: do not edit in the browser editor.
2. **Files folder (V2).** In the Apps Script editor: Project Settings → Script Properties → add
   `FILES_FOLDER_ID` = the ID of your Drive folder (the part after `/folders/` in its URL).
   Keep `CONFIG.FILES.FOLDER_ID` in `Code.gs` empty. The app runs as you, so your account needs access to the folder.
3. **Authorize the new scope.** V2 adds `drive.readonly`. After pushing, run any function once from the editor
   (for example `getFiles`) and accept the permission prompt.
4. **Deploy.** First time: Deploy → New deployment → Web app → Execute as **Me**, access **Only myself**.
   Updates: Deploy → Manage deployments → edit → **New version** (the URL stays the same), or
   `clasp deploy -i <DEPLOYMENT_ID> -d "vX.Y"`.

**Linking a file:** put the CV / cover letter directly in the folder (not in a sub-folder, not as a shortcut), press
Refresh in the app, open the job → «الملفات» → pick the type and the file (or paste its Drive link) → «ربط الملف بالوظيفة».

## Tests
```bash
npm install
npm test
```
Details in [TESTING.md](TESTING.md). Both suites must pass, and UI changes must be checked on the screenshots
(mobile + desktop, light + dark), before every `clasp push`.

## Privacy
No real IDs (Sheet, Drive folder or file, script, deployment), deployed URLs, personal data, API keys or real job data
in any tracked file or commit. Real values live in Script Properties or in git-ignored files. See `CLAUDE.md`.
