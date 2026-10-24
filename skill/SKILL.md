---
name: polish
description: Use only when the user says "start polishing", "polish this" or "let's polish", or names Ownwords Lite. Puts their text on a local page, then edits it from what they select and mark there. Not for general editing.
---

# Polish (Ownwords Lite)

Read `<folder>/OWNWORDS.md` and follow it. It holds every rule.

`<folder>` is the first non-empty line of `~/.ownwords-lite` (a leading `~` is the home folder). If that file is missing, use `~/Desktop/Ownwords`. The second non-empty line, if there, is the app folder.

If `<folder>/OWNWORDS.md` is missing, Ownwords is not set up or has not run yet. Find the app folder (the second line of `~/.ownwords-lite`, or the folder that holds `server.js` and `INSTALL.md`) and follow `INSTALL.md`. If you cannot find it, ask the user where they unzipped Ownwords.

If the app folder was moved, run `node <app>/server.js` once: it rewrites `OWNWORDS.md` and the second line with the new paths.
