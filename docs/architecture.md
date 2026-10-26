# Architecture

The picture and the reasons. Exact file formats, HTTP routes and parsing rules live in [CONTRACT.md](../CONTRACT.md); this file does not repeat them.

## The picture

```
  you ── chat ──▶ AI agent ──── edits ────▶ <folder>/<id>.md
   │                │                       <folder>/.ownwords/<id>/versions.json
   │                │ reads
   │                ├── <folder>/OWNWORDS.md   (rules, written by the server)
   │                └── .../ui.json            (what you selected and marked)
   │
   └── select, mark ──▶ page (browser) ◀── polls every 1 s ──▶ server (node server.js)
                         127.0.0.1:4646                         reads the folder,
                                                                writes snapshots,
                                                                closed.json, ui.json

  Open Ownwords.app (macOS) ──▶ launcher/open-ownwords.sh ──▶ starts server, opens window
  polish skill (in the agent) ──▶ "read <folder>/OWNWORDS.md"
```

## The moving parts

- **Folder.** Plain Markdown, one file per piece, plus a hidden `.ownwords/` sidecar per piece. The Markdown holds what you would keep. The sidecar holds what you would throw away: drafts, marks, history.
- **Agent.** Does all the writing, from chat. It edits the Markdown and appends version groups to `versions.json`. To pick a version it calls the same accept route as the page, so there is one code path.
- **Server** (`server.js`, `lib/md.js`). Node built-ins only. Serves the page and a small JSON API on `127.0.0.1`. It notices file changes by `stat` on each request and every second, snapshots the Markdown after each change, and does the few writes that touch several files (accept, restore). It writes `OWNWORDS.md` on start and stops itself when nobody uses it.
- **Page** (`public/`). Plain browser scripts, no build, no framework. Polls the server every second with an etag, so an agent's edit shows up within about a second. Shows versions in place, word diffs, marks and the timeline. A sticky version panel on the right holds the controls for the group blocks in view (a bar under each block on narrow screens). Writes only `ui.json`, through the server. Saves go one at a time (the latest wins), and typing in a note box saves without redrawing the page.
- **`OWNWORDS.md`.** Generated from `templates/OWNWORDS.md` with the real folder and app paths filled in. An agent that can only see the folder still has every rule.
- **Skill pointer** (`skill/SKILL.md`). A few lines copied into the agent's skills folder: "read `<folder>/OWNWORDS.md`". It holds no paths, so it never needs editing.
- **Launcher** (`launcher/`, macOS). A tiny AppleScript app built on the user's Mac and placed in the folder. It runs `open-ownwords.sh`, which finds Node, starts the server for the folder the app sits in, waits for `/api/info`, and opens a Chrome, Edge or Brave app window (else the default browser).

## Rules that hold it together

- **One writer per file.** The agent writes the Markdown and `versions.json`. The page writes `ui.json` (through the server). The server writes `closed.json`, `history/` and `OWNWORDS.md`. The two exceptions (accept and restore) run inside a per-piece lock and write by temp file plus rename. This is why there is no merge logic anywhere.
- **Anchor by text, not ids.** A version group stores the exact paragraphs it replaces. The server finds them in the Markdown each time. The file stays clean (no markers, no front matter), and a hand edit simply makes the group stale instead of corrupting anything.
- **Nothing is deleted.** Used or dropped groups move to `closed.json` with every option. Restore adds a new timeline row, so it can be undone.
- **Re-read before writing.** Agents must read a file right before writing it, because you or the page may have changed it. `OWNWORDS.md` says so.

## Lifecycle

- **Start.** Anyone can start the server: the launcher, the agent (every turn, per `OWNWORDS.md`), or you with `node server.js`. A second start for the same folder exits quietly. A start for another folder asks the running Ownwords server to stop and takes the port. Another program on the port is never touched: the server exits with a message.
- **Idle stop.** After 10 minutes with no request, the server finishes pending writes and exits. The page polls every second while open, so an open page keeps it alive. 10 minutes, not 5, because browsers slow down timers in hidden tabs.
- **Stopped.** After two failed polls the page shows "Ownwords stopped" and keeps any unsaved selection or marks. When the server answers again, the notice goes away and the saved changes are sent.
- **Who is on the port.** `GET /api/info` answers `{ app, dir, pid }`. The launcher, the agent and a second server all use it to tell "our server for this folder" from anything else.

## Why these choices

- **Local page plus files, no app framework.** Zero dependencies means nothing to install or update beyond Node, and the whole thing is readable in an afternoon.
- **The agent edits files directly.** Any agent that can read and write files works: no plugin, no MCP server, no API keys in the page.
- **Polling, not file watching or sockets.** One request a second on localhost is cheap, works the same on every OS and doubles as the "page is open" signal for idle stop.
- **Launcher built locally.** A built app downloaded from elsewhere gets blocked by macOS. Building it with `osacompile` on the user's Mac avoids that, needs no signing and opens no Terminal window.
- **No service worker.** Chrome offers Install without one, and a cache would add stale-page bugs for no gain on localhost.
- **Host allowlist and JSON-only POSTs.** They block the easy attacks from other web pages and DNS rebinding. A determined page on the same machine is a known gap (see CONTRACT).

More reasons and rejected options: [decisions.md](decisions.md).

## Repo map

| Path | What it is |
|---|---|
| `server.js` | The server: API, snapshots, accept, restore, idle stop, `OWNWORDS.md`. |
| `lib/md.js` | Pure functions: paragraph parsing, group matching, slugs, history notes. |
| `public/index.html`, `app.js`, `style.css` | Page shell, logic and styles. |
| `public/diff.js`, `diff.css` | Word diff and compare views. |
| `public/feedback.js`, `feedback.css` | Like, dislike and neutral note marks, and the note box. |
| `public/timeline.js` | Timeline panel. |
| `public/manifest.webmanifest`, `public/icons/` | Install-as-app metadata and icons. |
| `templates/OWNWORDS.md` | Source of the folder's `OWNWORDS.md`. |
| `skill/SKILL.md` | The `polish` skill pointer. |
| `launcher/` | macOS launcher: AppleScript source, shell helper, build script, icon, tests. |
| `examples/` | A sample piece with pending versions. |
| `test/` | `node --test` suites for the parser, diff, feedback and server. |
| `CONTRACT.md` | Exact formats and API. |
