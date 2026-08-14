// Preview-only stub of the chrome.* APIs the popup uses.
//
// Loaded *before* popup.js when rendering store screenshots, so the real popup
// code runs unmodified against scripted data. Never shipped in the extension —
// tools/ is excluded from the packaged zip.

(function () {
    'use strict';

    const SCENE = window.__SCENE || 'chat';

    const SUMMARY = [
        'The Fetch API provides a modern, promise-based interface for making HTTP requests from '
        + 'JavaScript, replacing the older `XMLHttpRequest` pattern.',
        '',
        '### Key points',
        '- **`fetch()` returns a promise** that resolves to a `Response` object as soon as headers arrive, not when the body finishes downloading.',
        '- **HTTP errors do not reject.** A 404 or 500 still resolves; check `response.ok` yourself.',
        '- **Bodies are streams** and can be read once via `.json()`, `.text()` or `.blob()`.',
        '- **`AbortController`** cancels an in-flight request, which is how timeouts are implemented.',
        '',
        'Use `credentials: "include"` when a request must carry cookies cross-origin.'
    ].join('\n');

    const BOOKMARKS = [
        {
            id: 'b1',
            url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch',
            title: 'Using the Fetch API',
            aiTitle: 'Fetch API: promises, streaming bodies and cancellation',
            contentType: 'page',
            updatedAt: Date.now() - 1000 * 60 * 8,
            summary: 'Reference for making HTTP requests with fetch(), covering response handling, '
                + 'why HTTP errors still resolve, and cancelling requests with AbortController.',
            tags: ['javascript', 'http', 'web api', 'async']
        },
        {
            id: 'b2',
            url: 'https://www.youtube.com/watch?v=example',
            title: 'Designing Data-Intensive Systems — full talk',
            aiTitle: 'Talk: trade-offs in replication, partitioning and consensus',
            contentType: 'video',
            updatedAt: Date.now() - 1000 * 60 * 60 * 5,
            summary: 'Conference talk walking through replication lag, partition strategies and when '
                + 'consensus protocols are worth their latency cost.',
            tags: ['distributed systems', 'databases', 'talk']
        },
        {
            id: 'b3',
            url: 'https://en.wikipedia.org/wiki/Vector_database',
            title: 'Vector database',
            aiTitle: 'Vector databases and approximate nearest-neighbour search',
            contentType: 'page',
            updatedAt: Date.now() - 1000 * 60 * 60 * 26,
            summary: 'Overview of storing embeddings for similarity search, including HNSW and IVF '
                + 'indexes and the recall/latency trade-off they expose.',
            tags: ['embeddings', 'search', 'indexing']
        },
        {
            id: 'b4',
            url: 'https://arxiv.org/abs/1706.03762',
            title: 'Attention Is All You Need',
            aiTitle: 'The transformer architecture, minus recurrence',
            contentType: 'page',
            updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
            summary: 'Introduces the transformer: self-attention replaces recurrence and convolution, '
                + 'giving far better parallelism during training.',
            tags: ['machine learning', 'transformers', 'paper']
        },
        {
            id: 'b5',
            url: 'https://en.wikipedia.org/wiki/Compiler',
            title: 'Compiler',
            aiTitle: 'How compilers lower source code to machine code',
            contentType: 'page',
            updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 9,
            summary: 'Front end, optimiser and back end: the standard pipeline from tokens through '
                + 'intermediate representations to target code.',
            tags: ['compilers', 'programming']
        }
    ];

    const HISTORY = [
        {
            id: 'c1', url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch',
            title: 'Using the Fetch API', favIconUrl: '', contentType: 'page',
            messageCount: 4, updatedAt: Date.now() - 1000 * 60 * 9
        },
        {
            id: 'c2', url: 'https://www.youtube.com/watch?v=example',
            title: 'Designing Data-Intensive Systems — full talk', favIconUrl: '', contentType: 'video',
            messageCount: 6, updatedAt: Date.now() - 1000 * 60 * 90
        },
        {
            id: 'c3', url: 'https://en.wikipedia.org/wiki/Vector_database',
            title: 'Vector database', favIconUrl: '', contentType: 'page',
            messageCount: 2, updatedAt: Date.now() - 1000 * 60 * 60 * 27
        },
        {
            id: 'c4', url: 'https://arxiv.org/abs/1706.03762',
            title: 'Attention Is All You Need', favIconUrl: '', contentType: 'page',
            messageCount: 8, updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 3
        },
        {
            id: 'c5', url: 'https://en.wikipedia.org/wiki/Compiler',
            title: 'Compiler', favIconUrl: '', contentType: 'page',
            messageCount: 3, updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 9
        }
    ];

    const TAB = {
        id: 1,
        url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch',
        title: 'Using the Fetch API - Web APIs | MDN',
        favIconUrl: ''
    };

    const CONVERSATION = {
        id: 'c1',
        url: TAB.url,
        title: TAB.title,
        contentType: 'page',
        pageContent: '…',
        messages: [
            { role: 'user', content: 'Summarize this page', ts: Date.now() - 60000 },
            { role: 'assistant', content: SUMMARY, ts: Date.now() - 55000 }
        ]
    };

    function respond(message) {
        switch (message.type) {
            case 'getState':
                return {
                    conv: SCENE === 'chat' ? CONVERSATION : null,
                    isGenerating: false, partial: '', status: ''
                };
            case 'getConversation':
                return { conv: CONVERSATION, isGenerating: false, partial: '', status: '' };
            case 'getHistory': return { items: HISTORY };
            case 'getBookmarks': return { items: BOOKMARKS };
            case 'searchKB': return { items: BOOKMARKS };
            case 'isBookmarked': return { bookmarked: true, id: 'b1' };
            case 'getStats': return { chats: HISTORY.length, saved: BOOKMARKS.length };
            case 'askKB': return { ok: true, askId: 'ask:preview' };
            default: return { ok: true };
        }
    }

    window.chrome = {
        runtime: {
            lastError: undefined,
            getManifest: () => ({ version: '2.2.0' }),
            sendMessage: (message, callback) => {
                const result = respond(message);
                if (callback) setTimeout(() => callback(result), 0);
                return Promise.resolve(result);
            },
            onMessage: { addListener: () => {} }
        },
        storage: {
            sync: {
                get: async () => ({
                    openaiApiKey: 'sk-proj-9Xq2LmT4vRw8pKdN3hYbZs',
                    model: 'gpt-5-nano-2025-08-07',
                    kbEmbeddingsEnabled: true
                }),
                set: async () => {}
            },
            local: {
                get: async () => ({ drafts: {} }),
                set: async () => {},
                remove: async () => {}
            }
        },
        tabs: {
            query: async () => [TAB],
            create: () => {}
        }
    };

    // Scene setup runs once the popup's own async init() has painted.
    const ANSWER = 'Both sources point the same way, for different reasons.\n\n'
        + '- **Recall degrades gracefully.** Approximate indexes trade a little accuracy for a large '
        + 'latency win, so tuning `efSearch` matters more than index choice [1].\n'
        + '- **Attention is the bottleneck at long context.** Cost grows quadratically with sequence '
        + 'length, which is why retrieval stays cheaper than simply extending the window [2].\n\n'
        + 'In short: retrieve a small, well-ranked set, then let the model reason over it.';

    const SOURCES = [
        { n: 1, id: 'b3', title: 'Vector databases and approximate nearest-neighbour search', url: BOOKMARKS[2].url },
        { n: 2, id: 'b4', title: 'The transformer architecture, minus recurrence', url: BOOKMARKS[3].url }
    ];

    window.addEventListener('load', () => {
        setTimeout(() => {
            if (SCENE === 'kb') {
                window.showView('kb');
            } else if (SCENE === 'ask') {
                window.showView('kb');
                window.showKBTab('ask');
                window.askKB('Is retrieval better than a bigger context window?');
                setTimeout(() => window.finishKBAnswer(ANSWER, SOURCES, false), 120);
            } else if (SCENE === 'history') {
                window.showView('history');
            } else if (SCENE === 'settings') {
                window.showView('settings');
            }
            document.documentElement.setAttribute('data-preview-ready', 'true');
        }, 250);
    });
}());
