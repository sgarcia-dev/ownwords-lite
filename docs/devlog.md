# Devlog

Newest first. Short, dated, what changed and why.

## 2026-10-26 Section versions

- Several non-overlapping version groups can be open at once, with a sticky side panel for their controls. Overlapping groups show as hidden, with the group that hides them, not as stale (D8, D9).

## 2026-10-24 Feedback notes

- Fixed: a note was lost when you pressed 👍 several times, changed 👍 to 👎, or cleared a thumb. A vote now edits the mark in place and keeps its note.
- Fixed: clicking a mark did not show its note. It now opens the note box with the saved note.
- Added neutral notes (score 0, a note with no thumb) and a 💬 Note button in the selection bar and the badge row. Neutral marks have a violet dotted underline.
- The note box is a 3-line textarea that saves as you type and shows "Saved". Esc, clicking away and moving on all save.
- ui.json saves go one at a time, latest wins. Typing no longer redraws the page.
- Notes now go up to 2000 characters. The old 280 cap silently stopped typing in a real note.
- Fixed CONTRACT.md: closing a group keeps its marks and notes in ui.json.
- Updated `OWNWORDS.md` so agents read notes on every mark, score 0 included. Decision D7.
- Lesson: note and vote must be independent fields on one mark.

## 2026-10-24 Launch and share

- Added `AGENTS.md`: rules for agents changing the code, including that every change updates these docs. `CLAUDE.md` points to it.
- Added an `Open Ownwords` launcher for macOS, built on the user's machine, that starts the server and opens an app window.
- The server writes `OWNWORDS.md` into the folder on start; the `polish` skill became a pointer to it. Added a "Copy prompt" button for agents without skills.
- The server stops after 10 minutes unused. The page shows "Ownwords stopped" and keeps unsaved changes. Added `/api/info`, `/api/stop`, a Host allowlist and JSON-only POSTs.
- Manifest and icons, so Chrome can install the page as an app window. No service worker.
- Decided against Electron for now (D5). Node floor set to 22. Docs moved into the repo: README, INSTALL for agents, and `docs/`.
- Removed the one-off migration script for the first data format and a stale build brief.

## 2026-10-24 Files and timeline

- Default folder moved to `~/Desktop/Ownwords`. Any `.md` file there is a piece; files can be dropped in and resumed by name (D4).
- "Use this version", "Drop the other versions" and "Restore" on timeline rows; closed groups go to `closed.json`; agents accept through the same route as the page (D3, D4).
- Marks became green and red underlines and never overlap.
- Lesson: three apparent bugs were screenshot timing, and a hash-only navigation kept old page code. Read the page state and reload before judging.

## 2026-10-23 Markdown and feedback

- Pieces became plain Markdown with a hidden sidecar folder; versions anchor to exact paragraph text (D2).
- Per-group compare replaced the global "Changes" view. Added 👍 and 👎 marks with two strengths and notes. Title versions rename the file on accept.
- Lesson: do not edit the page files while a live server serves them to an open tab.

## 2026-10-23 Restart from a simpler design

- An earlier, larger app was dropped. Started Ownwords Lite: a static page, a zero-dependency Node server, files, and a `polish` skill in the repo (D1).
- First version: select a sentence and widen it, versions in place, word diffs, timeline of snapshots, 1-second polling with an etag.
- Considered WebMCP and decided not now (D6).
- Lesson: the skill needed a narrow trigger so it does not fire on any request to "polish".
