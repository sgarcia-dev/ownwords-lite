#!/bin/sh
# Ownwords launcher helper. Usage: open-ownwords.sh <pieces folder>
# Thin on purpose: find Node, start the server detached, wait until it serves this folder, open a window.
# The server owns all port and takeover logic.
# Env (all optional, for tests): PORT, OWNWORDS_NODE, OWNWORDS_MIN_NODE, OWNWORDS_BROWSER, OWNWORDS_SERVER.
# Other env (OWNWORDS_IDLE_MS) passes through to the server.
# Exit codes: 0 ok, 2 bad folder, 3 no Node 22+, 4 server did not start.
FOLDER=$1
PORT=${PORT:-4646}
URL="http://127.0.0.1:$PORT/"
HERE=$(cd "$(dirname "$0")" && pwd -P)
SERVER=${OWNWORDS_SERVER:-$HERE/../server.js}
MIN_NODE=${OWNWORDS_MIN_NODE:-22}

[ -d "$FOLDER" ] || { echo "Folder not found: $FOLDER"; exit 2; }
FOLDER=$(cd "$FOLDER" && pwd -P)

# 1. Find a Node that is new enough. A GUI app gets PATH=/usr/bin:/bin:/usr/sbin:/sbin only.
ok_node() { [ -x "$1" ] && [ "$("$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null)" -ge "$MIN_NODE" ] 2>/dev/null; }
find_node() {
  [ -n "$OWNWORDS_NODE" ] && ok_node "$OWNWORDS_NODE" && { echo "$OWNWORDS_NODE"; return; }
  c=$(/bin/zsh -lc 'command -v node' 2>/dev/null | tail -n 1)         # the user's login shell PATH
  [ -n "$c" ] && ok_node "$c" && { echo "$c"; return; }
  for c in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node" \
           "$HOME/.local/share/mise/shims/node" "$HOME/.asdf/shims/node" "$HOME/.local/bin/node"; do
    ok_node "$c" && { echo "$c"; return; }
  done
  for c in $(ls -d "$HOME"/.nvm/versions/node/v*/bin/node "$HOME"/.local/share/fnm/node-versions/v*/installation/bin/node 2>/dev/null | sort -V -r); do
    ok_node "$c" && { echo "$c"; return; }
  done
  return 1
}
NODE=$(find_node) || { echo "Ownwords needs Node $MIN_NODE or newer. Install it from https://nodejs.org, then open this again."; exit 3; }

# 2. Which folder does the server on the port serve? (GET /api/info). Prints the folder, or nothing.
served() {
  /usr/bin/curl -s -m 2 "${URL}api/info" 2>/dev/null | "$NODE" -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { const j = JSON.parse(s); if (j && j.app === "ownwords-lite" && j.dir) console.log(j.dir); } catch {}
    })'
}

# 3. Already serving this folder: only open a window. Else start detached and wait.
if [ "$(served)" != "$FOLDER" ]; then
  mkdir -p "$FOLDER/.ownwords"
  LOG="$FOLDER/.ownwords/server.log"
  nohup "$NODE" "$SERVER" "$FOLDER" >"$LOG" 2>&1 </dev/null &
  PID=$!
  i=0
  until [ "$(served)" = "$FOLDER" ]; do
    i=$((i+1))
    if [ $i -gt 40 ] || ! kill -0 "$PID" 2>/dev/null; then   # 8 s, or the server already exited
      [ "$(served)" = "$FOLDER" ] && break
      echo "Log: $LOG"; exit 4
    fi
    sleep 0.2
  done
fi

# 4. Open an app-style window if Chrome or Edge is installed, else the default browser.
open_window() {
  if [ -n "$OWNWORDS_BROWSER" ]; then "$OWNWORDS_BROWSER" "--app=$URL" >/dev/null 2>&1 & return; fi
  for b in "Google Chrome" "Microsoft Edge" "Brave Browser"; do
    for base in /Applications "$HOME/Applications"; do
      bin="$base/$b.app/Contents/MacOS/$b"
      # Running the binary hands the URL to an already-running Chrome and opens a new app window.
      [ -x "$bin" ] && { "$bin" "--app=$URL" >/dev/null 2>&1 & return; }
    done
  done
  /usr/bin/open "$URL"
}
open_window
