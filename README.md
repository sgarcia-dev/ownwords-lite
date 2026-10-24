# Ownwords Lite

Ownwords Lite is a small local page for polishing your writing with an AI agent. Your writing stays in plain Markdown files in a folder you choose. The page shows the text. You select parts, mark what you like and dislike, flip through versions in place and compare them. You tell your agent in chat what to change, and it edits the files. No dependencies, no account, no prompt box. Nothing leaves your machine.

## Quick start

1. Download the repo (zip or `git clone`) and put it anywhere.
2. Open your AI agent (Claude Code, Codex, or any agent that can read and write files) and say:

   ```
   Read "<path>/INSTALL.md" and set up Ownwords for me.
   ```

   `<path>` is where you put the repo. The agent checks Node, asks where to keep your writing (default `~/Desktop/Ownwords`), installs a small `polish` skill and, on a Mac, puts an `Open Ownwords` app in that folder.
3. Say "start polishing" and paste some text. The page opens at `http://127.0.0.1:4646`.

Prefer to do it by hand? [INSTALL.md](INSTALL.md) is plain steps. On Windows or Linux there is no launcher: run `node server.js` from the repo folder (see [INSTALL.md](INSTALL.md#windows-and-linux)).

## What you get

- **Your folder** (default `~/Desktop/Ownwords`): one `.md` file per piece. Drop any Markdown file in and it becomes a piece.
- **`OWNWORDS.md`** in that folder: every rule an agent needs. The server rewrites it on start, so it never goes stale.
- **`Open Ownwords`** (macOS): double-click it to start the server and open the page in its own window.
- **Copy prompt** button on the page: copies a ready prompt you can paste into any agent that can open the folder.
- **Install as an app window**: in Chrome, use the menu's Install item to get a Dock icon.
- **It stops by itself** after 10 minutes with no page open. The page then says "Ownwords stopped". Double-click `Open Ownwords` or ask your agent to start it again.

## How to use it

Click a sentence to select it. The bar widens the selection to the paragraph, the section or everything. 👍 and 👎 mark what you like or dislike: click again for "really", a third time to clear, and add an optional note. Then tell the agent "make 3 more", "shorter" or "take 3".

The agent's drafts show in place. Arrows flip between versions. "Compare" shows the changes against any other version. "Use this version" keeps one; "Drop the other versions" keeps your text. The timeline lists every saved change, compares the whole piece against any of them, and "Restore" brings an old state back (as a new row, so you can undo it).

## Files

```
<folder>/<name>.md                      your piece; the first "# " line is the title
<folder>/OWNWORDS.md                    rules for agents (the server writes it)
<folder>/.ownwords/<name>/versions.json pending versions and the change log (the agent writes it)
<folder>/.ownwords/<name>/closed.json   versions you used or dropped (the server writes it)
<folder>/.ownwords/<name>/ui.json       selection, picks, compare and marks (the page writes it)
<folder>/.ownwords/<name>/history/*.md  a snapshot after each change (the server writes it)
```

Delete `.ownwords/` and you lose only pending versions, marks and history. Your text is untouched. "Use this title" renames the file. A sample is in `examples/`: run `node server.js examples` and open `http://127.0.0.1:4646/#sample`.

## Requirements

- Node 22 or newer.
- macOS for the `Open Ownwords` launcher. Windows and Linux work with `node server.js`.
- An AI agent that can read and write files in your folder.
- Chrome, Edge or Brave for the app-style window. Any modern browser shows the page.

## Run and test

```
node server.js [folder]
node --test
sh launcher/test.sh
```

## More

- [INSTALL.md](INSTALL.md): setup steps for an agent (or you).
- [CONTRACT.md](CONTRACT.md): exact file formats and HTTP API.
- [docs/architecture.md](docs/architecture.md): how the parts fit and why.
- [docs/decisions.md](docs/decisions.md): decisions with reasons and rejected options.
- [docs/maintenance.md](docs/maintenance.md): release, troubleshooting, where things live.
- [docs/devlog.md](docs/devlog.md): what changed, by date.

Built with AI agents under the author's direction.

## License

MIT. See [LICENSE](LICENSE).
