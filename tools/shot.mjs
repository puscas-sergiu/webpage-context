#!/usr/bin/env node
// Pixel-exact HTML -> PNG renderer driven over the Chrome DevTools Protocol.
//
//   node tools/shot.mjs <input.html> <width> <height> <out.png> [--transparent] [--scale=N]
//
// Chrome's `--screenshot` flag sizes the *window*, not the viewport (the frame
// eats ~87px of height), which silently crops output. Setting the metrics via
// Emulation.setDeviceMetricsOverride and clipping the capture avoids that, and
// waits for fonts + two animation frames so nothing is captured mid-paint.

import { spawn } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { globSync } from 'node:fs';

const [input, widthArg, heightArg, output, ...flags] = process.argv.slice(2);
if (!input || !widthArg || !heightArg || !output) {
    console.error('usage: shot.mjs <input.html> <width> <height> <out.png> [--transparent] [--scale=N]');
    process.exit(1);
}
const width = Number(widthArg);
const height = Number(heightArg);
const transparent = flags.includes('--transparent');
const scale = Number((flags.find(f => f.startsWith('--scale=')) || '--scale=1').split('=')[1]);
const delay = Number((flags.find(f => f.startsWith('--delay=')) || '--delay=0').split('=')[1]);

function findChrome() {
    if (process.env.CHROME) return process.env.CHROME;
    const candidates = [
        ...globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome'),
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ];
    const found = candidates.find(p => p && existsSync(p));
    if (!found) throw new Error('No Chrome/Chromium found. Set CHROME=/path/to/chrome');
    return found;
}

const PORT = 9333 + (process.pid % 500);

const chrome = spawn(findChrome(), [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    `--remote-debugging-port=${PORT}`,
    'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function devtoolsUrl() {
    for (let i = 0; i < 100; i++) {
        try {
            const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
            if (res.ok) return (await res.json()).webSocketDebuggerUrl;
        } catch { /* not listening yet */ }
        await sleep(100);
    }
    throw new Error('Chrome did not expose a DevTools endpoint in time');
}

class Client {
    constructor(socket) {
        this.socket = socket;
        this.nextId = 1;
        this.pending = new Map();
        this.listeners = [];
        socket.addEventListener('message', ev => {
            const msg = JSON.parse(ev.data);
            if (msg.id && this.pending.has(msg.id)) {
                const { resolve: ok, reject } = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                msg.error ? reject(new Error(msg.error.message)) : ok(msg.result);
            } else if (msg.method) {
                for (const fn of this.listeners) fn(msg);
            }
        });
    }
    send(method, params = {}, sessionId) {
        const id = this.nextId++;
        return new Promise((ok, reject) => {
            this.pending.set(id, { resolve: ok, reject });
            this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
    }
    once(method) {
        return new Promise(ok => {
            const fn = msg => {
                if (msg.method === method) {
                    this.listeners = this.listeners.filter(l => l !== fn);
                    ok(msg.params);
                }
            };
            this.listeners.push(fn);
        });
    }
}

try {
    const wsUrl = await devtoolsUrl();
    const socket = new WebSocket(wsUrl);
    await new Promise((ok, reject) => {
        socket.addEventListener('open', ok, { once: true });
        socket.addEventListener('error', () => reject(new Error('DevTools socket failed')), { once: true });
    });

    const client = new Client(socket);
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });

    await client.send('Page.enable', {}, sessionId);
    if (flags.includes('--dark')) {
        await client.send('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-color-scheme', value: 'dark' }],
        }, sessionId);
    }
    await client.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: scale, mobile: false,
    }, sessionId);
    if (transparent) {
        await client.send('Emulation.setDefaultBackgroundColorOverride', {
            color: { r: 0, g: 0, b: 0, a: 0 },
        }, sessionId);
    }

    const loaded = client.once('Page.loadEventFired');
    await client.send('Page.navigate', { url: pathToFileURL(resolve(input)).href }, sessionId);
    await loaded;

    // Settle: fonts resolved, then two frames so the first paint is complete.
    await client.send('Runtime.evaluate', {
        expression: `document.fonts.ready.then(() => new Promise(r =>
            requestAnimationFrame(() => requestAnimationFrame(r))))`,
        awaitPromise: true,
    }, sessionId);

    if (delay) await sleep(delay);

    const { data } = await client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width, height, scale },
    }, sessionId);

    writeFileSync(output, Buffer.from(data, 'base64'));
    console.log(`  ${output} (${width * scale}x${height * scale})`);
} finally {
    chrome.kill();
}
