# Install Ownwords Lite (steps for an AI agent)

You are setting up Ownwords Lite for the user. Do the steps in order. Ask the user only where a step says ask. Each step checks before it acts, so running this file again repairs a broken setup and changes nothing that is already right.

- `<app>` is the absolute path of the folder that holds this file (and `server.js`).
- `<folder>` is the absolute path of the user's pieces folder (step 2).
- Commands below are for macOS and Linux shells. On Windows, see [Windows and Linux](#windows-and-linux).

## Steps

1. **Check Node.** Run `node -v`. It must print v22 or higher. If `node` is missing or older, tell the user to install the current LTS from https://nodejs.org, then stop. Do not install it yourself unless they ask.

2. **Ask where to keep the writing.** If `~/.ownwords-lite` exists and its first non-empty line is a folder that exists, tell the user you will keep using it and skip the question. Otherwise offer:
   - `~/Desktop/Ownwords` (default, easy to find)
   - `~/Documents/Ownwords`
   - `~/Downloads/Ownwords`
   - another folder they name

   Create the folder if it is missing. If it already holds files, say so and use it anyway: any `.md` file in it becomes a piece.

3. **Write `~/.ownwords-lite`.** Two lines, absolute paths, nothing else:

   ```
   <folder>
   <app>
   ```

   Line 1 is the pieces folder. Line 2 is the app folder. If the file exists with a different line 1, ask before changing it. The server keeps line 2 up to date on every start.

4. **Install the `polish` skill pointer** for your own tool. Copy `<app>/skill/SKILL.md` unchanged (it holds no paths) to:
   - **Claude Code:** `~/.claude/skills/polish/SKILL.md`
   - **Codex:** `~/.agents/skills/polish/SKILL.md`, or the folder your Codex version reads skills from.
   - **Another agent that reads skills:** its skills folder, as `polish/SKILL.md`.
   - **An agent without skills:** add one line to its global instructions file (for example `AGENTS.md`): `When I say "start polishing", read <folder>/OWNWORDS.md and follow it.` If you cannot do that either, tell the user to use the page's "Copy prompt" button.

   If the file is already there and identical, leave it.

5. **macOS only: build the launcher.** Run:

   ```
   sh "<app>/launcher/build.sh" "<app>" "<folder>"
   ```

   It prints `Built <folder>/Open Ownwords.app` and replaces any older copy. Always build it on the user's machine; never copy a built app from elsewhere (macOS would block it). Tell the user: the first time they open it, macOS may ask to let "Open Ownwords" access the folder (for example the Desktop). They should click Allow.

6. **Start the server and open the page.**
   - macOS: `open "<folder>/Open Ownwords.app"`. It starts the server and opens a window.
   - Otherwise, start it in the background with your own background-command tool, output discarded: `nohup node "<app>/server.js" "<folder>" >/dev/null 2>&1 &`. Then open `http://127.0.0.1:4646`.

   Wait until `curl -s http://127.0.0.1:4646/api/info` answers (up to 5 seconds). The reply's `dir` must be `<folder>` (macOS may show its real path, for example with `/private` or resolved links). Then confirm `<folder>/OWNWORDS.md` exists. If the server prints that port 4646 is used by another program, tell the user and see [docs/maintenance.md](docs/maintenance.md#troubleshooting).

7. **Tell the user how to start**, in three short lines:
   - where their folder is;
   - to polish, say "start polishing" to you and paste text, or open a piece and use the "Copy prompt" button with any agent;
   - on macOS, double-click "Open Ownwords" in the folder to open the page; it stops by itself after 10 minutes unused; nothing leaves their machine.

   Optional: in Chrome, the menu's Install item turns the page into its own app window with a Dock icon. The port is part of that app, so keep 4646.

## Check

Ask the user to say "start polishing" in a new chat and paste a paragraph. The page should open on that piece. If it does not, run this file again.

## Move or rebuild

If the user moved the app folder: run `node "<new app>/server.js"` once (it rewrites `OWNWORDS.md` and line 2 of `~/.ownwords-lite`), stop it (`Ctrl+C` or wait 10 minutes), and on macOS run step 5 again. If they want a different pieces folder: run steps 2, 3, 5 and 6 again.

## Windows and Linux

There is no launcher. Everything else is the same.

- Do steps 1 to 4 and 6. Skip step 5.
- `~/.ownwords-lite` is the file `.ownwords-lite` in the user's home folder (on Windows, `%USERPROFILE%\.ownwords-lite`). Write full absolute paths; do not start them with `~`.
- Start the server: `node "<app>/server.js" "<folder>"`. On Windows, `start /b node "<app>\server.js" "<folder>"` or your tool's background mode. Then open `http://127.0.0.1:4646`.
- The user starts it later by saying "start polishing" (the agent starts the server) or by running the same command.
- Windows: the Desktop is often inside OneDrive. A synced folder can lock files for a moment and make saves fail. Prefer `Documents\Ownwords` outside OneDrive, or pause sync.

## Uninstall

Delete `Open Ownwords.app` from the folder, the skill file from step 4, `~/.ownwords-lite` and the app folder. The pieces folder stays: your writing is plain Markdown. Delete its `.ownwords/` folder and `OWNWORDS.md` too if you no longer want the history.
