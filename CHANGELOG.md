# Changelog

## [Unreleased] — V2: CV / Cover Letter files

### Added
- Link CV and cover-letter files from one Drive folder to jobs. Links are stored in a new tab `Files`
  (`JobID | Type | FileId | Date`), created on the first link; several files per job, exact duplicates refused.
- Job cards: `CV` / `Cover Letter` buttons open the newest linked file of each type.
- Detail view: «الملفات» section listing the linked files (newest first, «خارج المجلد» for files that left the folder)
  and a form to link a file from the folder list or by pasting a Drive link / file ID.
- Server API: `getFiles(force)` and `linkFile(jobId, type, fileRef)`; Script Property `FILES_FOLDER_ID`;
  OAuth scope `drive.readonly`.

### Changed
- A forced Refresh also re-reads the files; if that fails, its error replaces the «تم تحديث القائمة» toast.
- Error code `EMPTY_TRACKER` is now `EMPTY_TAB`; empty-tab and missing-header messages name the tab.

### Security
- Drive shortcuts cannot be linked (new code `SHORTCUT`) and, like trashed files, are not offered in the folder list.
- File links and the «فتح المجلد في Drive» link are rendered only for `https` URLs on `google.com`.

### Upgrade notes
- Create the Script Property `FILES_FOLDER_ID`, then run a function once from the editor to grant `drive.readonly`
  before deploying the new version.

## V1 — job tracker UI (sanitized baseline)
- Status counters, filters / search / sort, job cards, detail view.
- Go / Skip / Clear write only the `Decision` cell, found by ID under a lock.
- Refresh button and a 60-second cache.
- Server and UI regression suites.
