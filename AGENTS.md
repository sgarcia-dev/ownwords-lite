# Agents working on Ownwords Lite

This file is for agents changing the code. Agents polishing someone's writing
follow `OWNWORDS.md` in the pieces folder instead (made from `templates/OWNWORDS.md`).

## Start here
- `docs/architecture.md`: code map, moving parts, who writes which file.
- `CONTRACT.md`: exact file formats and API routes.
- `docs/decisions.md`: what was decided and why. Do not undo a decision without a new one.
- `docs/maintenance.md`: run, test, release, troubleshooting.

## Rules
- Keep it stupid simple. Zero dependencies, no build step, plain browser JS. Add no feature nobody asked for.
- One writer per file (see architecture). Never let two writers touch the same file.
- Never touch a real user's pieces folder or the server on port 4646 in tests. Use temp folders, a temp HOME and another port.
- Run `npm test` (and `sh launcher/test.sh` on macOS if you touched `launcher/`) before you commit. All must pass.

## Every change updates the docs in the same commit
- `docs/devlog.md`: one dated line saying what changed and why.
- `docs/decisions.md`: a new entry if you made a decision (what, why, what you rejected).
- `CONTRACT.md`: if a file format, route or response changed.
- `docs/architecture.md`: if a part was added, removed or rewired.
- `templates/OWNWORDS.md`: if what an agent must do while polishing changed.
- `README.md` or `INSTALL.md`: if what a user or installer does changed.

## Public safety
The repo is public. No personal paths, names of private folders, or anyone's writing.
Before a release: `git ls-files | xargs grep -n -i -E "/Users/[a-z]"` must print nothing.
