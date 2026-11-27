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
const KB_DB_VERSION = 2;

let kbDbPromise = null;

// Builds a bookmark's term-frequency map for the lexical index. Registered by
// background.js (which owns tokenization) so an upgrade can rebuild the index.
let kbTermCounter = null;
function kbSetTermCounter(fn) { kbTermCounter = fn; }

// Opens (and caches) the database.
//   v1: bookmarks, vectors (one whole-document vector each), invIndex.
//   v2: + chunks   — one embedding per passage, so a whole page is searchable
//                    and Ask can quote the passages that match.
//       + docTerms — each bookmark's indexed terms and length, so removing a
//                    bookmark from the index touches only its own terms, and
//                    BM25 has the document lengths it needs.
//       The lexical index is rebuilt on upgrade: v1 tokenized ASCII only and
//       its postings carry no document length.
function kbOpen() {
    if (kbDbPromise) return kbDbPromise;
    kbDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(KB_DB_NAME, KB_DB_VERSION);
        let rebuildLexical = false;
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (event.oldVersion > 0 && event.oldVersion < 2) rebuildLexical = true;
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
            if (!db.objectStoreNames.contains('chunks')) {
                const chunks = db.createObjectStore('chunks', { keyPath: 'id' });
                chunks.createIndex('bookmarkId', 'bookmarkId', { unique: false });
            }
            if (!db.objectStoreNames.contains('docTerms')) {
                db.createObjectStore('docTerms', { keyPath: 'bookmarkId' });
            }
        };
        request.onsuccess = async () => {
            const db = request.result;
            if (rebuildLexical) {
                try {
                    await kbRebuildLexicalIndex(db);
                } catch (e) {
                    console.warn('Lexical index rebuild failed:', e);
                }
            }
            resolve(db);
        };
        request.onerror = () => reject(request.error);
    });
    return kbDbPromise;
}

// Rebuilds invIndex + docTerms from the stored bookmarks in one transaction.
// Takes the db handle directly because it runs while kbOpen is resolving.
async function kbRebuildLexicalIndex(db) {
    if (!kbTermCounter) return;
    const bookmarks = await kbReq(db.transaction('bookmarks', 'readonly').objectStore('bookmarks').getAll());
    const postings = new Map(); // term -> [{ bookmarkId, tf, len }]
    const docs = [];
    for (const bookmark of bookmarks || []) {
        const counts = kbTermCounter(bookmark);
        const len = kbDocLength(counts);
        docs.push({ bookmarkId: bookmark.id, terms: [...counts.keys()], len });
        for (const [term, tf] of counts) {
            if (!postings.has(term)) postings.set(term, []);
            postings.get(term).push({ bookmarkId: bookmark.id, tf, len });
        }
    }
    const tx = db.transaction(['invIndex', 'docTerms'], 'readwrite');
    const inv = tx.objectStore('invIndex');
    const docTerms = tx.objectStore('docTerms');
    inv.clear();
    docTerms.clear();
    for (const [term, list] of postings) inv.put({ term, postings: list });
    for (const doc of docs) docTerms.put(doc);
    await kbTxDone(tx);
}

function kbDocLength(counts) {
    let len = 0;
    for (const tf of counts.values()) len += tf;
    return len;
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
    await kbIndexRemove(id);
    const db = await kbOpen();
    const tx = db.transaction(['bookmarks', 'vectors'], 'readwrite');
    tx.objectStore('bookmarks').delete(id);
    tx.objectStore('vectors').delete(id);
    await kbTxDone(tx);
    await kbDeleteChunks(id);
}

async function kbClearAll() {
    const db = await kbOpen();
    const stores = ['bookmarks', 'vectors', 'invIndex', 'chunks', 'docTerms'];
    const tx = db.transaction(stores, 'readwrite');
    for (const name of stores) tx.objectStore(name).clear();
    await kbTxDone(tx);
    kbChunkCache = null;
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

async function kbDeleteVector(bookmarkId) {
    const db = await kbOpen();
    const tx = db.transaction('vectors', 'readwrite');
    tx.objectStore('vectors').delete(bookmarkId);
    await kbTxDone(tx);
}

// =============== Chunks (passage embeddings) ===============
// Each row is { id: '<bookmarkId>:<n>', bookmarkId, n, text, vector }.
// Every search compares the query against every chunk, so the full set is kept
// in memory and dropped whenever a chunk is written or deleted.

let kbChunkCache = null;

async function kbPutChunks(bookmarkId, rows) {
    const db = await kbOpen();
    const tx = db.transaction('chunks', 'readwrite');
    const store = tx.objectStore('chunks');
    const keys = await kbReq(store.index('bookmarkId').getAllKeys(bookmarkId));
    for (const key of keys || []) store.delete(key);
    for (const row of rows) store.put(row);
    await kbTxDone(tx);
    kbChunkCache = null;
}

async function kbDeleteChunks(bookmarkId) {
    const db = await kbOpen();
    const tx = db.transaction('chunks', 'readwrite');
    const store = tx.objectStore('chunks');
    const keys = await kbReq(store.index('bookmarkId').getAllKeys(bookmarkId));
    for (const key of keys || []) store.delete(key);
    await kbTxDone(tx);
    kbChunkCache = null;
}

async function kbGetChunks(bookmarkId) {
    const db = await kbOpen();
    const tx = db.transaction('chunks', 'readonly');
    const rows = (await kbReq(tx.objectStore('chunks').index('bookmarkId').getAll(bookmarkId))) || [];
    return rows.sort((a, b) => a.n - b.n);
}

async function kbAllChunks() {
    if (kbChunkCache) return kbChunkCache;
    const db = await kbOpen();
    const tx = db.transaction('chunks', 'readonly');
    kbChunkCache = (await kbReq(tx.objectStore('chunks').getAll())) || [];
    return kbChunkCache;
}

// =============== Inverted index (lexical search) ===============
// invIndex rows:  { term, postings: [{ bookmarkId, tf, len }] }
// docTerms rows:  { bookmarkId, terms: [term], len }
// `len` is the document's weighted term count, used by BM25 length
// normalization; df is simply postings.length.

// Replaces a bookmark's entry in the index. termCounts: Map<term, tf>.
async function kbIndexPut(bookmarkId, termCounts) {
    const counts = termCounts instanceof Map ? termCounts : new Map(termCounts);
    const db = await kbOpen();
    const tx = db.transaction(['invIndex', 'docTerms'], 'readwrite');
    const inv = tx.objectStore('invIndex');
    const docTerms = tx.objectStore('docTerms');
    const previous = await kbReq(docTerms.get(bookmarkId));
    const len = kbDocLength(counts);

    // Only the terms this bookmark had before or has now are touched.
    const touched = new Set([...(previous?.terms || []), ...counts.keys()]);
    for (const term of touched) {
        const row = (await kbReq(inv.get(term))) || { term, postings: [] };
        const postings = row.postings.filter(p => p.bookmarkId !== bookmarkId);
        const tf = counts.get(term);
        if (tf) postings.push({ bookmarkId, tf, len });
        if (postings.length) inv.put({ term, postings });
        else inv.delete(term);
    }
    if (counts.size) docTerms.put({ bookmarkId, terms: [...counts.keys()], len });
    else docTerms.delete(bookmarkId);
    await kbTxDone(tx);
}

async function kbIndexRemove(bookmarkId) {
    await kbIndexPut(bookmarkId, new Map());
}

// Corpus statistics for BM25: number of indexed documents and their mean length.
async function kbIndexStats() {
    const db = await kbOpen();
    const tx = db.transaction('docTerms', 'readonly');
    const rows = (await kbReq(tx.objectStore('docTerms').getAll())) || [];
    const total = rows.reduce((sum, row) => sum + (row.len || 0), 0);
    return { docCount: rows.length, avgLen: rows.length ? total / rows.length : 0 };
}

// Returns Map<term, postings[]> for the query terms that exist in the index.
async function kbIndexLookup(terms) {
    const out = new Map();
    if (!terms || !terms.length) return out;
    const db = await kbOpen();
    const tx = db.transaction('invIndex', 'readonly');
    const store = tx.objectStore('invIndex');
    for (const term of terms) {
        const row = await kbReq(store.get(term));
        if (row?.postings?.length) out.set(term, row.postings);
    }
    return out;
}
