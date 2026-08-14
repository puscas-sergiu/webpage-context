#!/usr/bin/env node
// Pre-submission checks for the extension source.
//
//   node tools/verify.mjs
//
// Catches the wiring mistakes that a syntax check misses and that only show up
// once the extension is loaded: a getElementById with no matching element, a
// message the background never handles, a manifest pointing at a missing file.
// Run automatically by tools/build.sh before packaging.

import { readFileSync, existsSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const exists = path => existsSync(new URL(`../${path}`, import.meta.url));

const popupJs = read('popup.js');
const popupHtml = read('popup.html');
const background = read('background.js');
const kbDb = read('kb-db.js');
const mock = read('tools/preview/mock.js');
const manifest = JSON.parse(read('manifest.json'));

// Comments would otherwise trip the "no blocking dialogs" check, which
// deliberately looks for bare identifiers.
const stripComments = source => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const matches = (source, re) => [...source.matchAll(re)].map(m => m[1]);

const results = [];
const check = (label, offenders) => results.push({ label, offenders });

// --- DOM wiring -------------------------------------------------------------

const htmlIds = new Set(matches(popupHtml, /id="([^"]+)"/g));
check('popup.js element ids exist in popup.html',
    matches(popupJs, /getElementById\('([^']+)'\)/g).filter(id => !htmlIds.has(id)));

// --- Message contract -------------------------------------------------------

// Broadcast from background to popup rather than requested by the popup.
const INBOUND = new Set(['genStart', 'genStatus', 'genDelta', 'genDone', 'genError',
    'kbEnrichStart', 'kbEnrichDone']);
const handled = new Set(matches(background, /case '([a-zA-Z]+)':/g));
check('every message the popup sends is handled by the background',
    matches(popupJs, /type:\s*'([a-zA-Z]+)'/g)
        .filter(type => !handled.has(type) && !INBOUND.has(type)));

// --- Service worker dependencies -------------------------------------------

const kbDefined = new Set(matches(kbDb, /(?:async )?function (kb[A-Za-z]+)/g));
check('kb* helpers called by the background are defined in kb-db.js',
    [...new Set(matches(background, /\b(kb[A-Z][A-Za-z]*)\(/g))]
        .filter(fn => !kbDefined.has(fn)));

// --- Preview harness --------------------------------------------------------

// Browser globals the mock legitimately calls through `window.`.
const BROWSER_GLOBALS = new Set(['addEventListener', 'removeEventListener',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'fetch']);
const popupFunctions = new Set(matches(popupJs, /^(?:async )?function (\w+)/gm));
check('preview mock entry points exist in popup.js',
    [...new Set(matches(mock, /window\.(\w+)\(/g))]
        .filter(fn => !popupFunctions.has(fn) && !BROWSER_GLOBALS.has(fn)));

// --- Manifest ---------------------------------------------------------------

const referenced = new Set();
(function walk(value) {
    if (typeof value === 'string') {
        if (/\.(js|html|css|png)$/.test(value)) referenced.add(value);
    } else if (value && typeof value === 'object') {
        Object.values(value).forEach(walk);
    }
}(manifest));
check('files referenced by the manifest are present',
    [...referenced].filter(file => !exists(file)));

check('store description is within the 132-character limit',
    manifest.description.length > 132 ? [`${manifest.description.length} chars`] : []);

check('store name is within the 45-character limit',
    manifest.name.length > 45 ? [`${manifest.name.length} chars`] : []);

check('OpenAI host permission matches API paths, not just the root',
    (manifest.host_permissions || []).filter(pattern => /openai\.com\/$/.test(pattern)));

// --- Code smells ------------------------------------------------------------

const code = stripComments(popupJs) + stripComments(background);
check('no blocking dialogs or leftover debugger statements', [
    /(?<![.\w])confirm\(/.test(code) && 'confirm()',
    /(?<![.\w])alert\(/.test(code) && 'alert()',
    /\bdebugger\b/.test(code) && 'debugger',
].filter(Boolean));

// --- Report -----------------------------------------------------------------

let failed = 0;
for (const { label, offenders } of results) {
    if (offenders.length) {
        failed++;
        console.error(`  FAIL  ${label}\n          ${offenders.join(', ')}`);
    } else {
        console.log(`  ok    ${label}`);
    }
}

if (failed) {
    console.error(`\n${failed} check(s) failed.`);
    process.exit(1);
}
console.log(`\nAll ${results.length} checks passed.`);
