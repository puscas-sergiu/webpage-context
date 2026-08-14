// Loads background.js into a jsdom-backed sandbox so the functions that are
// normally injected into a page can be exercised outside Chrome.
//
// The extraction code is deliberately self-contained (chrome.scripting requires
// it), which makes it straightforward to run against saved YouTube markup —
// see fixtures/. When YouTube changes its transcript panel again, drop the new
// markup in there and the suite will tell you which selectors still hold.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

const DEFAULT_HTML = '<!doctype html><html><body></body></html>';
const DEFAULT_URL = 'https://www.youtube.com/watch?v=abc12345678';

function loadBackground({ html = DEFAULT_HTML, url = DEFAULT_URL, globals = {} } = {}) {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    const sandbox = dom.getInternalVMContext();

    // Minimal service-worker environment: enough for background.js to evaluate.
    Object.assign(sandbox, {
        importScripts: () => {},
        console,
        setTimeout, clearTimeout, setInterval, clearInterval,
        chrome: {
            runtime: {
                onMessage: { addListener() {} },
                onInstalled: { addListener() {} },
                sendMessage: async () => {},
                getManifest: () => ({ version: 'test' })
            },
            storage: {
                sync: { get: async () => ({}) },
                local: { get: async () => ({}), set: async () => {}, remove: async () => {} }
            },
            scripting: { executeScript: async () => [{ result: null }] },
            tabs: { query: async () => [] }
        },
        fetch: async () => { throw new Error('fetch was not stubbed for this test'); }
    });
    Object.assign(sandbox, globals);

    vm.runInContext(SRC, sandbox);
    return { sandbox, dom };
}

function readFixture(name) {
    return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

// Tiny assertion runner — no framework, so `npm test` needs only jsdom.
function createRunner() {
    const state = { passed: 0, failed: 0 };
    const test = async (name, fn) => {
        try {
            await fn();
            state.passed++;
            console.log('  ok   ' + name);
        } catch (error) {
            state.failed++;
            console.log('  FAIL ' + name + '\n       ' + error.message);
        }
    };
    const done = () => {
        console.log(`\n${state.passed} passed, ${state.failed} failed`);
        process.exit(state.failed ? 1 : 0);
    };
    return { test, done };
}

module.exports = { loadBackground, readFixture, createRunner };
