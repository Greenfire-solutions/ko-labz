#!/bin/bash
#
#  Builds the Ko-Labz download: a folder a crew leader unzips and
#  double-clicks, with Node.js and the page's parts inside, so nothing has
#  to be installed and npm never runs on their Mac.
#
#    scripts/package.sh            both Macs (Intel and Apple Silicon)
#    scripts/package.sh arm64      one of them (x64 for Intel)
#
#  Output, in dist/:
#    Ko-Labz (Intel Mac).zip
#    Ko-Labz (Apple Silicon).zip
#    install.sh      the one-line installer (curl -fsSL <base>/install.sh | bash)
#    SHA256SUMS      what install.sh checks the zips against
#
#  Only the files a crew needs ship (an allow list): never a data folder,
#  tests, the prototype, git history or this Mac's logs. Each crew's hub
#  lives in its own ~/Ko-Labz Data.
#
#  node_modules is made fresh from package-lock.json (npm ci, here on the
#  build Mac only) and trimmed to what the server serves. It has no native
#  code, so the same copy goes into both zips; the script refuses if that
#  ever changes.
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
VER="$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1)"
NODE_VERSION="$(sed -n 's/^NODE_VERSION="\(.*\)"/\1/p' "$ROOT/scripts/setup.sh")"
OUT="$ROOT/dist"; mkdir -p "$OUT"
CACHE="$HOME/Library/Caches/kolabz-package"; mkdir -p "$CACHE"
ARCHES=("${1:-x64}"); [ $# -eq 0 ] && ARCHES=(x64 arm64)
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
NAME="Ko-Labz"

# Node for each Mac, checked against the sums nodejs.org publishes.
SUMS="$CACHE/SHASUMS256-$NODE_VERSION.txt"
[ -f "$SUMS" ] || /usr/bin/curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$SUMS"

# The page's parts, exactly as the lockfile pins them (integrity-checked by npm).
echo "== node_modules from package-lock.json"
mkdir -p "$WORK/deps"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$WORK/deps/"
( cd "$WORK/deps" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error >/dev/null )
NATIVE="$(find "$WORK/deps/node_modules" \( -name '*.node' -o -name 'binding.gyp' -o -name '*.dylib' -o -name '*.so' \) -print)"
[ -z "$NATIVE" ] || { echo "Refusing: node_modules has native code, so one copy cannot serve both Macs:" >&2; echo "$NATIVE" >&2; exit 1; }
# Keep only what server.mjs serves (three's build and examples/jsm, the font files) plus each licence.
NM="$WORK/node_modules"; mkdir -p "$NM/@fontsource"
/usr/bin/rsync -a --include 'package.json' --include 'LICENSE' --include 'build/***' \
  --include 'examples/' --include 'examples/jsm/***' --exclude '*' "$WORK/deps/node_modules/three/" "$NM/three/"
for f in orbitron rajdhani jetbrains-mono; do
  /usr/bin/rsync -a --include 'package.json' --include 'LICENSE' --include 'files/***' --exclude '*' \
    "$WORK/deps/node_modules/@fontsource/$f/" "$NM/@fontsource/$f/"
done

# What ships. Tests, docs, tools, dist, data and the prototype stay here.
SHIP=("READ ME FIRST.txt" README.md package.json package-lock.json server.mjs public shared
      scripts/setup.sh scripts/start-kolabz.sh "Start Ko-Labz.app" "Start Ko-Labz.command" "Start Ko-Labz on Wi-Fi.command")
JUNK=(--exclude '.DS_Store' --exclude '*.log' --exclude '.env*' --exclude 'node_modules')

rm -f "$OUT/SHA256SUMS" "$OUT/install.sh"
for ARCH in "${ARCHES[@]}"; do
  case "$ARCH" in x64) LABEL="Intel Mac";; arm64) LABEL="Apple Silicon";; *) echo "unknown arch $ARCH" >&2; exit 2;; esac
  echo "== $LABEL ($ARCH)"
  DEST="$WORK/$ARCH/$NAME"; mkdir -p "$DEST"
  for item in "${SHIP[@]}"; do
    [ -e "$ROOT/$item" ] || { echo "Missing from the app folder: $item" >&2; exit 1; }
    /usr/bin/rsync -aR "${JUNK[@]}" "$ROOT/./$item" "$DEST/"
  done
  /usr/bin/rsync -a "$NM/" "$DEST/node_modules/"
  # Nothing private or test-only may ride along. (find output is captured, never piped into grep -q under pipefail.)
  BAD="$(find "$DEST" \( -name 'hub.json' -o -name 'hub-*.json' -o -name '.env*' -o -name '*.log' -o -name '.git' -o -name data -o -name test -o -name logs -o -name original -o -name backups \) -print)"
  [ -z "$BAD" ] || { echo "Refusing: private or test files are in the package:" >&2; echo "$BAD" >&2; exit 1; }
  # No path from the Mac it was built on.
  LEAK="$(grep -rlF "$HOME/" "$DEST" 2>/dev/null || true)"
  [ -z "$LEAK" ] || { echo "Refusing: these files name a folder on this Mac:" >&2; echo "$LEAK" >&2; exit 1; }

  TGZ="node-$NODE_VERSION-darwin-$ARCH.tar.gz"
  [ -f "$CACHE/$TGZ" ] || /usr/bin/curl -fsSL --retry 3 "https://nodejs.org/dist/$NODE_VERSION/$TGZ" -o "$CACHE/$TGZ"
  ( cd "$CACHE" && grep " $TGZ\$" "$SUMS" | /usr/bin/shasum -a 256 -c - >/dev/null ) \
    || { rm -f "$CACHE/$TGZ"; echo "Node download failed its checksum" >&2; exit 1; }
  # Same pin as setup.sh, so the zip and a first-start download are the same Node.
  SUM_WANT="$(sed -n "s/^NODE_SHA_$ARCH=\"\(.*\)\"/\1/p" "$ROOT/scripts/setup.sh")"
  [ "$(/usr/bin/shasum -a 256 "$CACHE/$TGZ" | cut -d' ' -f1)" = "$SUM_WANT" ] \
    || { echo "Node $ARCH does not match the pin in setup.sh" >&2; exit 1; }
  mkdir -p "$DEST/runtime/node"
  # Only the binary: the tarball's headers, docs and npm are 100 MB nobody needs.
  /usr/bin/tar -xzf "$CACHE/$TGZ" -C "$DEST/runtime/node" --strip-components 1 "node-$NODE_VERSION-darwin-$ARCH/bin/node" "node-$NODE_VERSION-darwin-$ARCH/LICENSE"
  echo "$ARCH" > "$DEST/runtime/ARCH"
  # Not "runtime/NODE": macOS folders are case-insensitive and that collides with runtime/node.
  echo "node $NODE_VERSION" > "$DEST/runtime/VERSIONS"
  echo "ko-labz $VER" >> "$DEST/runtime/VERSIONS"

  chmod +x "$DEST/Start Ko-Labz.command" "$DEST/Start Ko-Labz on Wi-Fi.command" "$DEST/scripts/"*.sh "$DEST/Start Ko-Labz.app/Contents/MacOS/"*
  # The icon's seal must survive the copy (git does not keep it): verify it, re-seal if needed.
  /usr/bin/codesign --verify --strict "$DEST/Start Ko-Labz.app" 2>/dev/null \
    || { /usr/bin/xattr -cr "$DEST/Start Ko-Labz.app"; /usr/bin/codesign --force --deep --sign - "$DEST/Start Ko-Labz.app"; }

  ZIP="$OUT/$NAME ($LABEL).zip"; rm -f "$ZIP"
  ( cd "$WORK/$ARCH" && /usr/bin/ditto -c -k --sequesterRsrc --keepParent "$NAME" "$ZIP" )
  echo "   $(du -h "$ZIP" | cut -f1)  $ZIP"
done

cp "$ROOT/scripts/install.sh" "$OUT/install.sh"
( cd "$OUT" && /usr/bin/shasum -a 256 "$NAME ("*").zip" > SHA256SUMS )
echo "   $OUT/SHA256SUMS"
echo "   $OUT/install.sh   (set the download address at its top, or KOLABZ_BASE, before hosting it)"
echo "   version $VER, Node $NODE_VERSION"
