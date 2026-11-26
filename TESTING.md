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
- `tests/` — the V1 + V2 suites (45 server + 32 UI tests). They must pass against `src/`.
- `reference/` — **git-ignored, not part of the repo history.** A local copy of the sanitized V2 implementation (`v2-src/`)
  and its original suites (`v2-tests/`, 43 server + 31 UI) that V2 was ported from. Not needed to run the tests.
- The V2 suites need `CONFIG.FILES.FOLDER_ID` to stay `''`: they set the folder through the Script Property mock.

## Notes
- The Drive mock in the server suite returns trashed files and shortcuts from `folder.getFiles()` on purpose (worst case);
  `Code.gs` must leave them out of the picker and refuse to link a shortcut.
- Screenshots are for visual review (mobile/desktop, light/dark); look at them after any layout change.
