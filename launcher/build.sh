#!/bin/sh
# Usage: build.sh <repo> <folder to put "Open Ownwords.app" in>
# Builds the launcher app on this Mac. Never ship the built app: build it where it will run.
if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: build.sh <repo> <folder to put \"Open Ownwords.app\" in>" >&2
  exit 2
fi
set -e
HERE=$(cd "$(dirname "$0")" && pwd -P)
REPO=$(cd "$1" && pwd -P)
OUT=$(cd "$2" && pwd -P)
# AppleScript string escapes (\ and "), then sed replacement escapes (& | \).
AS=$(printf '%s' "$REPO" | sed 's/\\/\\\\/g; s/"/\\"/g')
ESC=$(printf '%s' "$AS" | sed 's/[&|\\]/\\&/g')
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
sed "s|@REPO_PATH@|$ESC|" "$HERE/Open-Ownwords.applescript" > "$TMP/Open Ownwords.applescript"
APP="$OUT/Open Ownwords.app"
rm -rf "$APP"
/usr/bin/osacompile -o "$APP" "$TMP/Open Ownwords.applescript"
ICNS="$HERE/Ownwords.icns"
if [ -f "$ICNS" ]; then
  cp "$ICNS" "$APP/Contents/Resources/applet.icns"
  rm -f "$APP/Contents/Resources/Assets.car"
  /usr/bin/plutil -remove CFBundleIconName "$APP/Contents/Info.plist" 2>/dev/null || true
  /usr/bin/codesign --force --deep -s - "$APP" >/dev/null 2>&1 || true
  touch "$APP"
fi
echo "Built $APP"
