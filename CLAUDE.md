# CLAUDE.md — Job Vacancies Web App

Google Apps Script Web App (container-bound to a Google Sheet) that gives the owner an Arabic RTL, mobile-first UI over a
job-tracking Sheet. Files: `src/Code.gs`, `src/Index.html`, `src/appsscript.json`. No framework, no build step.
**Full context, data model, API contract, test strategy, V2/V3 plans and the original prompt: `docs/PROJECT_BRIEF.md`.
Read it before making changes.**

## Privacy (highest priority)
- Never put real IDs (Sheet, Drive folder/file, scriptId, deployment), URLs of the deployed app, the owner's name/e-mail/city,
  API keys, real job data, CVs, or real screenshots in ANY tracked file, test, fixture, doc or commit message.
- Real values live in Script Properties (`FILES_FOLDER_ID`, `ANTHROPIC_API_KEY`) or git-ignored files (`.clasp.json`).
- Before every commit: `git grep -nIF -f ~/.forbidden.txt` must print nothing (the file is outside the repo). If you see a
  real-looking ID in something you are about to commit, stop and tell the owner.
- Fixtures: invented names only (`Company 7`, `CV - Jane Doe.pdf`).

## Hard rules for the Sheet
- Never use row numbers: find rows by ID; map columns by header name from row 1.
- The only Tracker cell the app writes is **Decision** (`""`, `"Go"`, `"Skip"`, whitelisted on the server). Never write Status or any other column.
- Write flow: lock → find row by ID → re-check ID → write → return the re-read job. Clear the cache in `finally` on every write attempt.
- Never touch the tab `Guide`. Never rename headers, reorder columns, change IDs or add columns in Tracker. New data → new tabs (`Files`, `Chat`).
- Drive is read-only (`drive.readonly`); files are linked only if they sit directly in the configured folder.

## Hard rules for the UI
- Sheet/Drive/LLM content is untrusted: `textContent` only; no `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`eval`/`new Function`/`document.write`.
- Open only `https://` links with `rel="noopener noreferrer"`.
- Arabic RTL, responsive, light/dark by device, 44 px touch targets; technical terms and Sheet values stay English; isolate them in `<bdi>`.
- Extend through `Hooks` (`cardActions`, `detailSections`, `onLoad`), not by rewriting the core.

## Commands
```bash
node tests/server.test.js src/Code.gs                       # server logic (Node vm + mocks)
node tests/ui.test.js src/Index.html tests/screens          # UI (Playwright + Chrome, stubbed google.script.run)
clasp push                                                  # src/ -> Apps Script (never edit in the browser editor)
clasp deploy -i <DEPLOYMENT_ID> -d "vX.Y"                   # update the existing deployment; URL unchanged
```
Both suites must pass, and UI changes must be checked visually (mobile + desktop, light + dark), before any `clasp push`.

## Working style
- English in code/comments/commits; Arabic for the UI strings and for explanations to the owner.
- Simplest option wins when something is ambiguous; no new dependencies or build tooling without asking.
- Small commits (`feat:`/`fix:`/`test:`/`docs:`/`refactor:`), one feature per branch. Update `docs/PROJECT_BRIEF.md` when behavior changes.
- Status: V1 and V2 done (V1 is the sanitized baseline commit; V2 is re-applied on top of it), V3 (chat with Claude) planned.
- Don't touch the owner's real Sheet/Drive/deployment unless asked; develop against fake data.
