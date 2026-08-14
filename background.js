// IndexedDB-backed knowledge base (bookmarks, vectors, lexical index).
importScripts('kb-db.js');

// =============== Constants ===============
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const DEFAULT_MODEL = 'gpt-5-nano-2025-08-07';
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const MAX_CONVERSATIONS = 100;   // pruned oldest-first beyond this
const MAX_HISTORY_MESSAGES = 24; // messages sent to the API per request
const KB_TOP_K = 6;              // sources retrieved for search/ask
const KB_EMBED_CHARS = 8000;     // chars of content embedded per bookmark

// In-flight generations, keyed by conversation id.
// { buffer, status, controller }
const inFlight = new Map();

// In-flight "ask your KB" runs, keyed by askId. { buffer, status, controller }
const kbAsks = new Map();

// =============== Small helpers ===============

function normalizeUrl(raw) {
    try {
        const u = new URL(raw);
        u.hash = '';
        for (const key of [...u.searchParams.keys()]) {
            if (key.startsWith('utm_') || key === 'fbclid' || key === 'gclid') {
                u.searchParams.delete(key);
            }
        }
        // Collapse every form of a YouTube video link (youtu.be, /shorts, a
        // resume timestamp, playlist and referrer params) onto one canonical
        // URL, so a video always maps to a single conversation.
        const videoId = youtubeVideoId(u.toString());
        if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
        return u.toString();
    } catch {
        return raw || '';
    }
}

function isRestrictedUrl(url) {
    return !url
        || /^(chrome|edge|about|view-source|chrome-extension|moz-extension|devtools):/.test(url)
        || url.includes('chromewebstore.google.com')
        || url.includes('chrome.google.com/webstore');
}

// Watch pages, Shorts, live streams, youtu.be links and embeds all carry a
// transcript. Must stay in sync with the copy in popup.js.
function youtubeVideoId(url) {
    try {
        const u = new URL(url);
        const host = u.hostname.replace(/^www\./, '');
        if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || '';
        if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return '';
        if (u.pathname === '/watch') return u.searchParams.get('v') || '';
        const match = u.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?#]+)/);
        return match ? match[1] : '';
    } catch {
        return '';
    }
}

function isYouTubeVideoUrl(url) {
    return !!youtubeVideoId(url);
}

// Transcripts carry [m:ss] markers. They help the model cite moments, but they
// are noise for lexical indexing, embeddings and snippets.
function stripTimestamps(text) {
    return (text || '').replace(/^\[\d{1,2}(?::\d{2}){1,2}\]\s*/gm, '');
}

// Content stored by older versions used a "[Could not …]" string in place of
// real content; newer conversations/bookmarks carry an explicit contentStatus.
function isPlaceholderContent(text) {
    return /^\[(?:Could not|No transcript|No page|Error)/.test(text || '');
}

async function getSettings() {
    const result = await chrome.storage.sync.get(['openaiApiKey', 'model', 'kbEmbeddingsEnabled']);
    return {
        apiKey: result.openaiApiKey || '',
        model: result.model || DEFAULT_MODEL,
        embeddingsEnabled: result.kbEmbeddingsEnabled !== false // default on
    };
}

// Fire-and-forget broadcast to the popup (it may be closed — that's fine,
// everything is persisted so the popup can catch up via getState).
function broadcast(message) {
    chrome.runtime.sendMessage(message).catch(() => {});
}

// =============== Conversation storage ===============
// Layout in chrome.storage.local:
//   convIndex            -> { [id]: {id, url, title, favIconUrl, createdAt, updatedAt, messageCount, contentType} }
//   urlActive            -> { [normalizedUrl]: conversationId }
//   conv:<id>            -> full conversation incl. messages and extracted page content
//   drafts               -> { [normalizedUrl]: draft text } (written by the popup)

async function getIndex() {
    return (await chrome.storage.local.get('convIndex')).convIndex || {};
}

async function setIndex(index) {
    await chrome.storage.local.set({ convIndex: index });
}

async function getActiveMap() {
    return (await chrome.storage.local.get('urlActive')).urlActive || {};
}

async function setActiveMap(map) {
    await chrome.storage.local.set({ urlActive: map });
}

async function getConv(id) {
    if (!id) return null;
    return (await chrome.storage.local.get('conv:' + id))['conv:' + id] || null;
}

async function saveConv(conv) {
    conv.updatedAt = Date.now();
    await chrome.storage.local.set({ ['conv:' + conv.id]: conv });

    const index = await getIndex();
    index[conv.id] = {
        id: conv.id,
        url: conv.url,
        title: conv.title || conv.url,
        favIconUrl: conv.favIconUrl || '',
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        messageCount: conv.messages.length,
        contentType: conv.contentType || 'page'
    };

    // Prune oldest conversations beyond the cap.
    const sortedIds = Object.values(index)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(entry => entry.id);
    if (sortedIds.length > MAX_CONVERSATIONS) {
        const dropped = sortedIds.slice(MAX_CONVERSATIONS);
        for (const id of dropped) delete index[id];
        await chrome.storage.local.remove(dropped.map(id => 'conv:' + id));
        const active = await getActiveMap();
        let changed = false;
        for (const [url, id] of Object.entries(active)) {
            if (dropped.includes(id)) { delete active[url]; changed = true; }
        }
        if (changed) await setActiveMap(active);
    }
    await setIndex(index);
}

async function deleteConv(id) {
    inFlight.get(id)?.controller.abort();
    const index = await getIndex();
    delete index[id];
    await setIndex(index);
    await chrome.storage.local.remove('conv:' + id);
    const active = await getActiveMap();
    let changed = false;
    for (const [url, activeId] of Object.entries(active)) {
        if (activeId === id) { delete active[url]; changed = true; }
    }
    if (changed) await setActiveMap(active);
}

async function clearAllConversations() {
    for (const flight of inFlight.values()) flight.controller.abort();
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter(k => k.startsWith('conv:'));
    keys.push('convIndex', 'urlActive');
    await chrome.storage.local.remove(keys);
}

// =============== Injected extraction functions ===============
// These run in the page context, so they must be fully self-contained.

function extractPageContent() {
    let text = '';
    const selectors = ['main', 'article', '[role="main"]', '.post-content', '.entry-content'];
    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
            text = element.innerText;
            break;
        }
    }

    if (!text || text.length < 200) {
        const bodyClone = document.body.cloneNode(true);
        ["script", "style", "nav", "footer", "aside", "header", "button", "form", "figure", "iframe", "noscript"].forEach(tag => {
            bodyClone.querySelectorAll(tag).forEach(el => el.remove());
        });
        text = bodyClone.innerText;
    }

    text = text.replace(/(?:https?|ftp):\/\/[\n\S]+/g, '');
    text = text.replace(/\s\s+/g, ' ').trim();

    const MAX_CONTENT_LENGTH = 24000;
    if (text.length > MAX_CONTENT_LENGTH) {
        text = text.substring(0, MAX_CONTENT_LENGTH) + "... [Content Truncated]";
    }
    return text || "[Could not extract meaningful content.]";
}

// Injected into YouTube video pages. Preferably in the MAIN world, where the
// page's own `ytInitialPlayerResponse` / `ytcfg` globals are reachable; it
// still works (via the inline <script> tags) in an isolated world.
//
// Sources, most to least reliable:
//   1. timedtext — YouTube's own caption endpoint, taken from the player
//      response. Complete, language-aware, and immune to DOM churn.
//   2. panel DOM — scrape the transcript panel if it is already open.
//   3. open panel — click "Show transcript", wait for it, then scrape.
// If none of those produce text it falls back to the video description, so the
// model still has something concrete to work with.
//
// The DOM layer understands both the current "modern transcript view"
// (transcript-segment-view-model) and the older ytd-transcript-* renderers;
// YouTube ships them to different users at the same time, which is why
// scraping alone worked only some of the time.
//
// Returns { status: 'ok'|'partial'|'error', text, note, source, segments, language }.
async function extractYouTubeTranscript() {
    const MAX_CHARS = 24000;
    const LINE_CHARS = 200;       // captions merged per timestamped line
    const LINE_SECONDS = 30;      // …and never spanning more than this
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function currentVideoId() {
        try {
            const u = new URL(location.href);
            const v = u.searchParams.get('v');
            if (v) return v;
            if (u.hostname.replace(/^www\./, '') === 'youtu.be') return u.pathname.slice(1).split('/')[0] || '';
            const match = u.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?#]+)/);
            return match ? match[1] : '';
        } catch {
            return '';
        }
    }

    function stamp(seconds) {
        const total = Math.max(0, Math.floor(seconds || 0));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        const mm = h ? String(m).padStart(2, '0') : String(m);
        return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
    }

    // "1:23" / "1:02:03" -> seconds. Returns null for anything else.
    function parseStamp(text) {
        const parts = String(text || '').trim().split(':');
        if (parts.length < 2 || parts.length > 3) return null;
        const numbers = parts.map(part => parseInt(part, 10));
        if (numbers.some(n => Number.isNaN(n))) return null;
        return numbers.reduce((total, n) => total * 60 + n, 0);
    }

    function decodeEntities(text) {
        return String(text || '')
            .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
            .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
            .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    }

    // Merges captions into ~200-character lines prefixed with a timestamp, so
    // the model can cite moments without paying for a stamp on every caption.
    // A line is also cut when it would span more than LINE_SECONDS, so the
    // stamp stays close to the words that follow it across pauses and silence.
    // Auto-captions repeat the previous line as they roll, so drop repeats.
    function formatSegments(segments) {
        const lines = [];
        let start = null;
        let buffer = '';
        let previous = '';

        const flush = () => {
            const text = buffer.replace(/\s+/g, ' ').trim();
            if (text) lines.push((start === null ? '' : `[${stamp(start)}] `) + text);
            buffer = '';
            start = null;
        };

        for (const segment of segments) {
            const text = decodeEntities(segment.text || '').replace(/\s+/g, ' ').trim();
            if (!text || text === previous) continue;
            previous = text;
            const at = typeof segment.start === 'number' && !Number.isNaN(segment.start) ? segment.start : null;
            if (start !== null && at !== null && at - start >= LINE_SECONDS) flush();
            if (start === null) start = at;
            buffer += (buffer ? ' ' : '') + text;
            if (buffer.length >= LINE_CHARS) flush();
        }
        flush();
        return lines.join('\n');
    }

    // Keep the head and the tail of very long transcripts: a video's closing
    // minutes usually carry the conclusion, which plain truncation throws away.
    function clamp(text) {
        if (text.length <= MAX_CHARS) return text;
        const head = Math.floor(MAX_CHARS * 0.6);
        const tail = MAX_CHARS - head;
        return text.slice(0, head).replace(/\n[^\n]*$/, '')
            + '\n\n… [middle of the transcript omitted for length] …\n\n'
            + text.slice(-tail).replace(/^[^\n]*\n/, '');
    }

    // ---- 1. timedtext ----

    // Brace-balanced slice of the JSON object following `marker`. A regex can't
    // do this — the payload is full of nested braces and quoted braces.
    function jsonAfter(source, marker, from) {
        const at = source.indexOf(marker, from || 0);
        if (at === -1) return { value: null, next: -1 };
        const start = source.indexOf('{', at + marker.length);
        if (start === -1) return { value: null, next: -1 };
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let i = start; i < source.length; i++) {
            const ch = source[i];
            if (inString) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === '"') inString = false;
                continue;
            }
            if (ch === '"') inString = true;
            else if (ch === '{') depth++;
            else if (ch === '}' && --depth === 0) {
                let value = null;
                try { value = JSON.parse(source.slice(start, i + 1)); } catch { /* not the droid */ }
                return { value, next: i + 1 };
            }
        }
        return { value: null, next: -1 };
    }

    async function playerResponse(videoId) {
        const matches = (candidate) => candidate?.captions
            && (!videoId || !candidate?.videoDetails?.videoId || candidate.videoDetails.videoId === videoId);

        if (matches(window.ytInitialPlayerResponse)) return window.ytInitialPlayerResponse;

        for (const script of document.querySelectorAll('script')) {
            const source = script.textContent || '';
            if (!source.includes('ytInitialPlayerResponse')) continue;
            let from = 0;
            while (from !== -1) {
                const { value, next } = jsonAfter(source, 'ytInitialPlayerResponse', from);
                if (next === -1) break;
                if (matches(value)) return value;
                from = next;
            }
        }

        // Last resort: ask InnerTube. This is the only source that stays correct
        // after in-page navigation, where the inline script and (in some builds)
        // the global still describe whichever video was loaded first.
        if (!videoId) return null;
        try {
            const cfg = window.ytcfg;
            const key = cfg?.get?.('INNERTUBE_API_KEY');
            if (!key) return null;
            const context = cfg?.get?.('INNERTUBE_CONTEXT') || {
                client: {
                    clientName: 'WEB',
                    clientVersion: cfg?.get?.('INNERTUBE_CLIENT_VERSION') || '2.20240101.00.00'
                }
            };
            const response = await fetch(`/youtubei/v1/player?key=${encodeURIComponent(key)}`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoId, context })
            });
            if (!response.ok) return null;
            return await response.json();
        } catch {
            return null;
        }
    }

    // Prefer the spoken language, and a human-written track over auto-captions.
    function pickTrack(tracks, spokenLanguage) {
        const want = (spokenLanguage || document.documentElement.lang || navigator.language || 'en')
            .split('-')[0].toLowerCase();
        let best = null;
        let bestScore = -Infinity;
        for (const track of tracks) {
            if (!track?.baseUrl) continue;
            const lang = (track.languageCode || '').split('-')[0].toLowerCase();
            let score = 0;
            if (lang === want) score += 4;
            if (track.kind !== 'asr') score += 2;
            if (lang === 'en') score += 1;
            if (score > bestScore) { best = track; bestScore = score; }
        }
        return best;
    }

    async function fetchJson3(baseUrl) {
        const url = new URL(baseUrl, location.origin);
        url.searchParams.set('fmt', 'json3');
        const response = await fetch(url.toString(), { credentials: 'same-origin' });
        if (!response.ok) return [];
        const data = await response.json();
        return (data?.events || [])
            // `aAppend` events re-send text that is already on screen.
            .filter(event => Array.isArray(event.segs) && !event.aAppend)
            .map(event => ({
                start: (event.tStartMs || 0) / 1000,
                text: event.segs.map(seg => seg.utf8 || '').join('')
            }));
    }

    async function fetchXml(baseUrl) {
        const response = await fetch(baseUrl, { credentials: 'same-origin' });
        if (!response.ok) return [];
        const doc = new DOMParser().parseFromString(await response.text(), 'text/xml');
        return Array.from(doc.querySelectorAll('text')).map(node => ({
            start: parseFloat(node.getAttribute('start') || '0'),
            text: node.textContent || ''
        }));
    }

    async function fromTimedText(videoId) {
        const player = await playerResponse(videoId);
        const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        if (!tracks.length) {
            return { segments: [], reason: player ? 'no-captions' : 'no-player-response' };
        }
        const track = pickTrack(tracks, player?.videoDetails?.defaultAudioLanguage);
        if (!track) return { segments: [], reason: 'no-captions' };

        let segments = [];
        try {
            segments = await fetchJson3(track.baseUrl);
        } catch { /* fall through to the XML format */ }
        if (!segments.length) {
            try { segments = await fetchXml(track.baseUrl); } catch { /* give up on this source */ }
        }
        return {
            segments,
            language: track.languageCode || '',
            reason: segments.length ? '' : 'captions-unavailable'
        };
    }

    // ---- 2/3. transcript panel ----

    const SEGMENT_SELECTORS = [
        'transcript-segment-view-model',                  // current "modern transcript view"
        'ytd-transcript-segment-renderer',                // previous engagement panel
        'ytd-transcript-body-renderer .cue-group',        // legacy transcript body
        '[class*="TranscriptSegmentViewModelHost"]'       // renamed element, same markup
    ];
    const TIMESTAMP_SELECTOR = '.segment-timestamp, .cue-group-start-offset, [class*="Timestamp"]:not([class*="A11y"])';
    const TEXT_SELECTOR = 'span[role="text"], yt-formatted-string.segment-text, .segment-text, .cue';

    function segmentNodes() {
        for (const selector of SEGMENT_SELECTORS) {
            const nodes = document.querySelectorAll(selector);
            if (nodes.length) return Array.from(nodes);
        }
        return [];
    }

    function parseSegmentNode(node) {
        const textNodes = node.querySelectorAll(TEXT_SELECTOR);
        let text = Array.from(textNodes).map(el => (el.textContent || '').trim()).filter(Boolean).join(' ');
        if (!text) {
            // Unknown markup: take everything except the timestamp and the
            // screen-reader label that sits next to it ("1 minute, 7 seconds").
            const clone = node.cloneNode(true);
            clone.querySelectorAll('[class*="Timestamp"], .segment-timestamp, .cue-group-start-offset').forEach(el => el.remove());
            text = (clone.textContent || '').trim();
        }
        const timestamp = node.querySelector(TIMESTAMP_SELECTOR);
        return { start: parseStamp(timestamp?.textContent), text };
    }

    function findTranscriptButton() {
        // Structural first: the description carries a dedicated transcript
        // section, which is the same element in every language.
        const section = document.querySelector('ytd-video-description-transcript-section-renderer');
        const structural = section?.querySelector('button, tp-yt-paper-button');
        if (structural) return structural;
        // Label matching covers the layouts without that section. The list is
        // best-effort — timedtext above is what makes this path rarely needed.
        return document.querySelector([
            'button[aria-label*="transcri" i]',   // en, es, fr, pt
            'button[aria-label*="transkri" i]',   // de, nl, pl, tr, id
            'button[aria-label*="trascri" i]',    // it
            'button[aria-label*="расшифров" i]',
            'button[aria-label*="字幕"]',
            'button[aria-label*="문자"]'
        ].join(', '));
    }

    async function openPanel() {
        const panel = document.querySelector(
            'ytd-engagement-panel-section-list-renderer[target-id*="transcript" i], ytd-transcript-renderer'
        );
        if ((panel?.getAttribute('visibility') || '').includes('EXPANDED')) return true;

        let button = findTranscriptButton();
        if (!button) {
            // The transcript button lives behind the description's "…more".
            const expander = document.querySelector('#description-inline-expander #expand, tp-yt-paper-button#expand');
            if (expander) {
                expander.click();
                await sleep(300);
                button = findTranscriptButton();
            }
        }
        if (!button) return false;
        button.click();
        return true;
    }

    async function waitForSegments(timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        let nodes = segmentNodes();
        while (!nodes.length && Date.now() < deadline) {
            await sleep(200);
            nodes = segmentNodes();
        }
        // Segments stream in — wait for the count to stop growing.
        let previous = -1;
        while (nodes.length && nodes.length !== previous && Date.now() < deadline) {
            previous = nodes.length;
            await sleep(250);
            nodes = segmentNodes();
        }
        return nodes;
    }

    function videoDescription() {
        const container = document.querySelector(
            '#description-inline-expander, ytd-expandable-video-description-body-renderer, #description.ytd-watch-metadata'
        );
        let text = (container?.innerText || container?.textContent || '').trim();
        if (!text) text = (document.querySelector('meta[name="description"]')?.content || '').trim();
        return text.replace(/\s\s+/g, ' ').slice(0, 4000);
    }

    // ---- run ----

    try {
        const videoId = currentVideoId();
        let segments = [];
        let source = '';
        let language = '';

        const captions = await fromTimedText(videoId);
        if (captions.segments.length) {
            segments = captions.segments;
            source = 'captions';
            language = captions.language;
        }

        if (!segments.length) {
            const open = segmentNodes();
            if (open.length) {
                segments = open.map(parseSegmentNode);
                source = 'panel';
            }
        }

        if (!segments.length) {
            const opened = await openPanel();
            const nodes = await waitForSegments(opened ? 8000 : 1500);
            if (nodes.length) {
                segments = nodes.map(parseSegmentNode);
                source = 'panel';
            }
        }

        if (segments.length) {
            const text = clamp(formatSegments(segments));
            if (text) {
                return { status: 'ok', text, note: '', source, segments: segments.length, language };
            }
        }

        const description = videoDescription();
        const note = captions.reason === 'no-captions'
            ? 'This video has no captions, so no transcript is available. The text below is the video description.'
            : 'The transcript could not be read from this video. The text below is the video description.';
        if (description) {
            return { status: 'partial', text: description, note, source: 'description', segments: 0, language: '' };
        }
        return {
            status: 'error',
            text: '',
            note: captions.reason === 'no-captions'
                ? 'This video has no captions, so no transcript is available.'
                : 'No transcript or description could be read from this video page.',
            source: '',
            segments: 0,
            language: ''
        };
    } catch (error) {
        return { status: 'error', text: '', note: `Transcript extraction failed: ${error.message}`, source: '', segments: 0, language: '' };
    }
}

// =============== OpenAI ===============

function apiErrorMessage(status, body) {
    const detail = body?.error?.message || '';
    if (status === 401) return 'Invalid OpenAI API key. Check it in Settings.';
    if (status === 429) return 'OpenAI rate limit or quota exceeded.' + (detail ? ' ' + detail : '');
    if (status === 400 && body?.error?.code === 'context_length_exceeded') {
        return 'Content + history too long for the model. Start a new chat.';
    }
    return `OpenAI API error (${status})${detail ? ': ' + detail : ''}`;
}

// Streams a chat completion, invoking onDelta with text chunks.
// Falls back to a non-streaming request if the account/model rejects streaming.
async function callOpenAI(apiKey, model, messages, onDelta, signal) {
    if (!apiKey) throw new Error('API key is missing.');

    const doFetch = (stream) => fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(stream ? { model, messages, stream: true } : { model, messages }),
        signal
    });

    let response = await doFetch(true);
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const detail = body?.error?.message || '';
        if (response.status === 400 && /stream/i.test(detail)) {
            response = await doFetch(false);
            if (!response.ok) {
                const body2 = await response.json().catch(() => ({}));
                throw new Error(apiErrorMessage(response.status, body2));
            }
        } else {
            throw new Error(apiErrorMessage(response.status, body));
        }
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
        const body = await response.json();
        const content = body?.choices?.[0]?.message?.content?.trim();
        if (!content) throw new Error('Received an empty response from OpenAI.');
        if (onDelta) onDelta(content);
        return content;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    let pending = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop();
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
                const json = JSON.parse(data);
                const delta = json.choices?.[0]?.delta?.content;
                if (delta) {
                    full += delta;
                    if (onDelta) onDelta(delta);
                }
            } catch {
                // Ignore malformed SSE fragments.
            }
        }
    }
    full = full.trim();
    if (!full) throw new Error('Received an empty response from OpenAI.');
    return full;
}

// Requests an embedding vector for the given text. Returns a Float32Array.
async function callEmbeddings(apiKey, model, input, signal) {
    if (!apiKey) throw new Error('API key is missing.');
    const response = await fetch(OPENAI_EMBEDDINGS_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({ model: model || DEFAULT_EMBEDDING_MODEL, input }),
        signal
    });
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(apiErrorMessage(response.status, body));
    }
    const body = await response.json();
    const vector = body?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || !vector.length) {
        throw new Error('Received an empty embedding from OpenAI.');
    }
    return Float32Array.from(vector);
}

// Search re-embeds the query on every debounced keystroke and on each search-mode
// toggle. Cache recent query vectors (small LRU) so repeated/identical queries
// don't trigger — or get billed for — another embeddings request.
const queryEmbedCache = new Map(); // query -> Float32Array, insertion-ordered LRU
const QUERY_EMBED_CACHE_MAX = 32;

async function embedQuery(apiKey, query) {
    const key = (query || '').trim();
    const cached = queryEmbedCache.get(key);
    if (cached) {
        queryEmbedCache.delete(key);   // refresh recency
        queryEmbedCache.set(key, cached);
        return cached;
    }
    const vector = await callEmbeddings(apiKey, DEFAULT_EMBEDDING_MODEL, key);
    queryEmbedCache.set(key, vector);
    if (queryEmbedCache.size > QUERY_EMBED_CACHE_MAX) {
        queryEmbedCache.delete(queryEmbedCache.keys().next().value); // evict oldest
    }
    return vector;
}

// =============== Generation pipeline ===============

function makeUserMessage(mode, prompt) {
    const ts = Date.now();
    if (mode === 'summarize') {
        return {
            role: 'user',
            content: 'Summarize this page',
            prompt: 'Provide a concise, well-structured summary of the page content. Start with a 1–2 sentence overview, then list the key points as bullets.',
            kind: 'action',
            ts
        };
    }
    if (mode === 'summarizeVideo') {
        return {
            role: 'user',
            content: 'Summarize this video',
            prompt: 'Analyze the video transcript and summarize the key learnings, main insights, and actionable takeaways. Use short sections or bullets.',
            kind: 'action',
            ts
        };
    }
    if (mode === 'chat' && prompt) {
        return { role: 'user', content: prompt, ts };
    }
    return null;
}

function buildApiMessages(conv) {
    const isVideo = conv.contentType === 'video';
    let system = `You are a helpful assistant inside a Chrome extension. The user is viewing: "${conv.title}" (${conv.url}). Help them understand and discuss this ${isVideo ? 'video' : 'page'}. Format responses in Markdown (short headings, bullets, bold for key terms) and keep them focused.`;

    if (hasUsableContent(conv)) {
        if (conv.contentNote) system += `\n\nNote: ${conv.contentNote}`;
        if (isVideo && conv.contentStatus !== 'partial') {
            system += `\n\nVideo transcript (each line is prefixed with the [m:ss] timestamp where it starts — cite those when it helps):\n"""\n${conv.pageContent}\n"""`;
        } else {
            system += `\n\nExtracted ${isVideo ? 'video' : 'page'} content:\n"""\n${conv.pageContent}\n"""`;
        }
    } else {
        const reason = conv.contentNote || (conv.pageContent && isPlaceholderContent(conv.pageContent) ? conv.pageContent : '');
        system += `\n\nNote: the ${isVideo ? 'video transcript' : 'page content'} could not be extracted${reason ? ` (${reason})` : ''}.`
            + ' Answer from the URL/title and general knowledge, say plainly that you could not read the'
            + ` ${isVideo ? 'transcript' : 'page'}, and flag anything you are unsure about.`;
    }

    const messages = [{ role: 'system', content: system }];
    const history = conv.messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-MAX_HISTORY_MESSAGES);
    for (const m of history) {
        messages.push({ role: m.role, content: m.prompt || m.content });
    }
    return messages;
}

// Extracts page or video content from the given tab by injecting the relevant
// content script. Returns { content, contentType }. Shared by chat generation
// (ensureContext) and knowledge-base bookmarking.
async function extractForUrl(tab, wantVideo, setStatus) {
    if (wantVideo) {
        setStatus?.('Reading video transcript…');
        // The MAIN world is where YouTube keeps the player response. Only if
        // injecting there fails outright do we retry in the isolated world,
        // which still reaches the inline scripts and the DOM fallbacks.
        let result = null;
        for (const world of ['MAIN', 'ISOLATED']) {
            try {
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    world,
                    func: extractYouTubeTranscript
                });
                result = results?.[0]?.result || null;
            } catch (e) {
                console.warn(`Transcript extraction failed (${world} world):`, e);
            }
            if (result) break; // A verdict from the MAIN world is the best available.
        }
        if (result?.text) {
            console.log(`Transcript via ${result.source} (${result.segments} segments${result.language ? ', ' + result.language : ''})`);
            return {
                content: result.text,
                contentType: 'video',
                contentStatus: result.status,
                contentNote: result.note || ''
            };
        }
        return {
            content: '',
            contentType: 'video',
            contentStatus: 'error',
            contentNote: result?.note || 'The transcript could not be read from this video.'
        };
    }

    setStatus?.('Reading page…');
    let text = '';
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractPageContent
        });
        text = typeof results?.[0]?.result === 'string' ? results[0].result : '';
    } catch (e) {
        console.warn('Page extraction failed:', e);
    }
    if (!text || isPlaceholderContent(text)) {
        return {
            content: '',
            contentType: 'page',
            contentStatus: 'error',
            contentNote: 'No readable text could be extracted from this page.'
        };
    }
    return { content: text, contentType: 'page', contentStatus: 'ok', contentNote: '' };
}

// True when the conversation holds content the model can actually rely on.
// Conversations saved by older versions have no contentStatus and stored a
// "[Could not …]" placeholder string instead.
function hasUsableContent(conv) {
    if (!conv?.pageContent) return false;
    if (conv.contentStatus) return conv.contentStatus !== 'error';
    return !isPlaceholderContent(conv.pageContent);
}

// Extracts (or re-extracts) page/video content into the conversation when needed.
// Chat messages reuse previously stored content; summarize actions always refresh
// it, as does any conversation whose stored content is missing or came from the
// wrong extractor (e.g. a video chat that first captured the YouTube chrome).
async function ensureContext(conv, mode, tab, setStatus) {
    const tabUrl = tab?.url || '';
    const wantVideo = tabUrl ? isYouTubeVideoUrl(tabUrl) : conv.contentType === 'video';
    const isSummarizeAction = mode === 'summarize' || mode === 'summarizeVideo';
    const stale = !hasUsableContent(conv) || (wantVideo && conv.contentType !== 'video');

    if (!isSummarizeAction && !stale) return;
    // Don't re-run a failing extraction on every chat message — one retry is
    // enough unless the user explicitly asks for a fresh summary.
    if (!isSummarizeAction && (conv.contentAttempts || 0) >= 2) return;

    if (!tab?.id || normalizeUrl(tabUrl) !== conv.url || isRestrictedUrl(tabUrl)) {
        return; // Can't extract from this tab; rely on stored content if any.
    }

    conv.contentAttempts = (conv.contentAttempts || 0) + 1;
    const extracted = await extractForUrl(tab, wantVideo, setStatus);
    // A failed re-read must not wipe content we already have.
    if (!extracted.content && hasUsableContent(conv) && conv.contentType === extracted.contentType) return;

    conv.pageContent = extracted.content;
    conv.contentType = extracted.contentType;
    conv.contentStatus = extracted.contentStatus;
    conv.contentNote = extracted.contentNote;
}

async function runGeneration(conv, mode, tab) {
    const controller = new AbortController();
    const flight = { buffer: '', status: '', controller };
    inFlight.set(conv.id, flight);
    broadcast({ type: 'genStart', convId: conv.id, url: conv.url });

    const setStatus = (status) => {
        flight.status = status;
        broadcast({ type: 'genStatus', convId: conv.id, status });
    };

    try {
        const { apiKey, model } = await getSettings();

        await ensureContext(conv, mode, tab, setStatus);
        await saveConv(conv);

        setStatus('Thinking…');
        const messages = buildApiMessages(conv);

        let content;
        try {
            content = await callOpenAI(apiKey, model, messages, (delta) => {
                flight.buffer += delta;
                broadcast({ type: 'genDelta', convId: conv.id, delta });
            }, controller.signal);
        } catch (error) {
            if (error.name === 'AbortError') {
                content = flight.buffer.trim();
                if (!content) {
                    inFlight.delete(conv.id);
                    broadcast({ type: 'genDone', convId: conv.id, content: '', cancelled: true });
                    return;
                }
            } else {
                throw error;
            }
        }

        conv.messages.push({ role: 'assistant', content, ts: Date.now() });
        const index = await getIndex();
        if (index[conv.id]) {
            await saveConv(conv); // Skip if the conversation was deleted mid-generation.
        }
        inFlight.delete(conv.id);
        broadcast({ type: 'genDone', convId: conv.id, content });
    } catch (error) {
        console.error('Generation failed:', error);
        inFlight.delete(conv.id);
        broadcast({ type: 'genError', convId: conv.id, error: error.message });
    }
}

// =============== Knowledge base ===============

const STOPWORDS = new Set(('a an and are as at be by for from has have he in is it its of on or '
    + 'that the to was were will with this these those they you your i we our us not but если '
    + 'about into over after before than then them their there here what when where which who how')
    .split(/\s+/));

// Lowercases, strips punctuation, splits on whitespace, drops stopwords and very
// short tokens. Returns a de-duplicated array of terms. Shared by save + search.
function tokenize(text) {
    if (!text) return [];
    const seen = new Set();
    for (const raw of String(text).toLowerCase().split(/[^a-z0-9]+/)) {
        if (raw.length < 2 || raw.length > 32) continue;
        if (STOPWORDS.has(raw)) continue;
        seen.add(raw);
    }
    return [...seen];
}

// Term-frequency map (term -> count) for indexing, weighting title/tags higher.
function termCounts(bookmark) {
    const counts = new Map();
    const add = (text, weight) => {
        if (!text) return;
        for (const raw of String(text).toLowerCase().split(/[^a-z0-9]+/)) {
            if (raw.length < 2 || raw.length > 32 || STOPWORDS.has(raw)) continue;
            counts.set(raw, (counts.get(raw) || 0) + weight);
        }
    };
    add(bookmark.aiTitle || bookmark.title, 5);
    add((bookmark.tags || []).join(' '), 4);
    add((bookmark.keywords || []).join(' '), 3);
    add(bookmark.summary, 2);
    add(stripTimestamps(bookmark.pageContent), 1);
    return counts;
}

function cosineSim(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function snippetFrom(bookmark) {
    const text = (bookmark.summary || stripTimestamps(bookmark.pageContent) || '').trim();
    return text.length > 220 ? text.slice(0, 220) + '…' : text;
}

// Asks the model for a title, summary, tags and keywords as JSON. Tolerant of
// ```json fences and stray prose. Returns {} on any failure so save still succeeds.
async function generateMetadata(apiKey, model, bookmark) {
    const body = stripTimestamps(bookmark.pageContent).slice(0, 12000);
    if (!body || isPlaceholderContent(body)) return {};
    const prompt = `You are indexing a saved ${bookmark.contentType === 'video' ? 'video' : 'web page'} for a personal knowledge base.\n`
        + `Title: "${bookmark.title}"\nURL: ${bookmark.url}\n\nContent:\n"""\n${body}\n"""\n\n`
        + 'Respond with ONLY a JSON object (no prose, no code fences) of the form:\n'
        + '{"title": "a concise descriptive title", "summary": "2-3 sentence summary", '
        + '"tags": ["3-6 short topic tags"], "keywords": ["5-10 searchable keywords"]}';
    let raw;
    try {
        raw = await callOpenAI(apiKey, model, [{ role: 'user', content: prompt }], null);
    } catch (e) {
        console.warn('Metadata generation failed:', e);
        return {};
    }
    let text = raw.trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) text = fence[1].trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) text = text.slice(start, end + 1);
    try {
        const parsed = JSON.parse(text);
        return {
            aiTitle: typeof parsed.title === 'string' ? parsed.title.trim() : '',
            summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
            tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 8) : [],
            keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).slice(0, 12) : []
        };
    } catch (e) {
        console.warn('Could not parse metadata JSON:', e);
        return {};
    }
}

// Runs AI enrichment (metadata + embedding) for a freshly saved bookmark and
// re-indexes it. Fire-and-forget from saveBookmark; broadcasts progress so the
// popup can refresh. Each step is best-effort — the bookmark stays usable.
async function enrichBookmark(id) {
    const { apiKey, model, embeddingsEnabled } = await getSettings();
    if (!apiKey) return;
    const bookmark = await kbGetBookmark(id);
    if (!bookmark) return;

    broadcast({ type: 'kbEnrichStart', id });
    const meta = await generateMetadata(apiKey, model, bookmark);
    Object.assign(bookmark, meta);

    let vector = null;
    if (embeddingsEnabled) {
        try {
            const input = `${bookmark.aiTitle || bookmark.title}\n${bookmark.summary || ''}\n`
                + stripTimestamps(bookmark.pageContent).slice(0, KB_EMBED_CHARS);
            vector = await callEmbeddings(apiKey, DEFAULT_EMBEDDING_MODEL, input);
        } catch (e) {
            console.warn('Embedding failed:', e);
        }
    }

    // Re-read before writing: the bookmark may have been deleted while we were
    // waiting on the (slow) metadata/embedding calls. Don't resurrect it — and
    // don't leave an orphan vector behind for a bookmark that's gone.
    const current = await kbGetBookmark(id);
    if (!current) return;

    Object.assign(current, meta);
    current.enriched = true;
    current.updatedAt = Date.now();
    await kbPutBookmark(current);
    if (vector) {
        await kbPutVector({ bookmarkId: id, model: DEFAULT_EMBEDDING_MODEL, dims: vector.length, vector });
    }
    await kbIndexRemove(id);
    await kbIndexAdd(id, termCounts(current));
    broadcast({ type: 'kbEnrichDone', id });
}

// Retrieves the top-K bookmarks for a query, blending lexical and semantic
// scores when embeddings are available. Returns ranked metadata + snippet.
async function retrieveTopK(query, mode, k = KB_TOP_K) {
    const { apiKey, embeddingsEnabled } = await getSettings();
    const all = await kbAllBookmarks();
    const byId = new Map(all.map(b => [b.id, b]));
    const wantSemantic = (mode === 'semantic' || mode === 'hybrid') && embeddingsEnabled && apiKey;

    // Semantic component (computed first so we know whether to fall back to lexical).
    const semantic = new Map();
    if (wantSemantic) {
        try {
            const qVec = await embedQuery(apiKey, query);
            for (const row of await kbAllVectors()) {
                semantic.set(row.bookmarkId, cosineSim(qVec, row.vector));
            }
        } catch (e) {
            console.warn('Semantic search failed, falling back to lexical:', e);
        }
    }

    // Lexical component. Always for lexical/hybrid; also as a fallback when a
    // semantic search produced nothing (embeddings off, no vectors yet, or the
    // embeddings API failed) so the user still gets keyword results.
    const lexical = new Map();
    const needLexical = mode !== 'semantic' || semantic.size === 0;
    if (needLexical) {
        const hits = await kbIndexLookup(tokenize(query));
        let max = 0;
        for (const { score } of hits.values()) max = Math.max(max, score);
        for (const [id, { score }] of hits) lexical.set(id, max ? score / max : 0);
    }

    const ids = new Set([...lexical.keys(), ...semantic.keys()]);
    const scored = [];
    for (const id of ids) {
        const meta = byId.get(id);
        if (!meta) continue;
        const lex = lexical.get(id) || 0;
        const sem = semantic.get(id) || 0;
        let score;
        if (mode === 'semantic') score = semantic.size ? sem : lex; // fall back to lexical
        else if (mode === 'lexical') score = lex;
        else score = semantic.size ? 0.5 * lex + 0.5 * sem : lex; // hybrid
        scored.push({ ...meta, score, snippet: snippetFrom(meta) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
}

function buildAskMessages(question, sources) {
    let context = '';
    sources.forEach((source, i) => {
        const body = (source.summary || stripTimestamps(source.pageContent) || '').slice(0, 2500);
        context += `\n[${i + 1}] ${source.aiTitle || source.title} (${source.url})\n${body}\n`;
    });
    const system = 'You are answering questions using the user\'s saved knowledge base. '
        + 'Use ONLY the numbered sources below. Cite them inline as [1], [2] matching the source numbers. '
        + 'If the sources do not contain the answer, say so plainly. Format in Markdown.\n\nSources:' + context;
    return [
        { role: 'system', content: system },
        { role: 'user', content: question }
    ];
}

// Streams a RAG answer over the knowledge base, reusing the gen* broadcast channel.
async function runKBAsk(askId, question) {
    const controller = new AbortController();
    const flight = { buffer: '', status: '', controller };
    kbAsks.set(askId, flight);
    broadcast({ type: 'genStart', convId: askId });

    const setStatus = (status) => {
        flight.status = status;
        broadcast({ type: 'genStatus', convId: askId, status });
    };

    try {
        const { apiKey, model } = await getSettings();
        setStatus('Searching your knowledge base…');
        const sources = await retrieveTopK(question, 'hybrid');
        if (!sources.length) {
            kbAsks.delete(askId);
            broadcast({ type: 'genDone', convId: askId, content: 'Your knowledge base has no saved pages matching this question yet.', sources: [] });
            return;
        }
        // Pull full content for the retrieved sources.
        const full = [];
        for (const source of sources) {
            full.push((await kbGetBookmark(source.id)) || source);
        }
        setStatus('Thinking…');
        const messages = buildAskMessages(question, full);
        const content = await callOpenAI(apiKey, model, messages, (delta) => {
            flight.buffer += delta;
            broadcast({ type: 'genDelta', convId: askId, delta });
        }, controller.signal);
        kbAsks.delete(askId);
        broadcast({
            type: 'genDone',
            convId: askId,
            content,
            sources: sources.map((s, i) => ({ n: i + 1, id: s.id, title: s.aiTitle || s.title, url: s.url }))
        });
    } catch (error) {
        kbAsks.delete(askId);
        if (error.name === 'AbortError') {
            broadcast({ type: 'genDone', convId: askId, content: flight.buffer.trim(), cancelled: true });
        } else {
            console.error('KB ask failed:', error);
            broadcast({ type: 'genError', convId: askId, error: error.message });
        }
    }
}

// =============== Message router ===============

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
        try {
            switch (request.type) {
                case 'getState': {
                    const url = normalizeUrl(request.url || '');
                    const active = await getActiveMap();
                    const conv = await getConv(active[url]);
                    const flight = conv ? inFlight.get(conv.id) : null;
                    sendResponse({
                        conv,
                        isGenerating: !!flight,
                        partial: flight?.buffer || '',
                        status: flight?.status || ''
                    });
                    break;
                }

                case 'getConversation': {
                    const conv = await getConv(request.convId);
                    const flight = conv ? inFlight.get(conv.id) : null;
                    sendResponse({
                        conv,
                        isGenerating: !!flight,
                        partial: flight?.buffer || '',
                        status: flight?.status || ''
                    });
                    break;
                }

                case 'getHistory': {
                    const index = await getIndex();
                    const items = Object.values(index).sort((a, b) => b.updatedAt - a.updatedAt);
                    sendResponse({ items });
                    break;
                }

                case 'generate': {
                    const { apiKey } = await getSettings();
                    if (!apiKey) {
                        sendResponse({ error: 'OpenAI API key not set. Add it in Settings.' });
                        break;
                    }

                    const url = normalizeUrl(request.url || '');
                    let conv = await getConv(request.convId);
                    if (!conv) {
                        const active = await getActiveMap();
                        conv = await getConv(active[url]);
                    }

                    let tab = null;
                    try {
                        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    } catch (e) {
                        console.warn('Could not query active tab:', e);
                    }

                    if (!conv) {
                        if (!url) {
                            sendResponse({ error: 'No page URL available.' });
                            break;
                        }
                        const sameTab = tab && normalizeUrl(tab.url || '') === url;
                        conv = {
                            id: crypto.randomUUID(),
                            url,
                            title: (sameTab && tab.title) || url,
                            favIconUrl: (sameTab && tab.favIconUrl) || '',
                            createdAt: Date.now(),
                            messages: [],
                            pageContent: '',
                            contentType: '',
                            contentStatus: '',
                            contentNote: '',
                            contentAttempts: 0
                        };
                        const active = await getActiveMap();
                        active[url] = conv.id;
                        await setActiveMap(active);
                    }

                    if (inFlight.has(conv.id)) {
                        sendResponse({ error: 'Already generating a response for this chat.' });
                        break;
                    }

                    const userMessage = makeUserMessage(request.mode, request.prompt);
                    if (!userMessage) {
                        sendResponse({ error: 'Invalid request type or missing prompt.' });
                        break;
                    }
                    conv.messages.push(userMessage);
                    await saveConv(conv);

                    sendResponse({ ok: true, convId: conv.id });
                    runGeneration(conv, request.mode, tab); // Continues after the response.
                    break;
                }

                case 'stop': {
                    inFlight.get(request.convId)?.controller.abort();
                    sendResponse({ ok: true });
                    break;
                }

                case 'newChat': {
                    const url = normalizeUrl(request.url || '');
                    const active = await getActiveMap();
                    if (active[url]) {
                        delete active[url];
                        await setActiveMap(active);
                    }
                    sendResponse({ ok: true });
                    break;
                }

                case 'setActive': {
                    const url = normalizeUrl(request.url || '');
                    if (url && request.convId) {
                        const active = await getActiveMap();
                        active[url] = request.convId;
                        await setActiveMap(active);
                    }
                    sendResponse({ ok: true });
                    break;
                }

                case 'deleteConversation': {
                    await deleteConv(request.convId);
                    sendResponse({ ok: true });
                    break;
                }

                case 'clearAllConversations': {
                    await clearAllConversations();
                    sendResponse({ ok: true });
                    break;
                }

                case 'saveBookmark': {
                    const url = normalizeUrl(request.url || '');
                    if (!url) { sendResponse({ error: 'No page URL available.' }); break; }

                    let tab = null;
                    try {
                        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    } catch (e) {
                        console.warn('Could not query active tab:', e);
                    }
                    const sameTab = tab && normalizeUrl(tab.url || '') === url;
                    const canExtract = sameTab && tab.id && !isRestrictedUrl(tab.url || '');

                    let content = '';
                    let contentType = 'page';
                    if (canExtract) {
                        const wantVideo = isYouTubeVideoUrl(tab.url || '');
                        try {
                            const extracted = await extractForUrl(tab, wantVideo);
                            content = extracted.content;
                            contentType = extracted.contentType;
                        } catch (e) {
                            console.warn('Bookmark extraction failed:', e);
                        }
                    }
                    // Fall back to a linked conversation's cached content if extraction failed.
                    if (!content && request.convId) {
                        const conv = await getConv(request.convId);
                        if (hasUsableContent(conv)) { content = conv.pageContent; contentType = conv.contentType || 'page'; }
                    }

                    const existing = await kbFindByUrl(url);
                    const now = Date.now();
                    const bookmark = {
                        id: existing?.id || crypto.randomUUID(),
                        url,
                        normalizedUrl: url,
                        title: (sameTab && tab.title) || existing?.title || url,
                        aiTitle: existing?.aiTitle || '',
                        favIconUrl: (sameTab && tab.favIconUrl) || existing?.favIconUrl || '',
                        contentType,
                        pageContent: content || existing?.pageContent || '',
                        summary: existing?.summary || '',
                        tags: existing?.tags || [],
                        keywords: existing?.keywords || [],
                        convId: request.convId || existing?.convId || null,
                        source: existing?.source || 'manual',
                        enriched: false,
                        createdAt: existing?.createdAt || now,
                        updatedAt: now
                    };
                    await kbPutBookmark(bookmark);
                    await kbIndexRemove(bookmark.id);
                    await kbIndexAdd(bookmark.id, termCounts(bookmark));

                    sendResponse({ ok: true, id: bookmark.id });
                    enrichBookmark(bookmark.id); // Continues after the response.
                    break;
                }

                case 'getBookmarks': {
                    sendResponse({ items: await kbAllBookmarks() });
                    break;
                }

                case 'getBookmark': {
                    sendResponse({ bookmark: await kbGetBookmark(request.id) });
                    break;
                }

                case 'isBookmarked': {
                    const url = normalizeUrl(request.url || '');
                    const found = url ? await kbFindByUrl(url) : null;
                    sendResponse({ bookmarked: !!found, id: found?.id || null });
                    break;
                }

                case 'deleteBookmark': {
                    await kbDeleteBookmark(request.id);
                    sendResponse({ ok: true });
                    break;
                }

                case 'clearBookmarks': {
                    await kbClearAll();
                    sendResponse({ ok: true });
                    break;
                }

                case 'searchKB': {
                    const query = (request.query || '').trim();
                    if (!query) { sendResponse({ items: await kbAllBookmarks() }); break; }
                    sendResponse({ items: await retrieveTopK(query, request.mode || 'hybrid', 20) });
                    break;
                }

                case 'reindexBookmark': {
                    await enrichBookmark(request.id);
                    sendResponse({ ok: true });
                    break;
                }

                case 'askKB': {
                    const { apiKey } = await getSettings();
                    if (!apiKey) { sendResponse({ error: 'OpenAI API key not set. Add it in Settings.' }); break; }
                    const question = (request.question || '').trim();
                    if (!question) { sendResponse({ error: 'Please enter a question.' }); break; }
                    const askId = 'ask:' + crypto.randomUUID();
                    sendResponse({ ok: true, askId });
                    runKBAsk(askId, question); // Continues after the response.
                    break;
                }

                case 'stopAsk': {
                    kbAsks.get(request.askId)?.controller.abort();
                    sendResponse({ ok: true });
                    break;
                }

                case 'getStats': {
                    const index = await getIndex();
                    const bookmarks = await kbAllBookmarks();
                    sendResponse({ chats: Object.keys(index).length, saved: bookmarks.length });
                    break;
                }

                case 'exportData': {
                    const index = await getIndex();
                    const conversations = [];
                    for (const id of Object.keys(index)) {
                        const conv = await getConv(id);
                        if (conv) conversations.push(conv);
                    }
                    // Deliberately excludes the API key and any other setting
                    // that would be unsafe to hand around in a plain file.
                    sendResponse({
                        data: {
                            exportedAt: new Date().toISOString(),
                            extensionVersion: chrome.runtime.getManifest().version,
                            conversations,
                            bookmarks: await kbAllBookmarksFull()
                        }
                    });
                    break;
                }

                case 'deleteAllData': {
                    for (const flight of kbAsks.values()) flight.controller.abort();
                    await clearAllConversations();
                    await kbClearAll();
                    await chrome.storage.local.remove('drafts');
                    queryEmbedCache.clear();
                    sendResponse({ ok: true });
                    break;
                }

                case 'testApiKey': {
                    const { apiKey, model } = await getSettings();
                    try {
                        await callOpenAI(apiKey, model, [{ role: 'user', content: 'Reply with OK.' }], null);
                        sendResponse({ success: true });
                    } catch (error) {
                        sendResponse({ success: false, error: error.message });
                    }
                    break;
                }

                default:
                    sendResponse({ error: `Unknown request type: ${request.type}` });
            }
        } catch (error) {
            console.error('Background handler error:', error);
            try { sendResponse({ error: error.message }); } catch {}
        }
    })();

    return true; // Asynchronous response.
});

chrome.runtime.onInstalled.addListener(details => {
    console.log(`Extension ${details.reason}: Version ${chrome.runtime.getManifest().version}`);
});
