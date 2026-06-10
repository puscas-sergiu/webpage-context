'use strict';

// =============== DOM ===============
const els = {
    pageInfo: document.getElementById('page-info'),
    pageFavicon: document.getElementById('page-favicon'),
    pageTitle: document.getElementById('page-title'),
    newChatBtn: document.getElementById('new-chat-btn'),
    navHistory: document.getElementById('nav-history'),
    navSettings: document.getElementById('nav-settings'),
    banner: document.getElementById('banner'),
    viewChat: document.getElementById('view-chat'),
    viewHistory: document.getElementById('view-history'),
    viewSettings: document.getElementById('view-settings'),
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
    settingsStatus: document.getElementById('settings-status')
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
    // Tokenize code spans first so other inline rules don't touch them.
    return text.split(/(`[^`]*`)/).map(part => {
        if (part.length > 1 && part.startsWith('`') && part.endsWith('`')) {
            return '<code>' + escapeHtml(part.slice(1, -1)) + '</code>';
        }
        let s = escapeHtml(part);
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/(^|\W)\*([^*\s](?:[^*]*[^*\s])?)\*/g, '$1<em>$2</em>');
        s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
            '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        return s;
    }).join('');
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
    els.viewSettings.classList.toggle('active', name === 'settings');
    els.navHistory.classList.toggle('active', name === 'history');
    els.navSettings.classList.toggle('active', name === 'settings');
    if (name === 'history') renderHistory();
    if (name === 'chat') els.userInput.focus();
}

function currentView() {
    if (els.viewHistory.classList.contains('active')) return 'history';
    if (els.viewSettings.classList.contains('active')) return 'settings';
    return 'chat';
}

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
        row.addEventListener('click', () => openConversation(item.id));
        els.historyList.appendChild(row);
    }
}

els.clearHistoryBtn.addEventListener('click', async () => {
    if (!confirm('Delete all saved chats? This cannot be undone.')) return;
    await send({ type: 'clearAllConversations' });
    conv = null;
    showBanner('');
    renderMessages();
    renderHistory();
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

// =============== Settings ===============

els.toggleKey.addEventListener('click', () => {
    els.apiKey.type = els.apiKey.type === 'password' ? 'text' : 'password';
});

els.saveSettings.addEventListener('click', async () => {
    const apiKey = els.apiKey.value.trim();
    if (!apiKey) {
        showSettingsStatus('Please enter an API key.', 'error');
        return;
    }
    await chrome.storage.sync.set({ openaiApiKey: apiKey, model: els.modelSelect.value });
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

// =============== Init ===============

async function init() {
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

    const settings = await chrome.storage.sync.get(['openaiApiKey', 'model']);
    if (settings.openaiApiKey) els.apiKey.value = settings.openaiApiKey;
    if (settings.model) els.modelSelect.value = settings.model;

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

    if (!settings.openaiApiKey) {
        showView('settings');
        showSettingsStatus('Add your OpenAI API key to get started.', 'info');
    } else if (!restricted) {
        els.userInput.focus();
    }
}

init();
