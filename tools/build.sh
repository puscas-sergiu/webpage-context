#!/usr/bin/env bash
# Packages the extension for upload to the Chrome Web Store.
#
#   bash tools/build.sh
#
# Produces dist/webpage-summarizer-chat-<version>.zip containing only the files
# the extension actually loads — no docs, tooling, store assets or git metadata.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Exactly the files referenced by manifest.json, plus the manifest itself.
FILES=(
    manifest.json
    background.js
    kb-db.js
    popup.html
    popup.js
    styles.css
    icon16.png
    icon32.png
    icon48.png
    icon128.png
)

VERSION="$(node -p "require('./manifest.json').version")"
ZIP="dist/webpage-summarizer-chat-${VERSION}.zip"

echo "Verifying source"
node tools/verify.mjs
echo
for file in popup.js background.js kb-db.js; do
    node --check "$file"
done

echo "Packaging version ${VERSION}"

# Fail loudly rather than shipping a package with a missing file.
missing=0
for file in "${FILES[@]}"; do
    [[ -f "$file" ]] || { echo "  MISSING: $file" >&2; missing=1; }
done
[[ $missing -eq 0 ]] || { echo "Aborting: files listed above are missing." >&2; exit 1; }

# Every local script/style/icon the manifest and popup reference must be packaged.
node - "${FILES[@]}" <<'NODE'
const fs = require('fs');
const packaged = new Set(process.argv.slice(2));
const referenced = new Set();

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const walk = (value) => {
    if (typeof value === 'string') {
        if (/\.(js|html|css|png|json)$/.test(value)) referenced.add(value);
    } else if (value && typeof value === 'object') {
        Object.values(value).forEach(walk);
    }
};
walk(manifest);

const html = fs.readFileSync('popup.html', 'utf8');
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (!/^https?:/.test(match[1])) referenced.add(match[1]);
}
// importScripts() in the service worker.
const sw = fs.readFileSync('background.js', 'utf8');
for (const match of sw.matchAll(/importScripts\(['"]([^'"]+)['"]\)/g)) {
    referenced.add(match[1]);
}

const missing = [...referenced].filter(file => !packaged.has(file));
if (missing.length) {
    console.error('Referenced but not packaged: ' + missing.join(', '));
    process.exit(1);
}
console.log(`  ${referenced.size} referenced files, all present`);
NODE

rm -f "$ZIP"
mkdir -p dist
zip -q -9 -X "$ZIP" "${FILES[@]}"

echo "  $ZIP  ($(du -h "$ZIP" | cut -f1))"
echo
echo "Contents:"
unzip -l "$ZIP" | tail -n +4 | head -n -2 | awk '{printf "  %-22s %8s\n", $4, $1}'
echo
echo "Upload at https://chrome.google.com/webstore/devconsole"
