# Ownwords Lite contract

Zero npm dependencies. Node 22 or newer. Plain browser scripts, no build, no CDN.
Design and reasons: docs/architecture.md and docs/decisions.md.

## Files

`<dir>` is `node server.js [dir]`, else `OWNWORDS_DIR`, else the first non-empty line of `~/.ownwords-lite` (trimmed, a leading `~` expanded, ignored if the file is missing), else `~/Desktop/Ownwords`. The second non-empty line of `~/.ownwords-lite` is the app folder (the folder that holds `server.js`). The server writes it on start, only when line 1 exists and line 2 is missing or different; line 1 is never changed.

| Path | Writer |
|---|---|
| `<dir>/<id>.md` | the user and the agent. The first `# ` line is the title. |
| `<dir>/.ownwords/<id>/versions.json` | the agent |
| `<dir>/.ownwords/<id>/closed.json` | the server |
| `<dir>/.ownwords/<id>/ui.json` | the page, through the server |
| `<dir>/.ownwords/<id>/history/<YYYYMMDD-HHMMSS-mmm>.md` | the server |
| `<dir>/OWNWORDS.md` | the server, on start, from `templates/OWNWORDS.md` |

- Any Markdown file dropped in `<dir>` is a piece: `*.md`, the name does not start with `.` and has no `/` or control characters. Spaces, capitals and Unicode are fine. The id is the file name without `.md`. Other names in `<dir>` are ignored. A file with no `# ` line works: the title is the id.
- The API and docs still say `slug` for the id. A title accept renames the piece to `slugify(title)` (`[a-z0-9-]+`), so renamed pieces get a plain slug. The page and agents must encodeURIComponent the id in URLs.
- One writer per file. Two exceptions: accept (see HTTP) writes the .md, renames it and its folder, and edits versions.json. Restore writes the .md and adds a log entry to versions.json.
- Code: `lib/md.js` (pure parsing, matching, slugs), `server.js`, `templates/OWNWORDS.md`, `public/`, `launcher/`.

## versions.json

```json
{ "groups": [ { "id": "g1", "original": "<exact paragraphs, blank line between>",
                "options": [ { "text": "", "note": "" } ] } ],
  "log": [ { "at": "<ISO time>", "note": "" } ] }
```

## closed.json

A JSON array, written by the server only (accept). It keeps versions.json small for agents to read.

```json
[ { "id": "g1", "original": "", "options": [ { "text": "", "note": "" } ],
    "result": "used|dropped", "pick": 2, "at": "<ISO time>" } ]
```

- `original` must match the .md paragraphs it replaces (see Paragraph rules).
- Option `text` is the replacement for the whole group, same number of paragraphs or not.
- Ids are never reused. The agent only appends: new groups, new options, new log entries.
- Title group: `original` is the `# ` line, options are plain titles.
- A group whose `original` no longer matches is stale. It is listed in `doc.stale`, not shown in the text.
- closed.json: each accepted group is appended with `result` `used` (`pick` n is `options[n-1]`) or `dropped` (`pick` 0). The page never reads it. The agent leaves it alone. The file lives in the sidecar folder, so a title rename moves it. An old versions.json that still has a `closed` array: accept moves that array into closed.json (before the new entry) and removes it from versions.json. Every server write keeps other unknown keys in versions.json.
- Bad entries are dropped (`cleanVersions`). A file that does not parse keeps the last good one.

## ui.json

Written by the page. The server stores the POST body as is (a JSON object, max 1 MB), so unknown keys survive.

```json
{ "selection": null,
  "picks": { "g1": 2 },
  "compare": { "g1": { "on": true, "base": 0 } },
  "feedback": [ { "id": "", "block": "g1", "version": 2, "quote": "text or null",
                  "before": "up to 24 chars", "start": 0, "score": 1,
                  "note": "", "set": "", "at": "<ISO time>" } ] }
```

- `selection`: null or the page's current text selection. `selection.scope` may be `"mark"`: the selection is exactly one feedback mark, and `selection.mark` is that mark's id.
- `picks`: group id to version. 1-based: `n` shows `options[n-1]`. 0 shows the .md text.
- `compare`: per group. `on` shows a diff against version `base` (0 is the .md text, n is `options[n-1]`).
- `feedback`: marks. A mark is a range, a `score` and a `note`. `score` is -2, -1, 0, 1 or 2 (dislike or like, strong or not). `0` is a neutral note: a comment with no thumb. It exists only with a non-empty `note`; the page drops a score-0 mark whose note is empty. `note` is on every mark, thumbs or neutral, up to 2000 characters, and is independent of the score. Old files need no change. `version` is the pick the mark was made on. `quote` null marks the whole version. `block` is a group id or `p<index>`. `before` and `start` help find the quote again. `set` groups marks from one vote.
- Missing or unparsable file: the server serves `{ "selection": null, "picks": {} }`.

## HTTP

Server: `127.0.0.1:4646`, env `PORT`. Static files from `public/` (index.html, app.js, style.css, manifest.webmanifest, icons/; `OWNWORDS_LITE_PUBLIC` overrides).

Every request needs a `Host` of `127.0.0.1:<port>` or `localhost:<port>`, else 403. Every POST needs `content-type: application/json`, else 415 (an empty body is fine). Known gap: the server has no other protection against a hostile web page on this machine.

**GET /api/info** returns `{ app: "ownwords-lite", dir: "<real path of the folder>", pid }`. It is also the way to tell this server from another program on the port. It does not count as use for the idle stop.

**POST /api/stop**: header `x-ownwords: stop` is required, else 403. Replies `{ ok: true, dir }`, then the server finishes pending writes and exits 0.

**Lifecycle.** The server stops by itself after `OWNWORDS_IDLE_MS` without a request (default 600000, which is 10 minutes; 0 means never). Any request except `/api/info` resets the timer. SIGINT and SIGTERM stop it cleanly (exit 0, pending writes finish first). If the port is taken at start: the same folder is served already, so print `already running` and exit 0; our server on another folder is asked to stop (`POST /api/stop`) and the new one takes the port; anything else (another program) exits 1 with a message. Retries last up to 5 s. A holder that is ours but will not stop gives "could not stop the other Ownwords server", exit 1. Exit codes: 0 stopped or already running, 1 error.

**OWNWORDS.md.** On start the server writes `<dir>/OWNWORDS.md` from `templates/OWNWORDS.md`, replacing `{{DIR}}` and `{{APP}}`. It is rewritten only when missing or when its first line (BOM stripped) starts with `<!-- Generated by Ownwords`. Such a file is never a piece: it is not listed and `/api/*/OWNWORDS` gives 400. A user's own `OWNWORDS.md` without that first line is a normal piece and is never touched (the server prints `Kept your OWNWORDS.md; it may be stale.`).

**GET /api/pieces** returns `[{ slug, title, updated }]`, newest first (`slug` is the id). `title` is the first `# ` text, else the id. `updated` is the .md mtime (ISO).

**GET /api/doc/:slug** returns (404 `{error:"no such piece"}`, 304 on matching If-None-Match):
```json
{ "doc": { "title": "",
           "blocks": [ { "id": "g1|p3", "kind": "h1|h2|h3|p|code", "text": "",
                         "options": [ { "text": "", "note": "" } ], "title": true } ],
           "stale": [ { "id": "g2", "original": "", "options": [ { "text": "", "note": "" } ] } ],
           "log": [ { "at": "", "note": "" } ] },
  "ui": { "selection": null, "picks": {} },
  "etag": "", "history": [ { "file": "", "at": "", "note": "" } ],
  "dir": "/abs/path/to/folder", "canReveal": true }
```
- `options` and `title` appear only when set. A group block has `id` = group id, kind of its paragraph (`p` if it covers several), `text` = member texts joined by a blank line (for a group of several paragraphs the members keep their `#` marks, so the page can show each paragraph by its own kind, in the current text and in every option). `title: true` when the group is exactly the title paragraph. Other paragraphs have id `p<index>` (whole-file paragraph index; it shifts when text is added).
- `etag` = quoted sha1 base64url of `mdText + "\0" + versionsText` (versions text is empty if no file). The ETag header is the same.
- `history` is oldest first.
- `canReveal` is true only on macOS (`process.platform === 'darwin'`). It tells the page whether POST /api/reveal works.

**GET /api/history/:slug/:file**: `file` must match `<YYYYMMDD-HHMMSS-mmm>.md`, else 400. Missing is 404. Returns `{ title, blocks: [{ id: "p<i>", kind, text }] }`. With `?raw=1` it returns the Markdown (`text/markdown; charset=utf-8`). Snapshot ids are not stable: diff by paragraph text.

**POST /api/ui/:slug**: body is the full ui.json object. 404 if the .md is missing. Written by temp file plus rename. Returns `{ ok: true }`. No snapshot, no etag change.

**POST /api/accept/:slug**: body `{ "group": "g1", "pick": 2, "etag": "<etag of the last GET>" }`. `etag` is optional: missing means no stale check (agents can call it with curl). Present and different gives 409. `pick` is 1-based: `n` uses `options[n-1]`. `pick` 0 drops the group (keeps the .md text, nothing else changes). All inside the per-piece lock, files written by temp file plus rename.
- Title group (exactly the title paragraph), pick 1 or more: rewrites the `# ` line with the option as a plain title, renames the .md and its folder to the new slug (`-2`, `-3` on a clash), removes the group, logs `Title: <new>`. Returns `{ slug, title }`.
- Other group, pick 1 or more: replaces the group's paragraphs (first start to last end) with the option text, removes the group, logs `Used version <pick+1> of "<first 6 words of original>…" (<option note>)` (no parentheses when the note is empty). Returns `{ slug }` (unchanged).
- Drop (pick 0, any group including the title): the .md is not written, no rename, no snapshot. The group is removed and logs `Dropped other versions of "<first 6 words of original>…"`. Returns `{ slug }`.
- Every accept appends `{ id, original, options, result, pick, at }` to closed.json (creates the file if missing; a closed.json that is not a JSON array gives 500 and nothing is written).
- 400: bad JSON, missing fields, `pick` below 0 or out of range, empty title after cleaning. 404: no piece, group missing or stale. 409 `{ "error": "changed" }`: etag given and differs, or the file changed during the write. The page then reloads.
- The group is removed from `groups` and added to closed.json. ui.json is not touched. The page drops picks and compare for the group (they point at a group that is gone) but keeps its `feedback` marks, notes included. Marks on a closed group stay in ui.json and may no longer be painted. Before acting on a note, check that the mark's `block` and `quote` still exist.

**POST /api/restore/:slug**: body `{ "file": "<history[].file>", "etag": "<etag of the last GET>" }`. `file` is checked like GET /api/history (must match `<YYYYMMDD-HHMMSS-mmm>.md`, else 400). 404: no piece or no such snapshot. 409 `{ "error": "changed" }`: etag differs. Inside the per-piece lock it adds the log entry `Restored <HH:MM local time of the snapshot>` to versions.json, writes the snapshot text to the .md (never renames), then refreshes, which makes a new snapshot carrying that note. Returns `{ ok: true }`.

**POST /api/reveal/:slug**: body `{ "file"?: "<history[].file>" }` (an empty body is fine). No `file` reveals the .md, with `file` that history snapshot. Runs `open -R <path>` on macOS and returns `{ ok: true }`. 400 bad `file`, 404 missing file or piece, 501 off macOS. Env `OWNWORDS_LITE_NO_OPEN=1` skips the `open` call and still returns 200 (tests).

An id that is empty, starts with `.`, or has `/`, `\` or a control character gives 400, as does a broken percent escape. The server decodes the id from the URL once. Path traversal is impossible.

## Paragraph rules (`parseParas`)

- Offsets are in the original text. A leading BOM is skipped. CR is removed from lines.
- Front matter (`---` first line, closing `---`) is skipped. Unclosed means ordinary text.
- A blank (whitespace only) line ends a paragraph.
- A line starting `#`, `##` or `###` plus a space or tab is its own paragraph (h1 to h3). `####` is plain text. No setext headings.
- A fence line (` ``` ` or `~~~`, up to 3 spaces indent) opens a `code` paragraph. It closes on a line of the same character, at least as long, then only spaces. Blank lines inside stay. An unclosed fence runs to the end of the file.
- Everything else (lists, quotes, tables, HTML) is plain text. A tight list is one paragraph.
- A group's `original` is parsed the same way. Its paragraphs must be a run of consecutive paragraphs in the .md. Matching: exact on `raw` (or on `text`, so a heading original may omit `#`), then again with whitespace collapsed. Document order, first free run wins, a paragraph is claimed by one group only.

## Snapshot rules

- A snapshot is an exact copy of the .md text, named `YYYYMMDD-HHMMSS-mmm.md` (UTC).
- Made when a good read shows .md text different from the cached text. First read in a server run: only if there is no snapshot or the newest differs. Never for versions.json or ui.json changes. Never for empty or whitespace-only text (the last good doc is kept).
- Changes are found by stat (mtime, size, inode) on each request and a 1 s interval. No fs.watch.
- Note for a snapshot: the last log entry whose time is after the previous snapshot time plus 15 s and at or before this snapshot time plus 15 s (no lower bound for the first). Else empty.
