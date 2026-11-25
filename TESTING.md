# Testing

Two suites, both using fake data only.

| File | What it tests | Needs |
|---|---|---|
| `tests/server.test.js` | `src/Code.gs` logic, run inside Node's `vm` against mocked Apps Script services (Sheet, Cache, Lock, Properties, Drive) | Node |
| `tests/ui.test.js` | `src/Index.html` in a real browser with a stubbed `google.script.run` | Node + Google Chrome |

## Setup (once)
1. Install Node.js LTS from https://nodejs.org (it includes npm). Check: `node -v` and `npm -v`.
2. Google Chrome must be installed (the UI tests drive it through `playwright-core`; no browser download).
3. In the repository root: `npm install` (creates `node_modules/` — git-ignored — and `package-lock.json` — commit it).

## Run
```bash
npm test                # both suites
npm run test:server     # Code.gs only
npm run test:ui         # Index.html only; screenshots go to tests/screens/ (git-ignored)
```
Environment variables for the UI suite: `CHROME_PATH=/path/to/chrome` if Chrome is not found automatically;
`NO_SANDBOX=1` only inside containers/CI.

## Folders
- `tests/` — the V1 suites. They must pass against the V1 code.
- `reference/` — **git-ignored, not part of the repo history.** `v2-src/` is a sanitized V2 implementation (Code.gs, Index.html,
  appsscript.json) and `v2-tests/` the matching suites (43 server + 31 UI tests). Use them to port V2 faithfully. When V2 is
  ported, replace `tests/*.test.js` with `reference/v2-tests/*.test.js` (they already contain the V1 tests).
- The V2 suites need `CONFIG.FILES.FOLDER_ID` to stay `''`: they set the folder through the Script Property mock.

## Notes
- The V1 server suite contains a test asserting that only `doGet`, `getJobs` and `setDecision` are public functions;
  on V2 code that test is expected to fail (V2 adds `getFiles` and `linkFile`) — use the V2 suite there.
- Screenshots are for visual review (mobile/desktop, light/dark); look at them after any layout change.
