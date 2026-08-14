#!/usr/bin/env node
// Builds every image the Chrome Web Store listing needs:
//
//   store/screenshots/*.png   1280x800 marketing screenshots
//   store/promo-small.png       440x280 small promo tile
//   store/promo-marquee.png    1440x560 marquee promo tile
//   store/raw/*.png             the bare 400x600 popup, unframed
//
// The popup screenshots are real renders: popup.html runs its actual code
// against tools/preview/mock.js, so nothing here is a hand-drawn mockup.
//
//   node tools/make-store-assets.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = join(ROOT, '.store-build');
const OUT = join(ROOT, 'store');
const SHOT = join(ROOT, 'tools', 'shot.mjs');

const POPUP_W = 400;
const POPUP_H = 600;

const SCENES = [
    {
        id: 'chat',
        file: '01-chat.png',
        eyebrow: 'Summarize',
        title: 'Understand any\npage in one click',
        body: 'Get a structured summary of an article, doc or paper — then keep asking follow-up questions in the same thread.'
    },
    {
        id: 'kb',
        file: '02-knowledge-base.png',
        eyebrow: 'Knowledge base',
        title: 'Save pages you\nwant to keep',
        body: 'Bookmark a page and it is indexed automatically with an AI title, summary and topic tags — ready to search later.'
    },
    {
        id: 'ask',
        file: '03-ask.png',
        eyebrow: 'Ask everything',
        title: 'Ask your whole\nlibrary at once',
        body: 'Ask across every page you have saved and get one answer with citations back to the exact sources.'
    },
    {
        id: 'history',
        file: '04-history.png',
        eyebrow: 'History',
        title: 'Every chat,\nkept per page',
        body: 'Conversations are saved locally and grouped by day, so you can pick up exactly where you left off.'
    },
    {
        id: 'settings',
        file: '05-privacy.png',
        eyebrow: 'Private by design',
        title: 'Your key.\nYour data.\nYour machine.',
        body: 'Chats and saved pages never leave your browser profile. Export or erase everything at any time.'
    }
];

const shot = (html, w, h, out, ...flags) =>
    execFileSync('node', [SHOT, html, String(w), String(h), out, ...flags], { stdio: 'inherit' });

// ---------- 1. Render the popup for each scene ----------

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
mkdirSync(join(OUT, 'screenshots'), { recursive: true });
mkdirSync(join(OUT, 'raw'), { recursive: true });

for (const asset of ['popup.html', 'popup.js', 'styles.css']) {
    cpSync(join(ROOT, asset), join(WORK, asset));
}
cpSync(join(ROOT, 'tools', 'preview', 'mock.js'), join(WORK, 'mock.js'));
for (const icon of ['icon16.png', 'icon32.png', 'icon48.png', 'icon128.png']) {
    cpSync(join(ROOT, icon), join(WORK, icon));
}

const popupHtml = readFileSync(join(WORK, 'popup.html'), 'utf8');

for (const scene of SCENES) {
    // Inject the mock before popup.js, and pin the UI font: headless Linux
    // resolves system-ui to DejaVu Sans, which is not what users actually see.
    const html = popupHtml.replace(
        '<script src="popup.js"></script>',
        `<style>body{font-family:'Liberation Sans',Arial,sans-serif}</style>
    <script>window.__SCENE=${JSON.stringify(scene.id)};</script>
    <script src="mock.js"></script>
    <script src="popup.js"></script>`
    );
    const page = join(WORK, `scene-${scene.id}.html`);
    writeFileSync(page, html);
    shot(page, POPUP_W, POPUP_H, join(OUT, 'raw', `${scene.id}.png`), '--delay=700');
}

// ---------- 2. Frame each popup into a 1280x800 screenshot ----------

const FRAME_CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    width:1280px;height:800px;overflow:hidden;position:relative;
    font-family:'Liberation Sans',Arial,sans-serif;
    background:linear-gradient(135deg,#eef2ff 0%,#e6ecfb 45%,#dbe4fb 100%);
    color:#101828;
  }
  .glow{position:absolute;border-radius:50%;filter:blur(90px);opacity:.5}
  .glow.a{width:520px;height:520px;left:-160px;top:-180px;background:#c7d7fe}
  .glow.b{width:460px;height:460px;right:-120px;bottom:-170px;background:#dcd4fb}
  .wrap{position:relative;display:flex;align-items:center;height:100%;padding:0 84px;gap:64px}
  .copy{flex:1;max-width:600px}
  .eyebrow{
    display:inline-block;padding:7px 15px;border-radius:999px;
    background:rgba(255,255,255,.85);border:1px solid #c9d4ee;
    font-size:17px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2f57c9;
    margin-bottom:26px;
  }
  h1{font-size:54px;line-height:1.09;font-weight:700;letter-spacing:-.02em;white-space:pre-line}
  p{margin-top:26px;font-size:23px;line-height:1.55;color:#43506b;max-width:520px}
  .device{position:relative;flex-shrink:0}
  .device img{
    display:block;width:${POPUP_W}px;height:${POPUP_H}px;
    border-radius:16px;border:1px solid rgba(16,24,40,.10);
    box-shadow:0 42px 80px -20px rgba(16,24,40,.42), 0 12px 26px -12px rgba(16,24,40,.26);
  }
  .brand{position:absolute;left:84px;bottom:46px;display:flex;align-items:center;gap:12px}
  .brand img{width:34px;height:34px;border-radius:8px}
  .brand span{font-size:19px;font-weight:700;color:#43506b}
`;

for (const scene of SCENES) {
    const html = `<!doctype html><meta charset="utf-8"><style>${FRAME_CSS}</style>
<div class="glow a"></div><div class="glow b"></div>
<div class="wrap">
  <div class="copy">
    <div class="eyebrow">${scene.eyebrow}</div>
    <h1>${scene.title}</h1>
    <p>${scene.body}</p>
  </div>
  <div class="device"><img src="raw-${scene.id}.png"></div>
</div>
<div class="brand"><img src="icon128.png"><span>Webpage Summarizer &amp; Chat</span></div>`;

    cpSync(join(OUT, 'raw', `${scene.id}.png`), join(WORK, `raw-${scene.id}.png`));
    const page = join(WORK, `frame-${scene.id}.html`);
    writeFileSync(page, html);
    shot(page, 1280, 800, join(OUT, 'screenshots', scene.file));
}

// ---------- 3. Promo tiles ----------

const promo = (w, h, layout) => `<!doctype html><meta charset="utf-8">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    width:${w}px;height:${h}px;overflow:hidden;position:relative;
    font-family:'Liberation Sans',Arial,sans-serif;color:#fff;
    background:linear-gradient(135deg,#5b8def 0%,#3b6fe0 52%,#4338ca 100%);
    display:flex;align-items:center;justify-content:center;
  }
  .glow{position:absolute;border-radius:50%;filter:blur(80px);opacity:.35;background:#a5c4ff}
  .g1{width:${Math.round(w * 0.5)}px;height:${Math.round(w * 0.5)}px;left:${-Math.round(w * 0.18)}px;top:${-Math.round(h * 0.5)}px}
  .g2{width:${Math.round(w * 0.42)}px;height:${Math.round(w * 0.42)}px;right:${-Math.round(w * 0.14)}px;bottom:${-Math.round(h * 0.55)}px}
  ${layout}
</style>`;

writeFileSync(join(WORK, 'promo-small.html'), promo(440, 280, `
  .inner{position:relative;text-align:center;padding:0 30px}
  img{width:82px;height:82px;margin:0 auto 18px;display:block;filter:drop-shadow(0 8px 18px rgba(0,0,0,.28))}
  h1{font-size:25px;font-weight:700;letter-spacing:-.01em;line-height:1.2;white-space:nowrap}
  p{margin-top:11px;font-size:15.5px;line-height:1.45;color:#dbe6ff}
`) + `
<div class="glow g1"></div><div class="glow g2"></div>
<div class="inner">
  <img src="icon128.png">
  <h1>Webpage Summarizer &amp; Chat</h1>
  <p>Summarize, chat and build a searchable library</p>
</div>`);
shot(join(WORK, 'promo-small.html'), 440, 280, join(OUT, 'promo-small.png'));

writeFileSync(join(WORK, 'promo-marquee.html'), promo(1400, 560, `
  .inner{position:relative;display:flex;align-items:center;gap:56px;padding:0 96px;width:100%}
  img{width:190px;height:190px;flex-shrink:0;filter:drop-shadow(0 20px 40px rgba(0,0,0,.32))}
  h1{font-size:66px;font-weight:700;letter-spacing:-.02em;line-height:1.1}
  p{margin-top:22px;font-size:28px;line-height:1.45;color:#dbe6ff;max-width:820px}
`) + `
<div class="glow g1"></div><div class="glow g2"></div>
<div class="inner">
  <img src="icon128.png">
  <div>
    <h1>Webpage Summarizer &amp; Chat</h1>
    <p>Summarize any page or video, ask follow-up questions, and build a private knowledge base you can search and cite.</p>
  </div>
</div>`);
shot(join(WORK, 'promo-marquee.html'), 1400, 560, join(OUT, 'promo-marquee.png'));

rmSync(WORK, { recursive: true, force: true });
console.log('\nStore assets written to store/');
