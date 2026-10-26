# Decisions

Newest last. Each entry: what was decided, why, and what was rejected. A later decision can change an earlier one; it says so.

## D1 Start over small: a static page plus files (2026-10-23)

**Decision.** Ownwords Lite is a static page, a small Node server with zero npm dependencies, and plain files. The agent does all the writing from chat. The page only shows the text, versions in place, changes and a timeline, and saves the selection. No MCP server, no prompt box, no settings, no AI calls in the page. Each file has one writer. The `polish` skill ships in the repo so everyone gets the same file.

**Why.** An earlier, larger app was over-engineered. The agent the user already has is better at writing than anything the page could call, and a tool for anyone should need nothing beyond Node.

**Rejected.** An MCP server (more moving parts, one more thing to configure per agent). A prompt box in the page (duplicates the chat). A desktop framework (see D5).

## D2 Markdown storage, compare per version, feedback marks (2026-10-23)

**Decision.** A piece is a plain Markdown file. A hidden sidecar folder holds versions, marks and history. Rule: Markdown holds what you would keep, the sidecar holds what you would throw away. Versions anchor to the exact paragraph text, not ids. Compare is per version group with a chosen base, plus the whole-piece timeline. Feedback is 👍 and 👎 with two strengths (click again for "really") and an optional note. One accept route serves titles and paragraphs.

**Why.** The user must own their writing in a format every editor opens. Text anchoring keeps the file clean, and a hand edit just makes a group stale. A global "Changes" view never said "compared to what", so compare moved to each group.

**Rejected.** CriticMarkup or inline id markers (clutter the file, break in other editors). JSON-only storage (the text is not yours to open elsewhere). A single like level (too coarse: strength matters when you combine drafts).

## D3 Accept, drop, restore; one folder; marks never overlap (2026-10-24)

**Decision.** Plain buttons: "Use this version", "Drop the other versions" (accept with pick 0) and "Restore" on timeline rows. Restore adds a new row, so it can be undone. Closed groups keep every option and the outcome, as a record of taste; nothing is deleted. One folder for all pieces, set once in `~/.ownwords-lite`. Marks: green underline for like, red dashed for dislike. A mark under the pointer wins hover and click; a vote that would overlap a mark is disabled, so marks never nest.

**Why.** Every action must be safe to try. Underlines never read as diff colours. Nested marks were confusing to show and to read back.

**Rejected.** A folder per piece (more setup for no gain). Deleting closed drafts (loses what the user rejected, which is useful signal). Fill colours for marks (clash with the diff view).

## D4 Desktop folder, any Markdown file, agent uses the accept route (2026-10-24)

**Decision.** The default folder is `~/Desktop/Ownwords`. Any `.md` file in it is a piece (spaces and capitals allowed), so files can be dropped in and resumed by name. No front-matter id. The only rename is accepting a title, which moves the file and its sidecar together; an open page follows. Closed groups live in `closed.json` so `versions.json` stays small for agents. The agent picks versions with the same accept call as the page (etag optional). Restore changes the text only. Many pieces, whole-structure versions and title sets need no extra support: one file per piece, one group per set.

**Why.** Your writing should sit where you see it, not in a hidden app folder. One accept path means one set of tests. Small files keep agents fast and cheap.

**Rejected.** A hidden library folder (people lose track of their files). Front-matter ids (clutter, and break when files are copied). Agents editing versions by hand to accept (two code paths that drift).

## D5 No Electron for now; launcher, folder instructions, idle stop (2026-10-24)

**Decision.** Instead of a desktop app, a set of small pieces:

- **Launcher.** A locally built `Open Ownwords.app` in the folder starts the server and opens a Chrome, Edge or Brave app window (else the default browser). The repo ships the build script, never a built app.
- **Folder instructions.** The server writes `OWNWORDS.md` into the folder on start, from `templates/OWNWORDS.md` with the real paths. The `polish` skill becomes a pointer to it. A "Copy prompt" button hands any agent a ready prompt.
- **Idle stop.** The server exits after 10 minutes with no request. The page says "Ownwords stopped" and keeps unsaved changes until the server is back.
- **No service worker.** The page installs as an app window from Chrome's menu without one.
- **Host allowlist and JSON-only POSTs.** Requests need a `127.0.0.1` or `localhost` Host header with the right port, and every POST needs `content-type: application/json`.
- **Node 22 or newer** (tested on 22 and 26).

**Why.** The worry was that nobody can see who runs the server. Electron would bundle Node but costs packaging, signing, notarization and updates on every platform, for little gain over a launcher. Building the launcher on the user's Mac avoids Gatekeeper blocks and needs no signing. Instructions in the folder mean any agent that can see the folder has every rule, and they cannot go stale because the server rewrites them. 10 minutes (not 5) because browsers throttle timers in hidden tabs. A service worker adds caching bugs on a page that is only ever served locally. The Host check stops DNS rebinding; JSON-only POSTs stop simple cross-site form posts.

**Rejected.** Electron or another bundled runtime (revisit only when sharing with people who do not have Node). A `.command` file (opens a Terminal window and is quarantined when downloaded). Shipping a prebuilt `.app` (blocked by macOS as unsigned). A per-agent copy of the full rules (goes stale). A server that runs forever (nobody knows it is there). Polling for liveness from the launcher with `lsof` or `kill` (the server owns its own port logic, reached through `/api/info` and `/api/stop`).

## D6 WebMCP not now (2026-10-23, re-check)

**Decision.** Do not add WebMCP. Agents keep editing files directly.

**Why.** As of 2026-10-23 it needed a browser flag and about 240 more lines, and the agents in use did not support it natively. The file approach already works with any agent. These facts may be stale: re-check before relying on them.

**Rejected.** WebMCP now (flag-only, no gain yet). A hosted remote MCP server (days of work, accounts and hosting; only worth it if people need the Claude or ChatGPT websites). Revisit when WebMCP ships without flags and agents support it natively.

## D7 Marks are range + score + note; neutral notes (2026-10-24)

**Decision.** A mark is a range, an optional score (2, 1, 0, -1, -2) and a note.

- Score 0 is a neutral note. It needs a non-empty note, and the mark is created at the first typed character.
- A vote edits the mark in place and never drops its note. Clearing a thumb keeps a mark that has a note. The mark goes only when score is 0 and the note is empty, or with the note box's remove button.
- The note box is a 3-row textarea that saves as you type.
- ui.json POSTs go one at a time, latest wins.
- Agents read the note on every mark.
- Notes go up to 2000 characters; 280 cut off real notes.

**Why.** Sergei lost notes on repeated 👍 and on 👍 to 👎, and could not see saved notes. Note and vote are two fields on one mark, so neither may change the other.

**Rejected.** Creating a neutral mark on click (an empty neutral is lost by `clean()` and the next save). Storing notes in a separate list (two stores to keep in step). 💬 as a vote button (it became a like). Saving only on Enter. Rendering the page on every keystroke. Migrating old files (none can contain score 0).

## D8 Overlapping groups: the earlier one wins, the other is hidden (2026-10-26)

**Decision.** Several version groups can be open at once if they share no paragraph. When two overlap, matching goes in `groups` order and the earlier group wins. The later one is hidden: `doc.stale` lists it with `hiddenBy` (the winner's id), and the page shows it under the text, apart from truly stale groups, saying which open group hides it. It comes back when the winner is used or dropped. Accept on it gives 404, like a stale group. Agents propose per section (one group per section, heading included) and use a whole-article group only when nothing else is open.

**Why.** Options for the opening, a middle section and the conclusion should switch independently. A whole-article group overlaps all of them, so one rule has to decide. Array order is already how matching works, so nothing new to learn. "Hidden" tells the user the text did not change, so they do not rebuild a group for nothing.

**Rejected.** Nesting groups (what a pick means inside a pick is unclear, and accept would have to rewrite the inner originals). Splitting a group automatically (the server would invent text boundaries the agent did not choose). Treating overlaps silently as stale (wrong reason, and the user would think their edit broke it).

## D9 Sticky side panel for version controls (2026-10-26)

**Decision.** The version controls (prev/next, count, note, whole-version thumbs and note, Compare, Use/Drop) live in a sticky panel on the right (`#vpanel`). It shows them for every group block in view and highlights the selected group. It sits left of the timeline when the timeline is open. At narrow widths there is no panel: the bar stays under each block and sticks to the bottom of the screen while its block is in view.

**Why.** With several groups on a long page, a bar under each block scrolls out of reach. One panel keeps the controls next to the text being read, and the narrow fallback needs no extra layout.

**Rejected.** A floating toolbar per block only (jumps around and covers text). Duplicating the bar at the top and the bottom of each block (clutter, and two places to keep in step).
