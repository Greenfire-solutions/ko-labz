#!/bin/bash
# Ko-Labz, one-line install:
#
#   curl -fsSL <base>/install.sh | bash
#
# Why a line and not a zip from the browser: a file a browser downloads is
# marked "from the internet", and macOS then refuses an unsigned app until
# the person digs through Privacy and Security. A file curl downloads carries
# no such mark, so this shows no warning and needs no Apple developer account.
#
# It installs to ~/Applications/Ko-Labz (no administrator password), checks
# the download against its published checksum, and never touches the crew's
# own hub in ~/Ko-Labz Data.
set -euo pipefail
BASE="${KOLABZ_BASE:-__BASE__}"
NAME="Ko-Labz"
DEST="$HOME/Applications/$NAME"
DATA="$HOME/Ko-Labz Data"
PORT="$(printf '%s' "${KOLABZ_PORT:-8350}" | tr -cd '0-9')"; [ -n "$PORT" ] || PORT=8350

case "$(uname -s):$(uname -m)" in
  Darwin:arm64)  ZIP="$NAME (Apple Silicon).zip" ;;
  Darwin:x86_64) ZIP="$NAME (Intel Mac).zip" ;;
  *) echo "Ko-Labz runs on a Mac only." >&2; exit 1 ;;
esac
case "$BASE" in __BASE__|'') echo "This installer has no download address yet (KOLABZ_BASE)." >&2; exit 1 ;; esac
ENC="$(printf '%s' "$ZIP" | sed 's/ /%20/g; s/(/%28/g; s/)/%29/g')"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
echo "Downloading $ZIP..."
curl -fL --progress-bar "$BASE/$ENC" -o "$WORK/kolabz.zip"
curl -fsSL "$BASE/SHA256SUMS" -o "$WORK/SHA256SUMS"
WANT="$(grep -F "  $ZIP" "$WORK/SHA256SUMS" | cut -d' ' -f1 || true)"
HAVE="$(shasum -a 256 "$WORK/kolabz.zip" | cut -d' ' -f1)"
[ -n "$WANT" ] && [ "$WANT" = "$HAVE" ] || { echo "The download did not match its checksum. Nothing was installed. Try again." >&2; exit 1; }

ditto -x -k "$WORK/kolabz.zip" "$WORK/x"
[ -d "$WORK/x/$NAME" ] && [ -f "$WORK/x/$NAME/server.mjs" ] || { echo "The download did not contain Ko-Labz." >&2; exit 1; }

# A running copy that is this install, or that serves this crew's hub, is
# stopped so its files are not replaced under it. A copy that keeps its hub
# somewhere else (a developer's own) is left alone; the launcher says so.
J="$(curl -s --max-time 2 "http://127.0.0.1:$PORT/api/whoami" || true)"
case "$J" in
  *'"app":"ko-labz"'*)
    PID="$(printf '%s' "$J" | sed -n 's/.*"pid":\([0-9]*\).*/\1/p')"
    R="$(printf '%s' "$J" | sed -n 's/.*"root":"\([^"]*\)".*/\1/p')"
    D="$(printf '%s' "$J" | sed -n 's/.*"data":"\([^"]*\)".*/\1/p')"
    REALDEST="$( [ -d "$DEST" ] && cd "$DEST" && pwd -P || echo "$DEST")"
    if [ -n "$PID" ] && { [ "$R" = "$REALDEST" ] || [ "$D" = "$DATA" ]; }; then
      echo "Stopping the Ko-Labz that is running now..."
      kill "$PID" 2>/dev/null || true
      for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
    fi
    ;;
esac

mkdir -p "$HOME/Applications"
rm -rf "$DEST.old"; [ -d "$DEST" ] && mv "$DEST" "$DEST.old"
mv "$WORK/x/$NAME" "$DEST"
rm -rf "$DEST.old"

echo
echo "Ko-Labz is installed in $DEST"
echo "Your crew's hub stays in $DATA"
echo "Starting it now. Next time, double-click Start Ko-Labz in that folder."
echo
exec /bin/bash "$DEST/scripts/start-kolabz.sh"
