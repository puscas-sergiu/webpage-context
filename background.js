// =============== Constants ===============
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-5-nano-2025-08-07';
const MAX_CONVERSATIONS = 100;   // pruned oldest-first beyond this
const MAX_HISTORY_MESSAGES = 24; // messages sent to the API per request

// In-flight generations, keyed by conversation id.
// { buffer, status, controller }
const inFlight = new Map();

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

async function getSettings() {
    const result = await chrome.storage.sync.get(['openaiApiKey', 'model']);
    return {
        apiKey: result.openaiApiKey || '',
        model: result.model || DEFAULT_MODEL
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

async function clickTranscriptButton() {
    const buttonSelector = 'button[aria-label="Show transcript"]';
    const transcriptPanelSelector = '#panels ytd-transcript-renderer, ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]';

    try {
        const transcriptPanel = document.querySelector(transcriptPanelSelector);
        if (transcriptPanel && transcriptPanel.checkVisibility && transcriptPanel.checkVisibility()) {
            return { success: true, alreadyOpen: true, message: "Transcript panel already open." };
        } else if (transcriptPanel && !transcriptPanel.checkVisibility) {
            const style = window.getComputedStyle(transcriptPanel);
            if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                return { success: true, alreadyOpen: true, message: "Transcript panel already open." };
            }
        }

        const descriptionContainer = document.querySelector('#description.ytd-watch-metadata, #description-inline-expander');
        if (!descriptionContainer) {
            const button = document.querySelector(buttonSelector);
            if (button) {
                button.click();
                return { success: true, alreadyOpen: false, message: "Clicked 'Show transcript' button." };
            }
            return { success: false, message: "Could not find the 'Show transcript' button." };
        }

        const button = descriptionContainer.querySelector(buttonSelector);
        if (button) {
            button.click();
            return { success: true, alreadyOpen: false, message: "Clicked 'Show transcript' button." };
        }

        const moreButton = descriptionContainer.querySelector('tp-yt-paper-button#expand, yt-button-shape button[aria-label="Show more"]');
        if (moreButton) {
            moreButton.click();
            await new Promise(resolve => setTimeout(resolve, 300));
            const buttonAfterMore = document.querySelector(buttonSelector);
            if (buttonAfterMore) {
                buttonAfterMore.click();
                return { success: true, alreadyOpen: false, message: "Clicked 'Show more', then 'Show transcript'." };
            }
            return { success: false, message: "Couldn't find the 'Show transcript' button after expanding the description." };
        }
        return { success: false, message: "Could not find the 'Show transcript' button." };
    } catch (error) {
        return { success: false, message: `Error during button click attempt: ${error.message}` };
    }
}

async function extractYouTubeCaptionText() {
    let transcriptText = '';
    const MAX_WAIT_MS = 3000;
    const CHECK_INTERVAL_MS = 500;
    let waitedMs = 0;

    try {
        const primarySelector = 'ytd-transcript-segment-renderer div.segment yt-formatted-string.segment-text';

        const performExtraction = () => {
            const segments = document.querySelectorAll(primarySelector);
            if (segments && segments.length > 0) {
                return Array.from(segments).map(seg => seg.textContent || '').join(' ').trim();
            }
            const fallbackSelector = 'ytd-transcript-body-renderer .cue-group yt-formatted-string';
            const fallbackSegments = document.querySelectorAll(fallbackSelector);
            if (fallbackSegments && fallbackSegments.length > 0) {
                return Array.from(fallbackSegments).map(seg => seg.textContent || '').join(' ').trim();
            }
            return null;
        };

        transcriptText = performExtraction();
        while (transcriptText === null && waitedMs < MAX_WAIT_MS) {
            await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
            waitedMs += CHECK_INTERVAL_MS;
            transcriptText = performExtraction();
        }

        if (transcriptText === null || transcriptText === '') {
            transcriptText = "[Could not automatically extract the YouTube transcript. It may be unavailable, or the page structure may have changed — try opening the transcript panel manually.]";
        }
    } catch (e) {
        transcriptText = `[Error trying to extract YouTube transcript: ${e.message}]`;
    }

    if (transcriptText && !transcriptText.startsWith("[")) {
        transcriptText = transcriptText.replace(/\s\s+/g, ' ').trim();
        const MAX_CONTENT_LENGTH = 24000;
        if (transcriptText.length > MAX_CONTENT_LENGTH) {
            transcriptText = transcriptText.substring(0, MAX_CONTENT_LENGTH) + "... [Transcript Truncated]";
        }
    }

    return transcriptText || "[No transcript text found or extracted.]";
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

    if (conv.pageContent && !conv.pageContent.startsWith('[')) {
        system += isVideo
            ? `\n\nVideo transcript:\n"""\n${conv.pageContent}\n"""`
            : `\n\nExtracted page content:\n"""\n${conv.pageContent}\n"""`;
    } else {
        system += `\n\nNote: the page content could not be extracted${conv.pageContent ? ` (${conv.pageContent})` : ''}. Answer from the URL/title and general knowledge, and say when you are unsure.`;
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

// Extracts (or re-extracts) page/video content into the conversation when needed.
// Chat messages reuse previously stored content; summarize actions always refresh it.
async function ensureContext(conv, mode, tab, setStatus) {
    const wantVideo = mode === 'summarizeVideo';
    const isSummarizeAction = mode === 'summarize' || wantVideo;
    if (conv.pageContent && !isSummarizeAction) return;

    const tabUrl = tab?.url || '';
    if (!tab?.id || normalizeUrl(tabUrl) !== conv.url || isRestrictedUrl(tabUrl)) {
        return; // Can't extract from this tab; rely on stored content if any.
    }

    if (wantVideo) {
        setStatus('Opening video transcript…');
        try {
            const clickResults = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: clickTranscriptButton
            });
            const result = clickResults?.[0]?.result;
            if (result && !result.success) {
                setStatus('Transcript panel not found, trying to read it anyway…');
            }
        } catch (e) {
            console.warn('Transcript button click failed:', e);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        setStatus('Reading transcript…');
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractYouTubeCaptionText
        });
        conv.pageContent = typeof results?.[0]?.result === 'string'
            ? results[0].result
            : '[Could not extract transcript.]';
        conv.contentType = 'video';
    } else {
        setStatus('Reading page…');
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractPageContent
        });
        conv.pageContent = typeof results?.[0]?.result === 'string'
            ? results[0].result
            : '[Could not extract page content.]';
        conv.contentType = 'page';
    }
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
                            contentType: ''
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
