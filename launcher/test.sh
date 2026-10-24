#!/bin/sh
# Launcher tests. Run: sh launcher/test.sh
# Uses temp folders, free ports and a stub browser. Never touches port 4646 or your real folders.
HERE=$(cd "$(dirname "$0")" && pwd -P)
REPO=$(cd "$HERE/.." && pwd -P)
NODE=$(command -v node) || { echo "FAIL need node on PATH to run these tests"; exit 1; }
T=$(cd "$(mktemp -d)" && pwd -P)
# Servers started here must not write to the real home (the server keeps ~/.ownwords-lite).
# So every run gets a temp HOME; the real Node is resolved once and passed as OWNWORDS_NODE.
TH="$T/home"; mkdir -p "$TH"
PORTS=
FAILS=0

# Stop every server this script started (found through /api/info) and remove the temp dir.
cleanup() {
  for p in $PORTS; do
    pid=$(info "$p" pid)
    [ -n "$pid" ] && kill "$pid" 2>/dev/null
  done
  sleep 0.3
  rm -rf "$T"
}
trap cleanup EXIT

ok()   { echo "ok   $1"; }
fail() { echo "FAIL $1"; FAILS=$((FAILS+1)); }
check() { if [ "$1" = 0 ]; then ok "$2"; else fail "$2"; fi; }   # check <status> <name>

freeport() { "$NODE" -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }
info() {  # info <port> <field>: one field of GET /api/info, empty if none
  /usr/bin/curl -s -m 2 "http://127.0.0.1:$1/api/info" 2>/dev/null | "$NODE" -e '
    let s=""; process.stdin.on("data",(d)=>s+=d).on("end",()=>{try{const j=JSON.parse(s);if(j.app==="ownwords-lite")console.log(j[process.argv[1]])}catch{}})' "$2"
}

# Stub browser: logs its arguments, one line per call.
STUB="$T/browser.sh"
BLOG="$T/browser.log"
printf '#!/bin/sh\necho "$@" >> "%s"\n' "$BLOG" > "$STUB"
chmod +x "$STUB"
: > "$BLOG"

# run_launcher <port> <folder> [VAR=value ...]: runs with a bare environment and a temp HOME.
run_launcher() {
  port=$1; folder=$2; shift 2
  env -i HOME="$TH" PATH=/usr/bin:/bin OWNWORDS_NODE="$NODE" PORT="$port" OWNWORDS_IDLE_MS=0 OWNWORDS_BROWSER="$STUB" "$@" \
    /bin/sh "$HERE/open-ownwords.sh" "$folder"
}
wait_log_lines() {  # wait_log_lines <n>: until the stub browser log has n lines (it runs in the background)
  i=0; while [ "$(wc -l < "$BLOG" | tr -d ' ')" -lt "$1" ] && [ $i -lt 25 ]; do i=$((i+1)); sleep 0.2; done
}

echo "launcher tests (temp dir $T)"
sh -n "$HERE/open-ownwords.sh" && sh -n "$HERE/build.sh" && sh -n "$HERE/test.sh"; check $? "sh -n on all .sh files"

# 1. Happy path: folder with a space and non-ASCII characters, empty.
P1=$(freeport); PORTS="$PORTS $P1"
F1="$T/ow lite ünï"; mkdir -p "$F1"; REAL1=$(cd "$F1" && pwd -P)
OUT=$(run_launcher "$P1" "$F1"); RC=$?
check $RC "1 happy path: exit 0 ($OUT)"
[ "$(info "$P1" dir)" = "$REAL1" ]; check $? "1 /api/info dir is the folder"
wait_log_lines 1
grep -q -- "--app=http://127.0.0.1:$P1/" "$BLOG"; check $? "1 browser got --app=http://127.0.0.1:$P1/"
[ -f "$F1/OWNWORDS.md" ]; check $? "1 OWNWORDS.md exists in the folder"
PID1=$(info "$P1" pid)

# 2. Second click, same folder: same server, window opened again.
OUT=$(run_launcher "$P1" "$F1"); RC=$?
check $RC "2 second run: exit 0 ($OUT)"
[ "$(info "$P1" pid)" = "$PID1" ] && [ -n "$PID1" ]; check $? "2 same server pid (no restart)"
wait_log_lines 2
[ "$(wc -l < "$BLOG" | tr -d ' ')" = 2 ]; check $? "2 browser opened twice"

# 3. Missing folder.
OUT=$(run_launcher "$P1" "$T/does not exist"); RC=$?
[ "$RC" = 2 ]; check $? "3 missing folder: exit 2 (got $RC)"

# 4. No Node new enough.
OUT=$(run_launcher "$P1" "$F1" OWNWORDS_MIN_NODE=999); RC=$?
[ "$RC" = 3 ] && echo "$OUT" | grep -q Node; check $? "4 no Node: exit 3 and a message about Node (got $RC: $OUT)"

# 5. Build smoke: copy the repo to a path with & | and a space, build the app, run it.
if [ "$(uname)" = Darwin ]; then
  R5="$T/re&po|x y"; mkdir -p "$R5"
  (cd "$REPO" && tar --exclude=.git -cf - .) | (cd "$R5" && tar -xf -)
  B5="$T/build out"; mkdir -p "$B5"
  OUT=$(sh "$R5/launcher/build.sh" "$R5" "$B5" 2>&1); RC=$?
  check $RC "5 build.sh exit 0 ($OUT)"
  APP="$B5/Open Ownwords.app"
  [ -d "$APP" ]; check $? "5 app exists"
  [ -f "$APP/Contents/Resources/applet.icns" ]; check $? "5 app has applet.icns"
  /usr/bin/codesign -v "$APP" 2>/dev/null; check $? "5 codesign -v passes"
  P5=$(freeport); PORTS="$PORTS $P5"; REAL5=$(cd "$B5" && pwd -P)
  OUT=$(env -i HOME="$TH" PATH=/usr/bin:/bin OWNWORDS_NODE="$NODE" PORT="$P5" OWNWORDS_IDLE_MS=0 OWNWORDS_BROWSER="$STUB" "$APP/Contents/MacOS/applet" 2>&1); RC=$?
  check $RC "5 app runs: exit 0 ($OUT)"
  [ "$(info "$P5" dir)" = "$REAL5" ]; check $? "5 the app serves its own folder"
  sh "$R5/launcher/build.sh" >/dev/null 2>&1; [ $? -ne 0 ]; check $? "5 build.sh without arguments fails"
else
  echo "skip 5 build smoke (macOS only)"
fi

echo
if [ "$FAILS" = 0 ]; then echo "all ok"; else echo "$FAILS FAILED"; exit 1; fi
