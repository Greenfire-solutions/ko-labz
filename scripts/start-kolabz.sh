#!/bin/bash
#
#  THE KO-LABZ LAUNCH LOGIC. Safe to edit: it lives outside the app bundle,
#  so changing it never breaks the icon's signature.
#
#  Runs one of two ways, and behaves the same in both:
#    - directly from "Start Ko-Labz.app", when macOS lets the bundle read here
#    - inside a Terminal window (--via-terminal), from the .command files, or
#      when macOS privacy blocks the bundle from a protected folder (Desktop,
#      Downloads, Documents). Terminal already holds that permission, or asks once.
#
#    --wifi   listen on the whole network so phones on the same Wi-Fi can join.
#             A Ko-Labz already running for this computer only is restarted that way.
#
#  Logs live in ~/Library/Logs/Ko-Labz, NOT in the app folder: a blocked
#  launcher can neither write nor read back a log under ~/Desktop.
#
#  For tests and rehearsals:
#    KOLABZ_LAUNCH_QUIET=1   no browser, dialog, notification or window closing;
#                            a failure is printed and the exit code is 1
#    KOLABZ_PORT=8351        use another port (default 8350)
#
#  npm is never run here. A download carries its node_modules; a copy without
#  them is a source copy and says so.
#
set -u

VIA_TERMINAL=0; WIFI=0
for a in "$@"; do
  case "$a" in
    --via-terminal) VIA_TERMINAL=1 ;;
    --wifi) WIFI=1 ;;
  esac
done
QUIET="${KOLABZ_LAUNCH_QUIET:-0}"

# The physical path (pwd -P): the server reports its folder with symlinks
# resolved, and the launcher must see the same string to know it is ours.
# (A folder reached through a symlink, like /tmp, made every start "time out"
# in a sibling app.)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
LOGDIR="$HOME/Library/Logs/Ko-Labz"
LOG="$LOGDIR/launcher.log"
SRVLOG="$LOGDIR/server.log"
PORT="$(printf '%s' "${KOLABZ_PORT:-8350}" | tr -cd '0-9')"; [ -n "$PORT" ] || PORT=8350
URL="http://127.0.0.1:$PORT"
APP_ID="ko-labz"
DEFAULT_DATA="$HOME/Ko-Labz Data"
HOST=127.0.0.1; [ "$WIFI" = 1 ] && HOST=0.0.0.0

mkdir -p "$LOGDIR" 2>/dev/null
say() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG" 2>/dev/null; }

# When borrowed, the Terminal window is only a means to an end: close it on the
# way out. The closer is detached (setsid) so Terminal closes without asking.
# The Wi-Fi start keeps its window: it shows the addresses phones type in.
MYTTY="$(tty 2>/dev/null || true)"
close_window() {
  [ "$QUIET" = 1 ] && return 0
  [ "$VIA_TERMINAL" = 1 ] || return 0
  [ "$WIFI" = 1 ] && return 0
  case "$MYTTY" in /dev/tty*) ;; *) return 0 ;; esac
  /usr/bin/perl -MPOSIX -e 'fork and exit; POSIX::setsid(); exec @ARGV' /bin/bash -c "
    sleep 1.5
    /usr/bin/osascript >/dev/null 2>&1 <<OSA
      tell application \"Terminal\"
        repeat with w in windows
          try
            if tty of selected tab of w is \"$MYTTY\" then
              close w saving no
              exit repeat
            end if
          end try
        end repeat
      end tell
OSA
  " >/dev/null 2>&1
}

die() {
  say "FAILED: $1"
  [ "$VIA_TERMINAL" = 1 ] && [ "$QUIET" != 1 ] && printf '\n%b\n' "$1"
  close_window
  [ "$QUIET" = 1 ] && { printf '%b\n' "$1" >&2; exit 1; }
  /usr/bin/osascript -e 'activate' -e "display dialog \"$1\" with title \"Ko-Labz\" buttons {\"OK\"} default button 1 with icon caution" >/dev/null 2>&1
  exit 1
}
note() { [ "$QUIET" = 1 ] && return 0; /usr/bin/osascript -e "display notification \"$1\" with title \"Ko-Labz\"" >/dev/null 2>&1; }

say "--- launch --- (via_terminal=$VIA_TERMINAL wifi=$WIFI quiet=$QUIET port=$PORT) root: $ROOT"
[ -f "$ROOT/server.mjs" ] || die "Can't find Ko-Labz.\n\nExpected: $ROOT/server.mjs"

cd "$ROOT" || die "Can't enter $ROOT"
# A folder a browser downloaded is marked "from the internet"; once the person
# has opened the launcher, the mark on the rest of the folder only causes
# refusals (the bundled node, the .command backups), so clear it.
/usr/bin/xattr -rd com.apple.quarantine "$ROOT" 2>/dev/null || true
/bin/cat "$ROOT/package.json" >/dev/null 2>&1 || die "macOS privacy is blocking this launcher from reading the Ko-Labz folder.\n\nThe easy fix: move the Ko-Labz folder into Applications, then start it again.\n\nOr, once: System Settings (System Preferences on older Macs) > Privacy & Security > Full Disk Access > add Terminal."

# The page's 3D library and fonts ship inside the download. Never fetch them here.
[ -f "$ROOT/node_modules/three/build/three.module.js" ] && [ -d "$ROOT/node_modules/@fontsource/orbitron/files" ] \
  || die "This Ko-Labz folder is missing its parts (the node_modules folder).\n\nDownload the ready-made Ko-Labz for your Mac and use that folder. (Working from the source code? Run npm install once.)"

# Finder gives a bare PATH, so scripts/setup.sh hunts for a Node 20 or newer:
# the one shipped inside ./runtime first (a download of Ko-Labz carries it),
# then the usual places. Nothing found and online: setup fetches the pinned
# version into ./runtime, checked against its published checksum, and the
# person is told why the first start takes a minute.
SETUP="$ROOT/scripts/setup.sh"
[ -f "$SETUP" ] || die "Can't find scripts/setup.sh next to Ko-Labz.\n\nKeep the whole Ko-Labz folder together."
if ! NODE="$(/bin/bash "$SETUP" --check 2>>"$LOG")"; then
  note "First start: getting Node.js (about a minute)."
  [ "$VIA_TERMINAL" = 1 ] && [ "$QUIET" != 1 ] && echo "First start: getting Node.js (about a minute)..."
  NODE="$(/bin/bash "$SETUP" 2>>"$LOG")" || die "Ko-Labz needs Node.js and could not get it.\n\nConnect to the internet and start it again, or install Node.js 20 or newer from nodejs.org.\n\nDetails: ~/Library/Logs/Ko-Labz/launcher.log"
fi
[ -x "$NODE" ] || die "Ko-Labz needs Node.js 20 or newer.\n\nInstall it from nodejs.org, then start it again."
export PATH="$(dirname "$NODE"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
say "node: $NODE ($("$NODE" -v 2>/dev/null))"

# One click at a time: a second click while this one works waits for it, then just opens the page.
LOCK="$LOGDIR/launch.lock"
for _ in $(seq 1 120); do
  /bin/mkdir "$LOCK" 2>/dev/null && break
  # A lock older than three minutes belongs to a launcher that died.
  [ -n "$(/usr/bin/find "$LOCK" -maxdepth 0 -mmin +3 2>/dev/null)" ] && /bin/rmdir "$LOCK" 2>/dev/null && continue
  sleep 0.5
done
trap '/bin/rmdir "$LOCK" 2>/dev/null' EXIT

# Liveness is not identity. Ask whatever is on the port who it is and where it
# runs from. Each answer is captured in a variable, never piped into grep -q:
# under pipefail an early-quitting grep fails the pipe at random.
whoami_json() { /usr/bin/curl -s --max-time 3 "$URL/api/whoami" 2>/dev/null; }
field() { printf '%s' "$1" | /usr/bin/sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p"; }
pid_of() { printf '%s' "$1" | /usr/bin/sed -n 's/.*"pid":\([0-9]*\).*/\1/p'; }
is_app() { case "$1" in *"\"app\":\"$APP_ID\""*) return 0 ;; esac; return 1; }
is_ours() { local j; j="$(whoami_json)"; is_app "$j" && [ "$(field "$j" root)" = "$ROOT" ]; }
port_busy() { /usr/sbin/lsof -ti tcp:$PORT -sTCP:LISTEN >/dev/null 2>&1; }
stop_pid() { kill "$1" 2>/dev/null; for _ in $(seq 1 16); do kill -0 "$1" 2>/dev/null || break; sleep 0.25; done; kill -0 "$1" 2>/dev/null && kill -9 "$1" 2>/dev/null; for _ in $(seq 1 12); do port_busy || return 0; sleep 0.25; done; return 0; }

# Pages are read live; the server code is not. Restart a server that started
# before the newest server-side file was saved.
stale_pid() {
  local raw started newest
  raw=$(/bin/ps -o lstart= -p "$1" 2>/dev/null); [ -n "$raw" ] || return 1
  started=$(/bin/date -j -f "%a %b %e %T %Y" "$raw" +%s 2>/dev/null | head -1)
  case "$started" in ''|*[!0-9]*) return 1 ;; esac
  newest=$(/usr/bin/find "$ROOT/server.mjs" "$ROOT/shared" "$ROOT/package.json" -type f -exec /usr/bin/stat -f %m {} + 2>/dev/null | sort -rn | head -1)
  case "$newest" in ''|*[!0-9]*) return 1 ;; esac
  [ "$newest" -gt "$started" ]
}

# Show the page. "open URL" can fail with error -600 when the default browser
# was started by running its binary directly: macOS then has no registered
# process to hand the link to, and the click looks like it did nothing. So
# check the exit code and fall back: the running Chrome itself (its own
# single-instance handoff opens a tab), then Safari, then say so with the address.
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
open_page() {
  [ "$QUIET" = 1 ] && { say "quiet: not opening $URL"; return 0; }
  # ~/.local/bin/open-page exists only on the Mac this was built on.
  if [ -x "$HOME/.local/bin/open-page" ]; then "$HOME/.local/bin/open-page" "$URL" 2>>"$LOG" && return 0; fi
  /usr/bin/open "$URL" 2>>"$LOG" && return 0
  say "open failed (browser not registered with macOS), trying fallbacks"
  if [ -x "$CHROME_BIN" ] && /usr/bin/pgrep -x "Google Chrome" >/dev/null; then
    nohup "$CHROME_BIN" "$URL" >/dev/null 2>&1 &
    sleep 1
    say "handed the page to the running Chrome"; return 0
  fi
  /usr/bin/open -a Safari "$URL" 2>>"$LOG" && { say "opened in Safari"; return 0; }
  die "Ko-Labz is running, but your browser would not open it.\n\nQuit your browser (Command Q), open it again, then go to:\n$URL"
}
lan_addresses() { /sbin/ifconfig 2>/dev/null | /usr/bin/awk '/inet / && $2 != "127.0.0.1" {print $2}'; }
wifi_report() {
  [ "$WIFI" = 1 ] || return 0
  local ips; ips="$(lan_addresses)"
  say "wifi: $(printf '%s' "$ips" | tr '\n' ' ')"
  printf '\nKo-Labz is open to this Wi-Fi. Crew on the same Wi-Fi can join at:\n'
  if [ -n "$ips" ]; then for ip in $ips; do printf '   http://%s:%s\n' "$ip" "$PORT"; done
  else printf '   (no Wi-Fi address found: is this Mac on a network?)\n'; fi
  printf '\n(The same addresses are listed in Ko-Labz under Systems.)\n'
  printf 'Anyone on this network can play and edit. Use a network you trust.\n'
  printf 'If your Mac asks whether "node" may accept incoming connections, click Allow.\n'
  [ "$QUIET" = 1 ] || printf 'You can close this window; Ko-Labz keeps running.\n'
}
finish() { say "up on $PORT ($HOST), opening"; note "Ko-Labz is ready."; wifi_report; open_page; close_window; exit 0; }

# 1. Something already answers on the port.
J="$(whoami_json)"
if is_app "$J"; then
  PID="$(pid_of "$J")"; R="$(field "$J" root)"; D="$(field "$J" data)"; H="$(field "$J" host)"
  if [ "$R" = "$ROOT" ]; then
    if stale_pid "$PID"; then say "running server predates the code, restarting it"; stop_pid "$PID"
    elif [ "$WIFI" = 1 ] && [ "$H" != "0.0.0.0" ]; then say "running for this computer only, restarting it for Wi-Fi"; stop_pid "$PID"
    else say "already running, opening"; finish; fi
  elif [ "$D" = "$DEFAULT_DATA" ]; then
    # An older copy from another folder serving the same hub (an earlier
    # download, say): stop it, so one server owns the hub.
    say "stopping a Ko-Labz from another folder ($R) that serves the same hub"; stop_pid "$PID"
  else
    die "Another copy of Ko-Labz is already running on port $PORT, from a different folder:\n$R\n\nQuit that one first, then start this one again."
  fi
elif port_busy || [ -n "$J" ]; then
  die "Port $PORT is being used by a different program, so Ko-Labz was not started.\n\nQuit that program, then start Ko-Labz again."
fi

# 2. Start it.
say "starting server on $PORT ($HOST)"
KOLABZ_PORT="$PORT" KOLABZ_HOST="$HOST" nohup "$NODE" "$ROOT/server.mjs" >> "$SRVLOG" 2>&1 &
SPID=$!
disown $SPID 2>/dev/null

for _ in $(seq 1 60); do
  is_ours && finish
  kill -0 $SPID 2>/dev/null || break
  sleep 0.5
done
if kill -0 $SPID 2>/dev/null; then say "server did not answer in 30 s, stopping it"; stop_pid $SPID; fi
TAIL=$(/usr/bin/tail -4 "$SRVLOG" 2>/dev/null | /usr/bin/tr '"\\' "'/" | /usr/bin/cut -c1-160)
die "Ko-Labz did not start.\n\nLast lines of the log:\n$TAIL\n\nFull log: ~/Library/Logs/Ko-Labz/server.log"
