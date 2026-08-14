#!/usr/bin/env node
// End-to-end smoke test: loads the unpacked extension in Chrome and round-trips
// real messages through the background service worker.
//
//   node tools/smoke.mjs
//
// Unlike verify.mjs (which reads the source), this exercises the actual runtime:
// service-worker registration, importScripts, IndexedDB and chrome.storage. It
// needs no API key — nothing here touches the OpenAI endpoints.

import { spawn } from 'node:child_process';
import { existsSync, globSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 9400 + (process.pid % 300);
const PROFILE = mkdtempSync(join(tmpdir(), 'ext-smoke-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findChrome() {
    if (process.env.CHROME) return process.env.CHROME;
    const found = [
        ...globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome'),
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ].find(path => path && existsSync(path));
    if (!found) throw new Error('No Chrome/Chromium found. Set CHROME=/path/to/chrome');
    return found;
}

const chrome = spawn(findChrome(), [
    // Extensions need the full browser, not the headless shell.
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    `--load-extension=${EXTENSION}`,
    `--disable-extensions-except=${EXTENSION}`,
    'about:blank',
], { stdio: 'ignore' });

class Client {
    constructor(socket) {
        this.socket = socket;
        this.nextId = 1;
        this.pending = new Map();
        socket.addEventListener('message', event => {
            const msg = JSON.parse(event.data);
            if (!msg.id || !this.pending.has(msg.id)) return;
            const { resolve, reject } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
        });
    }
    send(method, params = {}, sessionId) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
    }
}

let failures = 0;
const check = (label, pass, detail = '') => {
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    if (!pass) failures++;
};

try {
    let version;
    for (let i = 0; i < 100 && !version; i++) {
        try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); }
        catch { await sleep(100); }
    }
    if (!version) throw new Error('Chrome did not expose a DevTools endpoint');

    let workerUrl = null;
    for (let i = 0; i < 60 && !workerUrl; i++) {
        const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        workerUrl = targets.find(t => t.type === 'service_worker' && t.url.includes('background.js'))?.url;
        if (!workerUrl) await sleep(250);
    }
    check('background service worker registers', !!workerUrl, workerUrl || 'not found');
    if (!workerUrl) throw new Error('service worker never registered');

    const extensionId = new URL(workerUrl).host;
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
    const client = new Client(socket);

    // Drive from an extension page so chrome.runtime.sendMessage reaches the
    // real onMessage router running inside the worker.
    const { targetId } = await client.send('Target.createTarget',
        { url: `chrome-extension://${extensionId}/popup.html` });
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
    await client.send('Runtime.enable', {}, sessionId);
    await sleep(1200);

    const evaluate = async (expression) => {
        const result = await client.send('Runtime.evaluate',
            { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.exception?.description || 'evaluation failed');
        }
        return result.result.value;
    };
    const message = (payload) => evaluate(`chrome.runtime.sendMessage(${JSON.stringify(payload)})`);

    const title = await evaluate("document.getElementById('page-title').textContent");
    check('popup initialises without throwing', typeof title === 'string' && title.length > 0,
        `title="${title}"`);

    let stats = await message({ type: 'getStats' });
    check('getStats reports an empty profile', stats?.chats === 0 && stats?.saved === 0,
        JSON.stringify(stats));

    await message({ type: 'saveBookmark', url: 'https://example.com/smoke' });
    await sleep(400);

    stats = await message({ type: 'getStats' });
    check('a saved page is counted', stats?.saved === 1, JSON.stringify(stats));

    const marked = await message({ type: 'isBookmarked', url: 'https://example.com/smoke' });
    check('isBookmarked finds it', marked?.bookmarked === true, JSON.stringify(marked));

    const { data } = await message({ type: 'exportData' }) ?? {};
    check('exportData returns a payload', !!data);
    check('the export includes the saved page', data?.bookmarks?.length === 1,
        `${data?.bookmarks?.length} bookmark(s)`);
    check('the export is stamped with version and time',
        !!data?.extensionVersion && !!data?.exportedAt,
        `${data?.extensionVersion} @ ${data?.exportedAt}`);
    check('the export never contains the API key',
        !JSON.stringify(data ?? {}).toLowerCase().includes('openaiapikey'));

    const deleted = await message({ type: 'deleteAllData' });
    check('deleteAllData succeeds', deleted?.ok === true, JSON.stringify(deleted));

    stats = await message({ type: 'getStats' });
    check('nothing remains afterwards', stats?.chats === 0 && stats?.saved === 0, JSON.stringify(stats));

    const remaining = await message({ type: 'getBookmarks' });
    check('the bookmark list is empty', remaining?.items?.length === 0,
        `${remaining?.items?.length} item(s)`);

    const unknown = await message({ type: 'notARealType' });
    check('an unknown message type answers instead of hanging', !!unknown?.error,
        JSON.stringify(unknown));
} catch (error) {
    console.error(`  FAIL  harness error — ${error.message}`);
    failures++;
} finally {
    chrome.kill();
    // Chrome keeps flushing profile writes after SIGTERM; deleting immediately
    // races those writes and throws ENOTEMPTY.
    await new Promise(resolve => {
        chrome.once('exit', resolve);
        setTimeout(resolve, 3000);
    });
    try {
        rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
        console.log(`  note  left a temp profile behind at ${PROFILE}`);
    }
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll smoke checks passed.');
process.exit(failures ? 1 : 0);
