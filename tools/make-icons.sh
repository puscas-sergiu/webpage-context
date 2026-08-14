#!/usr/bin/env bash
# Renders the extension icons from the SVG sources in this directory.
#
#   tools/icon.svg        -> icon128.png, icon48.png   (full detail)
#   tools/icon-small.svg  -> icon32.png,  icon16.png   (simplified glyph)
#
# Requires Node 22+ and a Chrome/Chromium binary (set CHROME to override).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

render() {
    local svg="$1" size="$2" name="$3"
    {
        echo '<!doctype html><meta charset="utf-8">'
        echo "<style>html,body{margin:0;padding:0;background:transparent}"
        echo "svg{display:block;width:${size}px;height:${size}px}</style>"
        cat "$svg"
    } > "$WORK/page.html"
    node "$ROOT/tools/shot.mjs" "$WORK/page.html" "$size" "$size" "$ROOT/$name" --transparent
}

echo "Rendering icons…"
render "$ROOT/tools/icon.svg"       128 icon128.png
render "$ROOT/tools/icon.svg"        48 icon48.png
render "$ROOT/tools/icon-small.svg"  32 icon32.png
render "$ROOT/tools/icon-small.svg"  16 icon16.png
echo "Done."
