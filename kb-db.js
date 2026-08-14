// =============== kb-db.js ===============
// IndexedDB wrapper for the Knowledge Base (bookmarks + vectors + lexical index).
// Loaded by the service worker via importScripts('kb-db.js'), so everything here
// attaches to the worker's global scope — no exports/modules.
//
// Why IndexedDB (not chrome.storage.local): embeddings vectors and extracted page
// text are large; chrome.storage.local has a ~10MB cap and forces whole-key
// read-modify-write. IndexedDB (with the unlimitedStorage permission) is
// effectively unbounded, has native indexes/cursors, and preserves Float32Array
// via structured clone (~6KB/vector instead of ~30KB as a JSON number array).

const KB_DB_NAME = 'webpageKB';
const KB_DB_VERSION = 1;

let kbDbPromise = null;

// Opens (and caches) the database. v1 creates all three stores up front —
// including `vectors`, which Phase 1 doesn't use — to avoid a later upgrade.
function kbOpen() {
    if (kbDbPromise) return kbDbPromise;
    kbDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(KB_DB_NAME, KB_DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('bookmarks')) {
                const store = db.createObjectStore('bookmarks', { keyPath: 'id' });
                store.createIndex('normalizedUrl', 'normalizedUrl', { unique: false });
                store.createIndex('updatedAt', 'updatedAt', { unique: false });
                store.createIndex('createdAt', 'createdAt', { unique: false });
            }
            if (!db.objectStoreNames.contains('vectors')) {
                db.createObjectStore('vectors', { keyPath: 'bookmarkId' });
            }
            if (!db.objectStoreNames.contains('invIndex')) {
                db.createObjectStore('invIndex', { keyPath: 'term' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    return kbDbPromise;
}

// Wraps a transaction request in a promise.
function kbReq(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Resolves when the whole transaction commits (needed when we issue several
// writes and only care that they all landed).
function kbTxDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

// =============== Bookmarks ===============

async function kbPutBookmark(bookmark) {
    const db = await kbOpen();
    const tx = db.transaction('bookmarks', 'readwrite');
    tx.objectStore('bookmarks').put(bookmark);
    await kbTxDone(tx);
    return bookmark;
}

async function kbGetBookmark(id) {
    if (!id) return null;
    const db = await kbOpen();
    const tx = db.transaction('bookmarks', 'readonly');
    return (await kbReq(tx.objectStore('bookmarks').get(id))) || null;
}

async function kbFindByUrl(normalizedUrl) {
    if (!normalizedUrl) return null;
    const db = await kbOpen();
    const tx = db.transaction('bookmarks', 'readonly');
    const index = tx.objectStore('bookmarks').index('normalizedUrl');
    return (await kbReq(index.get(normalizedUrl))) || null;
}

// Returns lightweight metadata for list views (projects out the heavy
// pageContent field) sorted newest-updated first.
async function kbAllBookmarks() {
    const db = await kbOpen();
    const tx = db.transaction('bookmarks', 'readonly');
    const store = tx.objectStore('bookmarks');
    const items = [];
    await new Promise((resolve, reject) => {
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) { resolve(); return; }
            const { pageContent, ...meta } = cursor.value;
            items.push(meta);
            cursor.continue();
        };
        cursorReq.onerror = () => reject(cursorReq.error);
    });
    items.sort((a, b) => b.updatedAt - a.updatedAt);
    return items;
}

// Full records, including the heavy pageContent field. Used by the data export
// in Settings, which should hand back everything the extension stored.
async function kbAllBookmarksFull() {
    const db = await kbOpen();
    const tx = db.transaction('bookmarks', 'readonly');
    return (await kbReq(tx.objectStore('bookmarks').getAll())) || [];
}

async function kbDeleteBookmark(id) {
    const db = await kbOpen();
    const tx = db.transaction(['bookmarks', 'vectors'], 'readwrite');
    tx.objectStore('bookmarks').delete(id);
    tx.objectStore('vectors').delete(id);
    await kbTxDone(tx);
    await kbIndexRemove(id);
}

async function kbClearAll() {
    const db = await kbOpen();
    const tx = db.transaction(['bookmarks', 'vectors', 'invIndex'], 'readwrite');
    tx.objectStore('bookmarks').clear();
    tx.objectStore('vectors').clear();
    tx.objectStore('invIndex').clear();
    await kbTxDone(tx);
}

// =============== Vectors ===============

async function kbPutVector(row) {
    const db = await kbOpen();
    const tx = db.transaction('vectors', 'readwrite');
    tx.objectStore('vectors').put(row);
    await kbTxDone(tx);
    return row;
}

async function kbGetVector(bookmarkId) {
    if (!bookmarkId) return null;
    const db = await kbOpen();
    const tx = db.transaction('vectors', 'readonly');
    return (await kbReq(tx.objectStore('vectors').get(bookmarkId))) || null;
}

async function kbAllVectors() {
    const db = await kbOpen();
    const tx = db.transaction('vectors', 'readonly');
    return (await kbReq(tx.objectStore('vectors').getAll())) || [];
}

// =============== Inverted index (lexical search) ===============
// Each row is { term, postings: [{ bookmarkId, tf }] }.

async function kbIndexAdd(bookmarkId, termCounts) {
    // termCounts: Map<term, tf> or array of [term, tf].
    const entries = termCounts instanceof Map ? [...termCounts] : termCounts;
    if (!entries.length) return;
    const db = await kbOpen();
    const tx = db.transaction('invIndex', 'readwrite');
    const store = tx.objectStore('invIndex');
    for (const [term, tf] of entries) {
        const existing = (await kbReq(store.get(term))) || { term, postings: [] };
        existing.postings = existing.postings.filter(p => p.bookmarkId !== bookmarkId);
        existing.postings.push({ bookmarkId, tf });
        store.put(existing);
    }
    await kbTxDone(tx);
}

async function kbIndexRemove(bookmarkId) {
    const db = await kbOpen();
    const tx = db.transaction('invIndex', 'readwrite');
    const store = tx.objectStore('invIndex');
    await new Promise((resolve, reject) => {
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) { resolve(); return; }
            const row = cursor.value;
            const next = row.postings.filter(p => p.bookmarkId !== bookmarkId);
            if (next.length !== row.postings.length) {
                if (next.length) cursor.update({ ...row, postings: next });
                else cursor.delete();
            }
            cursor.continue();
        };
        cursorReq.onerror = () => reject(cursorReq.error);
    });
    await kbTxDone(tx);
}

// Looks up postings for the given query terms. Returns Map<bookmarkId, {score, hits}>
// where score sums tf across matched terms and hits counts distinct matched terms.
async function kbIndexLookup(terms) {
    if (!terms || !terms.length) return new Map();
    const db = await kbOpen();
    const tx = db.transaction('invIndex', 'readonly');
    const store = tx.objectStore('invIndex');
    const acc = new Map();
    for (const term of terms) {
        const row = await kbReq(store.get(term));
        if (!row) continue;
        for (const posting of row.postings) {
            const cur = acc.get(posting.bookmarkId) || { score: 0, hits: 0 };
            cur.score += posting.tf;
            cur.hits += 1;
            acc.set(posting.bookmarkId, cur);
        }
    }
    return acc;
}
