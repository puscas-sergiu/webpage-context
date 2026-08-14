'use strict';

// =============== DOM ===============
const els = {
    pageInfo: document.getElementById('page-info'),
    pageFavicon: document.getElementById('page-favicon'),
    pageTitle: document.getElementById('page-title'),
    newChatBtn: document.getElementById('new-chat-btn'),
    bookmarkBtn: document.getElementById('bookmark-btn'),
    navKb: document.getElementById('nav-kb'),
    navHistory: document.getElementById('nav-history'),
    navSettings: document.getElementById('nav-settings'),
    banner: document.getElementById('banner'),
    viewChat: document.getElementById('view-chat'),
    viewHistory: document.getElementById('view-history'),
    viewKb: document.getElementById('view-kb'),
    viewSettings: document.getElementById('view-settings'),
    kbTabBrowse: document.getElementById('kb-tab-browse'),
    kbTabAsk: document.getElementById('kb-tab-ask'),
    kbBrowse: document.getElementById('kb-browse'),
    kbAsk: document.getElementById('kb-ask'),
    kbSearch: document.getElementById('kb-search'),
    kbSearchMode: document.getElementById('kb-search-mode'),
    kbList: document.getElementById('kb-list'),
    kbAnswer: document.getElementById('kb-answer'),
    kbAskStatus: document.getElementById('kb-ask-status'),
    kbQuestion: document.getElementById('kb-question'),
    kbAskBtn: document.getElementById('kb-ask-btn'),
    kbAskIcon: document.getElementById('kb-ask-icon'),
    kbStopIcon: document.getElementById('kb-stop-icon'),
    chatMessages: document.getElementById('chat-messages'),
    statusBar: document.getElementById('status-bar'),
    chips: document.getElementById('chips'),
    userInput: document.getElementById('user-input'),
    sendBtn: document.getElementById('send-btn'),
    sendIcon: document.getElementById('send-icon'),
    stopIcon: document.getElementById('stop-icon'),
    historyList: document.getElementById('history-list'),
    clearHistoryBtn: document.getElementById('clear-history-btn'),
    apiKey: document.getElementById('api-key'),
    toggleKey: document.getElementById('toggle-key'),
    modelSelect: document.getElementById('model-select'),
    saveSettings: document.getElementById('save-settings'),
    settingsStatus: document.getElementById('settings-status'),
    kbEmbeddingsEnabled: document.getElementById('kb-embeddings-enabled'),
    dataStats: document.getElementById('data-stats'),
    exportData: document.getElementById('export-data'),
    deleteData: document.getElementById('delete-data'),
    versionLine: document.getElementById('version-line')
};

const ICONS = {
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>'
};

// =============== State ===============
let pageUrl = '';      // normalized URL of the active tab
let isYouTube = false;
let restricted = false;
let conv = null;       // conversation currently shown in the chat view
let generating = false;
let streamEl = null;   // element receiving the streamed response
let streamText = '';
let draftTimer = null;
let bookmarked = false;     // is the current page saved in the KB
let kbAskId = null;         // id of the in-flight "ask your KB" run
let kbAskText = '';         // streamed answer buffer
let kbSearchTimer = null;

// =============== Utilities ===============

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

function domainOf(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return url;
    }
}

function relTime(ts) {
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(ts).toLocaleDateString();
}

// Makes a non-button element behave like one for pointer *and* keyboard users.
function makeActivatable(el, onActivate) {
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.addEventListener('click', onActivate);
    el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onActivate();
        }
    });
}

// Two-step confirmation on a button: the first click arms it, a second within
// the timeout commits. Replaces window.confirm(), which can dismiss the popup.
function armConfirm(button, { armedLabel, restLabel, timeout = 3000, onConfirm }) {
    let timer = null;
    const disarm = () => {
        clearTimeout(timer);
        button.classList.remove('armed');
        button.textContent = restLabel;
    };
    button.addEventListener('click', async () => {
        if (!button.classList.contains('armed')) {
            button.classList.add('armed');
            button.textContent = armedLabel;
            timer = setTimeout(disarm, timeout);
            return;
        }
        disarm();
        await onConfirm();
    });
    return disarm;
}

function send(message) {
    return new Promise(resolve => {
        chrome.runtime.sendMessage(message, response => {
            void chrome.runtime.lastError;
            resolve(response);
        });
    });
}

// =============== Markdown (HTML-escaped, safe to inject) ===============

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderInline(text) {
    // Lift code spans out to placeholders first. Splitting on them instead would
    // scope the emphasis rules to each fragment, so a very common shape in model
    // output — **`fetch()` returns a promise** — would keep its literal asterisks.
    const codes = [];
    let s = String(text).replace(/`([^`]*)`/g, (_, code) => {
        codes.push(code);
        return `\u0000${codes.length - 1}\u0000`;
    });

    s = escapeHtml(s);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|\W)\*([^*\s](?:[^*]*[^*\s])?)\*/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // Placeholders survive escaping untouched (it only rewrites & < > ").
    return s.replace(/\u0000(\d+)\u0000/g,
        (_, index) => '<code>' + escapeHtml(codes[Number(index)]) + '</code>');
}

function renderMarkdown(text) {
    const lines = String(text).split('\n');
    let html = '';
    let para = [];
    let list = null; // 'ul' | 'ol'

    const flushPara = () => {
        if (para.length) {
            html += '<p>' + para.map(renderInline).join('<br>') + '</p>';
            para = [];
        }
    };
    const closeList = () => {
        if (list) {
            html += `</${list}>`;
            list = null;
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (/^\s*```/.test(line)) {
            flushPara(); closeList();
            const code = [];
            i++;
            while (i < lines.length && !/^\s*```/.test(lines[i])) {
                code.push(lines[i]);
                i++;
            }
            html += '<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>';
            continue;
        }

        const heading = line.match(/^(#{1,4})\s+(.+)/);
        if (heading) {
            flushPara(); closeList();
            const level = Math.min(heading[1].length + 2, 6);
            html += `<h${level}>${renderInline(heading[2])}</h${level}>`;
            continue;
        }

        const ul = line.match(/^\s*[-*•]\s+(.+)/);
        const ol = line.match(/^\s*\d+[.)]\s+(.+)/);
        if (ul || ol) {
            flushPara();
            const want = ul ? 'ul' : 'ol';
            if (list !== want) {
                closeList();
                html += `<${want}>`;
                list = want;
            }
            html += '<li>' + renderInline((ul || ol)[1]) + '</li>';
            continue;
        }

        const quote = line.match(/^>\s?(.*)/);
        if (quote) {
            flushPara(); closeList();
            html += '<blockquote>' + renderInline(quote[1]) + '</blockquote>';
            continue;
        }

        if (!line.trim()) {
            flushPara(); closeList();
            continue;
        }
        para.push(line);
    }
    flushPara(); closeList();
    return html;
}

// =============== Views ===============

function showView(name) {
    els.viewChat.classList.toggle('active', name === 'chat');
    els.viewHistory.classList.toggle('active', name === 'history');
    els.viewKb.classList.toggle('active', name === 'kb');
    els.viewSettings.classList.toggle('active', name === 'settings');

    for (const [button, view] of [[els.navKb, 'kb'], [els.navHistory, 'history'], [els.navSettings, 'settings']]) {
        button.classList.toggle('active', name === view);
        button.setAttribute('aria-pressed', String(name === view));
    }

    if (name === 'history') renderHistory();
    if (name === 'kb') renderKB();
    if (name === 'settings') refreshDataStats();
    if (name === 'chat' && !els.userInput.disabled) els.userInput.focus();
}

function currentView() {
    if (els.viewHistory.classList.contains('active')) return 'history';
    if (els.viewKb.classList.contains('active')) return 'kb';
    if (els.viewSettings.classList.contains('active')) return 'settings';
    return 'chat';
}

els.navKb.addEventListener('click', () =>
    showView(currentView() === 'kb' ? 'chat' : 'kb'));
els.navHistory.addEventListener('click', () =>
    showView(currentView() === 'history' ? 'chat' : 'history'));
els.navSettings.addEventListener('click', () =>
    showView(currentView() === 'settings' ? 'chat' : 'settings'));
els.pageInfo.addEventListener('click', () => showView('chat'));

function showBanner(text) {
    els.banner.textContent = text;
    els.banner.hidden = !text;
}

function showStatus(text, type = 'info') {
    els.statusBar.textContent = text;
    els.statusBar.className = `status-bar ${type}`;
    els.statusBar.hidden = !text;
}

// =============== Chat rendering ===============

function isNearBottom() {
    const c = els.chatMessages;
    return c.scrollHeight - c.scrollTop - c.clientHeight < 80;
}

function scrollToBottom(force = false) {
    if (force || isNearBottom()) {
        els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
    }
}

function addCopyButton(messageEl, text) {
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.title = 'Copy';
    btn.innerHTML = ICONS.copy;
    btn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(text);
            btn.innerHTML = ICONS.check;
            setTimeout(() => { btn.innerHTML = ICONS.copy; }, 1200);
        } catch { /* clipboard unavailable */ }
    });
    messageEl.appendChild(btn);
}

function appendMessage(role, content) {
    const empty = els.chatMessages.querySelector('.empty-state');
    if (empty) empty.remove();

    const el = document.createElement('div');
    el.className = `message ${role}`;
    if (role === 'assistant') {
        const body = document.createElement('div');
        body.className = 'md';
        body.innerHTML = renderMarkdown(content);
        el.appendChild(body);
        addCopyButton(el, content);
    } else {
        el.textContent = content;
    }
    els.chatMessages.appendChild(el);
    scrollToBottom(true);
    return el;
}

function appendTypingIndicator() {
    removeTypingIndicator();
    const el = document.createElement('div');
    el.className = 'message assistant typing';
    el.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    els.chatMessages.appendChild(el);
    scrollToBottom(true);
}

function removeTypingIndicator() {
    els.chatMessages.querySelector('.typing')?.remove();
}

function ensureStreamEl() {
    if (streamEl) return streamEl;
    removeTypingIndicator();
    streamEl = document.createElement('div');
    streamEl.className = 'message assistant streaming';
    const body = document.createElement('div');
    body.className = 'md';
    streamEl.appendChild(body);
    els.chatMessages.appendChild(streamEl);
    return streamEl;
}

function renderEmptyState() {
    els.chatMessages.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'empty-state';
    const what = isYouTube ? 'video' : 'page';
    el.innerHTML = `
        <div class="empty-icon">💬</div>
        <div class="empty-title">Chat with this ${what}</div>
        <div class="empty-sub">Summarize, ask questions, pull out key points.<br>Chats are saved locally per page.</div>`;
    els.chatMessages.appendChild(el);
}

function renderMessages() {
    els.chatMessages.innerHTML = '';
    streamEl = null;
    streamText = '';
    if (!conv || conv.messages.length === 0) {
        renderEmptyState();
        return;
    }
    for (const m of conv.messages) {
        if (m.role === 'user' || m.role === 'assistant') {
            appendMessage(m.role, m.content);
        }
    }
    scrollToBottom(true);
}

function setGenerating(on) {
    generating = on;
    els.sendIcon.hidden = on;
    els.stopIcon.hidden = !on;
    els.sendBtn.title = on ? 'Stop' : 'Send';
    els.chips.querySelectorAll('button').forEach(b => { b.disabled = on; });
    els.newChatBtn.disabled = on;
    if (!on) showStatus('');
}

// =============== Quick-action chips ===============

function buildChips() {
    els.chips.innerHTML = '';
    if (restricted && !conv) return;

    const chips = [];
    if (!restricted) {
        if (isYouTube) {
            chips.push({ label: '🎬 Summarize video', mode: 'summarizeVideo' });
            chips.push({ label: '🔑 Key takeaways', prompt: 'List the key takeaways from this video as concise bullets.' });
        } else {
            chips.push({ label: '📄 Summarize page', mode: 'summarize' });
            chips.push({ label: '🔑 Key points', prompt: 'List the key points of this page as concise bullets.' });
        }
        chips.push({ label: '🧒 Explain simply', prompt: 'Explain this content in simple terms, as if to someone new to the topic.' });
    }

    for (const chip of chips) {
        const btn = document.createElement('button');
        btn.className = 'chip';
        btn.textContent = chip.label;
        btn.disabled = generating;
        btn.addEventListener('click', () => generate(chip.mode || 'chat', chip.prompt));
        els.chips.appendChild(btn);
    }
}

// =============== Generation ===============

async function generate(mode, prompt) {
    if (generating) return;
    setGenerating(true);
    showStatus('Starting…', 'info');

    const response = await send({
        type: 'generate',
        mode,
        prompt,
        url: pageUrl,
        convId: conv?.id
    });

    if (!response || response.error) {
        setGenerating(false);
        const error = response?.error || 'Could not reach the background service.';
        showStatus(error, 'error');
        if (/API key/i.test(error)) showView('settings');
        return;
    }

    if (!conv) {
        conv = { id: response.convId, url: pageUrl, messages: [], pageContent: '', contentType: '' };
    }
    conv.id = response.convId;

    const visible = mode === 'summarize' ? 'Summarize this page'
        : mode === 'summarizeVideo' ? 'Summarize this video'
        : prompt;
    conv.messages.push({ role: 'user', content: visible, ts: Date.now() });
    appendMessage('user', visible);
    appendTypingIndicator();
}

function finishStream(content, cancelled) {
    removeTypingIndicator();
    setGenerating(false);
    if (content) {
        if (streamEl) {
            streamEl.classList.remove('streaming');
            streamEl.querySelector('.md').innerHTML = renderMarkdown(content);
            addCopyButton(streamEl, content);
        } else {
            appendMessage('assistant', content);
        }
        conv?.messages.push({ role: 'assistant', content, ts: Date.now() });
    } else if (cancelled) {
        showStatus('Stopped.', 'info');
        setTimeout(() => { if (!generating) showStatus(''); }, 1500);
    }
    streamEl = null;
    streamText = '';
    scrollToBottom();
}

chrome.runtime.onMessage.addListener((msg) => {
    if (!msg?.type?.startsWith('gen')) return;
    if (!conv || msg.convId !== conv.id) return;

    switch (msg.type) {
        case 'genStatus':
            showStatus(msg.status, 'info');
            break;
        case 'genDelta': {
            showStatus('');
            const el = ensureStreamEl();
            streamText += msg.delta;
            el.querySelector('.md').innerHTML = renderMarkdown(streamText);
            scrollToBottom();
            break;
        }
        case 'genDone':
            finishStream(msg.content, msg.cancelled);
            break;
        case 'genError':
            removeTypingIndicator();
            streamEl?.remove();
            streamEl = null;
            streamText = '';
            setGenerating(false);
            showStatus(msg.error || 'Something went wrong.', 'error');
            break;
    }
});

// =============== Composer ===============

function autosizeInput() {
    els.userInput.style.height = 'auto';
    els.userInput.style.height = Math.min(els.userInput.scrollHeight, 110) + 'px';
}

async function saveDraft() {
    const { drafts = {} } = await chrome.storage.local.get('drafts');
    const text = els.userInput.value;
    if (text.trim()) drafts[pageUrl] = text;
    else delete drafts[pageUrl];
    await chrome.storage.local.set({ drafts });
}

els.userInput.addEventListener('input', () => {
    autosizeInput();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 250);
});

els.userInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submitInput();
    }
});

els.sendBtn.addEventListener('click', () => {
    if (generating) {
        if (conv) send({ type: 'stop', convId: conv.id });
        return;
    }
    submitInput();
});

function submitInput() {
    if (generating) return;
    const text = els.userInput.value.trim();
    if (!text) return;
    els.userInput.value = '';
    autosizeInput();
    clearTimeout(draftTimer);
    saveDraft();
    generate('chat', text);
}

// =============== New chat ===============

els.newChatBtn.addEventListener('click', async () => {
    if (generating) return;
    const hadMessages = conv && conv.messages.length > 0;
    await send({ type: 'newChat', url: pageUrl });
    conv = null;
    showBanner('');
    renderMessages();
    buildChips();
    if (restricted) {
        els.userInput.disabled = true;
        els.userInput.placeholder = "This page can't be read — open History to revisit past chats.";
        els.sendBtn.disabled = true;
    }
    showView('chat');
    if (hadMessages) {
        showStatus('Previous chat kept in History.', 'info');
        setTimeout(() => { if (!generating) showStatus(''); }, 2000);
    }
});

// =============== History ===============

function historyGroup(ts) {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ts >= startOfDay) return 'Today';
    if (ts >= startOfDay - 86400000) return 'Yesterday';
    if (ts >= startOfDay - 6 * 86400000) return 'This week';
    return 'Earlier';
}

async function renderHistory() {
    const response = await send({ type: 'getHistory' });
    const items = response?.items || [];
    els.historyList.innerHTML = '';
    els.clearHistoryBtn.hidden = items.length === 0;

    if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = '<div class="empty-icon">🗂️</div><div class="empty-title">No saved chats yet</div><div class="empty-sub">Conversations are saved here automatically.</div>';
        els.historyList.appendChild(empty);
        return;
    }

    let lastGroup = '';
    for (const item of items) {
        const group = historyGroup(item.updatedAt);
        if (group !== lastGroup) {
            const head = document.createElement('div');
            head.className = 'history-group';
            head.textContent = group;
            els.historyList.appendChild(head);
            lastGroup = group;
        }

        const row = document.createElement('div');
        row.className = 'history-item';

        const icon = document.createElement('div');
        icon.className = 'history-icon';
        if (item.favIconUrl && /^https?:/.test(item.favIconUrl)) {
            const img = document.createElement('img');
            img.src = item.favIconUrl;
            img.alt = '';
            icon.appendChild(img);
        } else {
            icon.textContent = item.contentType === 'video' ? '🎬' : '📄';
        }

        const main = document.createElement('div');
        main.className = 'history-main';
        const title = document.createElement('div');
        title.className = 'history-title';
        title.textContent = item.title || domainOf(item.url);
        const meta = document.createElement('div');
        meta.className = 'history-meta';
        meta.textContent = `${domainOf(item.url)} · ${item.messageCount} message${item.messageCount === 1 ? '' : 's'} · ${relTime(item.updatedAt)}`;
        main.append(title, meta);

        const del = document.createElement('button');
        del.className = 'icon-btn history-delete';
        del.title = 'Delete chat';
        del.innerHTML = ICONS.trash;
        del.addEventListener('click', async (event) => {
            event.stopPropagation();
            if (!del.classList.contains('armed')) {
                del.classList.add('armed');
                del.title = 'Click again to confirm';
                setTimeout(() => {
                    del.classList.remove('armed');
                    del.title = 'Delete chat';
                }, 2000);
                return;
            }
            await send({ type: 'deleteConversation', convId: item.id });
            if (conv?.id === item.id) {
                conv = null;
                showBanner('');
                renderMessages();
            }
            renderHistory();
        });

        row.append(icon, main, del);
        makeActivatable(row, () => openConversation(item.id));
        els.historyList.appendChild(row);
    }
}

armConfirm(els.clearHistoryBtn, {
    restLabel: 'Clear all',
    armedLabel: 'Tap again to delete',
    onConfirm: async () => {
        await send({ type: 'clearAllConversations' });
        conv = null;
        showBanner('');
        renderMessages();
        renderHistory();
    }
});

async function openConversation(convId) {
    const response = await send({ type: 'getConversation', convId });
    if (!response?.conv) return;
    conv = response.conv;

    const foreign = conv.url !== pageUrl;
    if (!foreign) {
        await send({ type: 'setActive', url: pageUrl, convId: conv.id });
    }
    showBanner(foreign
        ? `Chat from ${domainOf(conv.url)} — replies use that page's saved content.`
        : '');

    renderMessages();
    setGenerating(false);
    buildChips();
    if (restricted) {
        // Continuing a saved chat works even here: replies use the stored content.
        els.userInput.disabled = false;
        els.sendBtn.disabled = false;
        els.userInput.placeholder = 'Ask about this chat…';
    }
    showView('chat');
    attachToFlight(response);
}

// Resume UI state for a generation that is already running in the background.
function attachToFlight(state) {
    if (!state.isGenerating) return;
    setGenerating(true);
    if (state.partial || streamText) {
        const el = ensureStreamEl();
        // Deltas may have arrived while the snapshot was in transit; keep the
        // longer buffer (genDone delivers the authoritative full text anyway).
        if ((state.partial || '').length > streamText.length) streamText = state.partial;
        el.querySelector('.md').innerHTML = renderMarkdown(streamText);
    } else {
        appendTypingIndicator();
    }
    if (state.status) showStatus(state.status, 'info');
    scrollToBottom(true);
}

// =============== Bookmarks / Knowledge Base ===============

function setBookmarked(on) {
    bookmarked = on;
    els.bookmarkBtn.classList.toggle('active', on);
    els.bookmarkBtn.setAttribute('aria-pressed', String(on));
    const label = on ? 'Saved — click to remove from Knowledge Base' : 'Save to Knowledge Base';
    els.bookmarkBtn.title = label;
    els.bookmarkBtn.setAttribute('aria-label', label);
}

async function refreshBookmarkState() {
    if (restricted) { els.bookmarkBtn.disabled = true; return; }
    const response = await send({ type: 'isBookmarked', url: pageUrl });
    setBookmarked(!!response?.bookmarked);
}

els.bookmarkBtn.addEventListener('click', async () => {
    if (els.bookmarkBtn.disabled) return;
    els.bookmarkBtn.disabled = true;
    if (bookmarked) {
        const state = await send({ type: 'isBookmarked', url: pageUrl });
        if (state?.id) await send({ type: 'deleteBookmark', id: state.id });
        setBookmarked(false);
        showStatus('Removed from Knowledge Base.', 'info');
    } else {
        const response = await send({ type: 'saveBookmark', url: pageUrl, convId: conv?.id });
        if (response?.ok) {
            setBookmarked(true);
            showStatus('Saved — indexing in the background…', 'info');
        } else {
            showStatus(response?.error || 'Could not save.', 'error');
        }
    }
    els.bookmarkBtn.disabled = false;
    setTimeout(() => { if (!generating) showStatus(''); }, 2000);
});

// --- Browse / Ask tabs ---
function showKBTab(tab) {
    const browse = tab === 'browse';
    els.kbTabBrowse.classList.toggle('active', browse);
    els.kbTabAsk.classList.toggle('active', !browse);
    els.kbTabBrowse.setAttribute('aria-pressed', String(browse));
    els.kbTabAsk.setAttribute('aria-pressed', String(!browse));
    els.kbBrowse.hidden = !browse;
    els.kbAsk.hidden = browse;
    if (!browse) els.kbQuestion.focus();
}
els.kbTabBrowse.addEventListener('click', () => showKBTab('browse'));
els.kbTabAsk.addEventListener('click', () => showKBTab('ask'));

async function renderKB() {
    const query = els.kbSearch.value.trim();
    const response = query
        ? await send({ type: 'searchKB', query, mode: els.kbSearchMode.value })
        : await send({ type: 'getBookmarks' });
    renderKBResults(response?.items || []);
}

function renderKBResults(items) {
    els.kbList.innerHTML = '';
    if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = els.kbSearch.value.trim()
            ? '<div class="empty-icon">🔍</div><div class="empty-title">No matches</div><div class="empty-sub">Try different words or another search mode.</div>'
            : '<div class="empty-icon">🔖</div><div class="empty-title">No saved pages yet</div><div class="empty-sub">Use the bookmark icon to save the current page.</div>';
        els.kbList.appendChild(empty);
        return;
    }

    for (const item of items) {
        const row = document.createElement('div');
        row.className = 'history-item';

        const icon = document.createElement('div');
        icon.className = 'history-icon';
        if (item.favIconUrl && /^https?:/.test(item.favIconUrl)) {
            const img = document.createElement('img');
            img.src = item.favIconUrl;
            img.alt = '';
            icon.appendChild(img);
        } else {
            icon.textContent = item.contentType === 'video' ? '🎬' : '📄';
        }

        const main = document.createElement('div');
        main.className = 'history-main';
        const title = document.createElement('div');
        title.className = 'history-title';
        title.textContent = item.aiTitle || item.title || domainOf(item.url);
        const meta = document.createElement('div');
        meta.className = 'history-meta';
        meta.textContent = `${domainOf(item.url)} · ${relTime(item.updatedAt)}`;
        main.append(title, meta);

        const snippet = item.snippet || item.summary;
        if (snippet) {
            const snip = document.createElement('div');
            snip.className = 'kb-snippet';
            snip.textContent = snippet;
            main.appendChild(snip);
        }
        if (item.tags && item.tags.length) {
            const tags = document.createElement('div');
            tags.className = 'kb-tags';
            for (const tag of item.tags.slice(0, 5)) {
                const chip = document.createElement('span');
                chip.className = 'kb-tag';
                chip.textContent = tag;
                tags.appendChild(chip);
            }
            main.appendChild(tags);
        }

        const del = document.createElement('button');
        del.className = 'icon-btn history-delete';
        del.title = 'Remove from Knowledge Base';
        del.innerHTML = ICONS.trash;
        del.addEventListener('click', async (event) => {
            event.stopPropagation();
            if (!del.classList.contains('armed')) {
                del.classList.add('armed');
                del.title = 'Click again to confirm';
                setTimeout(() => { del.classList.remove('armed'); del.title = 'Remove from Knowledge Base'; }, 2000);
                return;
            }
            await send({ type: 'deleteBookmark', id: item.id });
            if (normalizeUrl(item.url) === pageUrl) setBookmarked(false);
            renderKB();
        });

        row.append(icon, main, del);
        makeActivatable(row, () => chrome.tabs.create({ url: item.url }));
        els.kbList.appendChild(row);
    }
}

els.kbSearch.addEventListener('input', () => {
    clearTimeout(kbSearchTimer);
    kbSearchTimer = setTimeout(renderKB, 250);
});
els.kbSearchMode.addEventListener('change', renderKB);

// --- Ask your KB (RAG) ---
function setKBAsking(on) {
    els.kbAskIcon.hidden = on;
    els.kbStopIcon.hidden = !on;
    els.kbAskBtn.title = on ? 'Stop' : 'Ask';
    if (!on) { els.kbAskStatus.hidden = true; }
}

function submitKBQuestion() {
    const question = els.kbQuestion.value.trim();
    if (!question || kbAskId) return;
    els.kbQuestion.value = '';
    autosizeKBQuestion();
    askKB(question);
}

async function askKB(question) {
    kbAskText = '';
    els.kbAnswer.replaceChildren();

    const asked = document.createElement('div');
    asked.className = 'message user';
    asked.textContent = question;

    const typing = document.createElement('div');
    typing.className = 'message assistant typing';
    for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        dot.className = 'dot';
        typing.appendChild(dot);
    }
    els.kbAnswer.append(asked, typing);
    setKBAsking(true);
    const response = await send({ type: 'askKB', question });
    if (!response?.ok) {
        setKBAsking(false);
        els.kbAnswer.querySelector('.typing')?.remove();
        showKBStatus(response?.error || 'Could not reach the background service.', 'error');
        if (/API key/i.test(response?.error || '')) showView('settings');
        return;
    }
    kbAskId = response.askId;
}

function showKBStatus(text, type = 'info') {
    els.kbAskStatus.textContent = text;
    els.kbAskStatus.className = `status-bar ${type}`;
    els.kbAskStatus.hidden = !text;
}

function finishKBAnswer(content, sources, cancelled) {
    els.kbAnswer.querySelector('.typing')?.remove();
    setKBAsking(false);
    kbAskId = null;
    if (!content && cancelled) { showKBStatus('Stopped.', 'info'); return; }

    let answerEl = els.kbAnswer.querySelector('.kb-answer-body');
    if (!answerEl) {
        answerEl = document.createElement('div');
        answerEl.className = 'message assistant kb-answer-body';
        els.kbAnswer.appendChild(answerEl);
    }
    answerEl.classList.remove('streaming');
    answerEl.innerHTML = '<div class="md">' + renderMarkdown(content || '') + '</div>';

    if (sources && sources.length) {
        const list = document.createElement('div');
        list.className = 'kb-sources';
        list.innerHTML = '<div class="kb-sources-head">Sources</div>';
        for (const source of sources) {
            const link = document.createElement('a');
            link.className = 'kb-source';
            link.href = source.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = `[${source.n}] ${source.title}`;
            list.appendChild(link);
        }
        els.kbAnswer.appendChild(list);
    }
}

function ensureKBStreamEl() {
    let el = els.kbAnswer.querySelector('.kb-answer-body');
    if (el) return el;
    els.kbAnswer.querySelector('.typing')?.remove();
    el = document.createElement('div');
    el.className = 'message assistant streaming kb-answer-body';
    el.innerHTML = '<div class="md"></div>';
    els.kbAnswer.appendChild(el);
    return el;
}

// Listener for the "ask your KB" stream (reuses gen* messages keyed by askId).
chrome.runtime.onMessage.addListener((msg) => {
    if (!msg?.type?.startsWith('gen') || !kbAskId || msg.convId !== kbAskId) return;
    switch (msg.type) {
        case 'genStatus':
            showKBStatus(msg.status, 'info');
            break;
        case 'genDelta':
            showKBStatus('');
            kbAskText += msg.delta;
            ensureKBStreamEl().querySelector('.md').innerHTML = renderMarkdown(kbAskText);
            break;
        case 'genDone':
            finishKBAnswer(msg.content, msg.sources, msg.cancelled);
            break;
        case 'genError':
            els.kbAnswer.querySelector('.typing')?.remove();
            setKBAsking(false);
            kbAskId = null;
            showKBStatus(msg.error || 'Something went wrong.', 'error');
            break;
    }
});

// Background enrichment runs after a save completes; refresh the Browse list so
// the AI title, tags and snippet appear without the user reopening the view.
chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'kbEnrichDone' && currentView() === 'kb' && !els.kbBrowse.hidden) {
        renderKB();
    }
});

function autosizeKBQuestion() {
    els.kbQuestion.style.height = 'auto';
    els.kbQuestion.style.height = Math.min(els.kbQuestion.scrollHeight, 110) + 'px';
}
els.kbQuestion.addEventListener('input', autosizeKBQuestion);
els.kbQuestion.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submitKBQuestion();
    }
});
els.kbAskBtn.addEventListener('click', () => {
    if (kbAskId) { send({ type: 'stopAsk', askId: kbAskId }); return; }
    submitKBQuestion();
});

// =============== Settings ===============

els.toggleKey.addEventListener('click', () => {
    const revealed = els.apiKey.type === 'password';
    els.apiKey.type = revealed ? 'text' : 'password';
    els.toggleKey.setAttribute('aria-pressed', String(revealed));
    const label = revealed ? 'Hide API key' : 'Show API key';
    els.toggleKey.title = revealed ? 'Hide key' : 'Show key';
    els.toggleKey.setAttribute('aria-label', label);
});

els.saveSettings.addEventListener('click', async () => {
    const apiKey = els.apiKey.value.trim();
    if (!apiKey) {
        showSettingsStatus('Please enter an API key.', 'error');
        return;
    }
    await chrome.storage.sync.set({
        openaiApiKey: apiKey,
        model: els.modelSelect.value,
        kbEmbeddingsEnabled: els.kbEmbeddingsEnabled.checked
    });
    showSettingsStatus('Saved. Testing key…', 'info');
    els.saveSettings.disabled = true;
    const response = await send({ type: 'testApiKey' });
    els.saveSettings.disabled = false;
    if (response?.success) {
        showSettingsStatus('API key works! ✓', 'success');
    } else {
        showSettingsStatus(`Key test failed: ${response?.error || 'unknown error'}`, 'error');
    }
});

function showSettingsStatus(text, type) {
    els.settingsStatus.textContent = text;
    els.settingsStatus.className = `status-line ${type}`;
    els.settingsStatus.hidden = !text;
}

// =============== Settings · Your data ===============

function plural(count, noun) {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

async function refreshDataStats() {
    const response = await send({ type: 'getStats' });
    if (!response) {
        els.dataStats.textContent = 'Could not read local storage.';
        return;
    }
    els.dataStats.textContent = response.chats === 0 && response.saved === 0
        ? 'Nothing stored yet.'
        : `${plural(response.chats, 'chat')} · ${plural(response.saved, 'saved page')}`;
}

els.exportData.addEventListener('click', async () => {
    els.exportData.disabled = true;
    els.exportData.textContent = 'Exporting…';
    try {
        const response = await send({ type: 'exportData' });
        if (!response?.data) throw new Error(response?.error || 'Export failed.');

        const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `webpage-chat-export-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        showSettingsStatus('Exported. Your API key is not included.', 'success');
    } catch (error) {
        showSettingsStatus(error.message, 'error');
    }
    els.exportData.textContent = 'Export as JSON';
    els.exportData.disabled = false;
});

armConfirm(els.deleteData, {
    restLabel: 'Delete all data',
    armedLabel: 'Tap again to erase',
    onConfirm: async () => {
        const response = await send({ type: 'deleteAllData' });
        if (!response?.ok) {
            showSettingsStatus(response?.error || 'Could not delete data.', 'error');
            return;
        }
        conv = null;
        setBookmarked(false);
        showBanner('');
        renderMessages();
        await refreshDataStats();
        showSettingsStatus('All chats and saved pages deleted.', 'success');
    }
});

// =============== Init ===============

async function init() {
    els.versionLine.textContent = `Version ${chrome.runtime.getManifest().version}`;

    let tab = null;
    try {
        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (e) {
        console.error('Could not query active tab:', e);
    }

    const rawUrl = tab?.url || '';
    pageUrl = normalizeUrl(rawUrl);
    isYouTube = rawUrl.includes('youtube.com/watch');
    restricted = isRestrictedUrl(rawUrl);

    els.pageTitle.textContent = tab?.title || domainOf(rawUrl) || 'This page';
    if (tab?.favIconUrl && /^https?:/.test(tab.favIconUrl)) {
        els.pageFavicon.src = tab.favIconUrl;
        els.pageFavicon.hidden = false;
    }

    const settings = await chrome.storage.sync.get(['openaiApiKey', 'model', 'kbEmbeddingsEnabled']);
    if (settings.openaiApiKey) els.apiKey.value = settings.openaiApiKey;
    if (settings.model) els.modelSelect.value = settings.model;
    els.kbEmbeddingsEnabled.checked = settings.kbEmbeddingsEnabled !== false;

    const state = await send({ type: 'getState', url: pageUrl });
    conv = state?.conv || null;
    renderMessages();
    buildChips();

    if (restricted) {
        els.userInput.disabled = true;
        els.userInput.placeholder = "This page can't be read — open History to revisit past chats.";
        els.sendBtn.disabled = true;
    } else {
        const { drafts = {} } = await chrome.storage.local.get('drafts');
        if (drafts[pageUrl]) {
            els.userInput.value = drafts[pageUrl];
            autosizeInput();
        }
    }

    if (state) attachToFlight(state);

    refreshBookmarkState();

    if (!settings.openaiApiKey) {
        showView('settings');
        showSettingsStatus('Add your OpenAI API key to get started.', 'info');
        els.apiKey.focus();
    } else if (!restricted) {
        els.userInput.focus();
    }
}

init();
