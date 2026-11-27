// Knowledge-base retrieval: tokenization, BM25, relevance gating, rank fusion,
// passage chunking/selection, the IndexedDB index, and the v1 → v2 upgrade.
const assert = require('assert');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
const { loadBackground, createRunner } = require('./harness');

const { test, done } = createRunner();

// Arrays and typed arrays built inside the vm sandbox belong to another realm,
// which deepEqual treats as different — copy them out first.
const plain = (value) => JSON.parse(JSON.stringify(value));

function loadKb({ settings = {}, fetch } = {}) {
    const globals = { indexedDB: new IDBFactory(), IDBKeyRange };
    if (fetch) globals.fetch = fetch;
    const { sandbox } = loadBackground({ withKbDb: true, globals });
    sandbox.chrome.storage.sync.get = async () => ({ kbEmbeddingsEnabled: false, ...settings });
    return sandbox;
}

function bookmark(id, fields) {
    return {
        id, url: `https://example.com/${id}`, normalizedUrl: `https://example.com/${id}`,
        title: id, aiTitle: '', summary: '', tags: [], keywords: [], pageContent: '',
        contentType: 'page', createdAt: 1, updatedAt: 1, ...fields
    };
}

async function save(sb, b) {
    await sb.kbPutBookmark(b);
    await sb.kbIndexPut(b.id, sb.termCounts(b));
}

function jsonResponse(body) {
    return {
        ok: true, status: 200,
        headers: { get: () => 'application/json' },
        json: async () => body
    };
}

(async () => {

console.log('\ntokenize');
{
    const sb = loadKb();
    await test('folds accents', () => assert.deepEqual(plain(sb.tokenize('Café crème brûlée')), ['cafe', 'creme', 'brulee']));
    await test('keeps Cyrillic words and drops Cyrillic stopwords', () =>
        assert.deepEqual(plain(sb.tokenize('Привет мир если')), ['привет', 'мир']));
    await test('splits Japanese into bigrams', () =>
        assert.deepEqual(plain(sb.tokenize('東京タワー')), ['東京', '京タ', 'タワ', 'ワー']));
    await test('keeps Hangul syllables intact', () => assert.ok(sb.tokenize('안녕하세요').includes('안녕')));
    await test('keeps Japanese voicing marks', () => assert.ok(sb.tokenize('がっこう').includes('がっ')));
    await test('separates Latin and CJK runs in one word', () =>
        assert.deepEqual(plain(sb.tokenize('GPT検索')), ['gpt', '検索']));
    await test('drops question words', () =>
        assert.deepEqual(plain(sb.tokenize('What did the article say about sourdough?')), ['article', 'sourdough']));
}

console.log('\nscoreLexical (BM25)');
{
    const sb = loadKb();
    const postings = new Map([
        ['bread', [{ bookmarkId: 'a', tf: 2, len: 100 }, { bookmarkId: 'b', tf: 2, len: 100 }, { bookmarkId: 'c', tf: 2, len: 400 }]],
        ['hydration', [{ bookmarkId: 'a', tf: 2, len: 100 }]]
    ]);
    const scores = sb.scoreLexical(['bread', 'hydration'], postings, { docCount: 4, avgLen: 150 });
    await test('a rare term outweighs a common one', () => assert.ok(scores.get('a').score > scores.get('b').score));
    await test('longer documents are normalized down', () => assert.ok(scores.get('b').score > scores.get('c').score));
    await test('full coverage when every query term matches', () => assert.equal(scores.get('a').coverage, 1));
    await test('partial coverage is weighted by IDF', () => {
        const c = scores.get('b').coverage;
        assert.ok(c > 0 && c < 0.5, `coverage ${c}`);
    });
    const missing = sb.scoreLexical(['bread', 'zymurgy'], postings, { docCount: 4, avgLen: 150 });
    await test('a query term absent from the index lowers coverage', () => assert.ok(missing.get('a').coverage < 0.5));
}

console.log('\nrankResults');
{
    const sb = loadKb();
    const lex = new Map([['both', { score: 3, coverage: 0.9 }], ['lexOnly', { score: 5, coverage: 0.8 }], ['generic', { score: 9, coverage: 0.1 }]]);
    const sem = new Map([['both', 0.5], ['semOnly', 0.6], ['noise', 0.12]]);
    const hybrid = plain(sb.rankResults(lex, sem, 'hybrid')).map(r => r.id);
    await test('a document found by both methods ranks first', () => assert.equal(hybrid[0], 'both'));
    await test('weak semantic matches are dropped', () => assert.ok(!hybrid.includes('noise')));
    await test('matches on generic words only are dropped', () => assert.ok(!hybrid.includes('generic')));
    await test('nothing relevant gives no results', () =>
        assert.equal(sb.rankResults(new Map([['x', { score: 1, coverage: 0.1 }]]), new Map([['y', 0.1]]), 'hybrid').length, 0));
    await test('semantic mode falls back to keywords without vectors', () =>
        assert.deepEqual(plain(sb.rankResults(lex, new Map(), 'semantic')).map(r => r.id), ['lexOnly', 'both']));
}

console.log('\nchunkText');
{
    const sb = loadKb();
    const sentences = Array.from({ length: 120 }, (_, i) => `Sentence number ${i} talks about topic ${i}.`);
    const text = sentences.join(' ');
    const chunks = plain(sb.chunkText(text));
    await test('short text is one chunk', () => assert.deepEqual(plain(sb.chunkText('Just a line.')), ['Just a line.']));
    await test('splits long text into several chunks', () => assert.ok(chunks.length > 3));
    await test('chunks stay near the target size', () => assert.ok(chunks.every(c => c.length <= 1200), chunks.map(c => c.length).join()));
    await test('every sentence lands in some chunk, including the last', () =>
        assert.ok(sentences.every(s => chunks.some(c => c.includes(s)))));
    await test('neighbouring chunks overlap', () => {
        const lastOfFirst = chunks[0].split('. ').pop();
        assert.ok(chunks[1].includes(lastOfFirst.replace(/\.$/, '')));
    });
    await test('respects the chunk cap', () => assert.equal(sb.chunkText(text, 100, 0, 5).length, 5));
    const transcript = Array.from({ length: 60 }, (_, i) => `[${i}:00] spoken words for minute ${i} of the talk`).join('\n');
    await test('transcript stamps stay at line starts', () =>
        assert.ok(plain(sb.chunkText(transcript)).every(c => c.split('\n').every(line => /^\[\d+:00\]/.test(line)))));
}

console.log('\nselectPassages and Ask prompt');
{
    const sb = loadKb();
    const filler = Array.from({ length: 80 }, (_, i) => `Unrelated filler sentence ${i} about gardening.`).join(' ');
    const content = `${filler} The ideal dough hydration for this sourdough is seventy-five percent.`;
    const b = bookmark('bread', { pageContent: content, summary: 'A gardening blog post.' });

    const lexicalPick = plain(sb.selectPassages(b, [], null, plain(sb.tokenize('sourdough hydration'))));
    await test('keyword fallback finds a passage deep in the page', () =>
        assert.ok(lexicalPick.some(p => p.includes('seventy-five percent'))));

    const rows = [
        { n: 0, text: 'first', vector: Float32Array.from([1, 0]) },
        { n: 1, text: 'second', vector: Float32Array.from([0, 1]) },
        { n: 2, text: 'third', vector: Float32Array.from([0.9, 0.1]) }
    ];
    await test('vector selection picks the closest passages, in page order', () =>
        assert.deepEqual(plain(sb.selectPassages(b, rows, Float32Array.from([1, 0]), [], 2)), ['first', 'third']));
    await test('no signal falls back to the opening', () =>
        assert.deepEqual(plain(sb.selectPassages(bookmark('x', { pageContent: 'Alpha. ' + 'Beta. '.repeat(400) }), [], null, ['zzz'], 1)).length, 1));

    const messages = sb.buildAskMessages('What hydration?', [{ bookmark: b, passages: lexicalPick }]);
    await test('Ask quotes the matching passage, not just the summary', () =>
        assert.ok(messages[0].content.includes('seventy-five percent') && messages[0].content.includes('A gardening blog post.')));
}

console.log('\ninverted index');
{
    const sb = loadKb();
    await save(sb, bookmark('a', { title: 'Sourdough starter guide', pageContent: 'Feed the starter daily.' }));
    await save(sb, bookmark('b', { title: 'Starter motor repair', pageContent: 'Replace the solenoid.' }));
    const before = plain([...(await sb.kbIndexLookup(['starter'])).get('starter')].map(p => p.bookmarkId).sort());
    await test('both documents are indexed under a shared term', () => assert.deepEqual(before, ['a', 'b']));

    await sb.kbIndexPut('a', sb.termCounts(bookmark('a', { title: 'Rye bread', pageContent: 'Bake it hot.' })));
    const after = await sb.kbIndexLookup(['starter', 'sourdough', 'rye']);
    await test('re-indexing drops the old terms of that document only', () =>
        assert.deepEqual(plain(after.get('starter').map(p => p.bookmarkId)), ['b']));
    await test('a term left with no postings is deleted', () => assert.ok(!after.has('sourdough')));
    await test('new terms are added', () => assert.ok(after.has('rye')));

    await sb.kbDeleteBookmark('a');
    const afterDelete = await sb.kbIndexLookup(['rye']);
    await test('deleting removes its postings', () => assert.ok(!afterDelete.has('rye')));
    await test('corpus stats track indexed documents', async () => assert.equal((await sb.kbIndexStats()).docCount, 1));
}

console.log('\nchunks store');
{
    const sb = loadKb();
    await sb.kbPutBookmark(bookmark('a', {}));
    await sb.kbPutChunks('a', [0, 1, 2].map(n => ({ id: `a:${n}`, bookmarkId: 'a', n, text: `t${n}`, vector: Float32Array.from([n, 1]) })));
    await test('chunks are stored', async () => assert.equal((await sb.kbAllChunks()).length, 3));
    await sb.kbPutChunks('a', [{ id: 'a:0', bookmarkId: 'a', n: 0, text: 'only', vector: Float32Array.from([1, 1]) }]);
    await test('re-chunking replaces the old rows and the cache', async () =>
        assert.deepEqual(plain((await sb.kbAllChunks()).map(r => r.text)), ['only']));
    await sb.kbDeleteBookmark('a');
    await test('deleting a bookmark deletes its chunks', async () => assert.equal((await sb.kbAllChunks()).length, 0));
}

console.log('\nretrieveTopK (keywords only)');
{
    const sb = loadKb();
    await save(sb, bookmark('bread', { title: 'Sourdough hydration explained', pageContent: 'Hydration is the ratio of water to flour in sourdough.' }));
    await save(sb, bookmark('car', { title: 'Fixing a car starter', pageContent: 'The article explains the solenoid.' }));
    await save(sb, bookmark('cafe', { title: 'Café guide', pageContent: 'Où boire un café à Paris.' }));
    const hits = plain(await sb.retrieveTopK('What did the article say about sourdough hydration?', 'hybrid'));
    await test('returns the relevant page', () => assert.equal(hits[0]?.id, 'bread'));
    await test('skips a page that only shares a generic word', () => assert.ok(!hits.some(h => h.id === 'car')));
    await test('an unrelated question returns nothing', async () =>
        assert.equal((await sb.retrieveTopK('quantum chromodynamics lattice', 'hybrid')).length, 0));
    await test('accent-insensitive search', async () =>
        assert.equal(plain(await sb.retrieveTopK('cafe paris', 'lexical'))[0]?.id, 'cafe'));
}

console.log('\nenrichBookmark (stubbed OpenAI)');
{
    const late = 'The secret ingredient is smoked paprika.';
    const content = Array.from({ length: 60 }, (_, i) => `Filler sentence ${i} about nothing much.`).join(' ') + ' ' + late;
    const embedCalls = [];
    const sb = loadKb({
        settings: { openaiApiKey: 'sk-test', kbEmbeddingsEnabled: true },
        fetch: async (url, opts) => {
            const body = JSON.parse(opts.body);
            if (url.endsWith('/embeddings')) {
                embedCalls.push(body);
                const inputs = Array.isArray(body.input) ? body.input : [body.input];
                return jsonResponse({ data: inputs.map((text, index) => ({ index, embedding: [text.includes('paprika') ? 1 : 0, 1, 0] })) });
            }
            return jsonResponse({ choices: [{ message: { content: '{"title":"Stew","summary":"A stew.","tags":["food"],"keywords":["stew"]}' } }] });
        }
    });
    await sb.kbPutBookmark(bookmark('stew', { pageContent: content }));
    await sb.kbPutVector({ bookmarkId: 'stew', vector: Float32Array.from([1, 0, 0]) });
    await sb.enrichBookmark('stew');
    const chunks = await sb.kbGetChunks('stew');
    await test('embeds every passage in one batched request', () => {
        assert.equal(embedCalls.length, 1);
        assert.equal(embedCalls[0].input.length, chunks.length);
        assert.equal(embedCalls[0].dimensions, 512);
    });
    await test('passages cover the end of the page', () => assert.ok(chunks.some(c => c.text.includes(late))));
    await test('the superseded whole-document vector is removed', async () => assert.equal(await sb.kbGetVector('stew'), null));
    await test('AI metadata is indexed', async () => assert.ok((await sb.kbIndexLookup(['stew'])).has('stew')));
}

console.log('\nupgrade from schema v1');
{
    const factory = new IDBFactory();
    // Build a v1 database the way the previous release left it.
    await new Promise((resolve, reject) => {
        const req = factory.open('webpageKB', 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            const store = db.createObjectStore('bookmarks', { keyPath: 'id' });
            store.createIndex('normalizedUrl', 'normalizedUrl');
            store.createIndex('updatedAt', 'updatedAt');
            store.createIndex('createdAt', 'createdAt');
            db.createObjectStore('vectors', { keyPath: 'bookmarkId' });
            db.createObjectStore('invIndex', { keyPath: 'term' });
        };
        req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction(['bookmarks', 'invIndex'], 'readwrite');
            tx.objectStore('bookmarks').put(bookmark('old', { title: 'Crème brûlée', pageContent: 'Москва recipe' }));
            tx.objectStore('invIndex').put({ term: 'cr', postings: [{ bookmarkId: 'old', tf: 5 }] });
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
    });
    const { sandbox: sb } = loadBackground({ withKbDb: true, globals: { indexedDB: factory, IDBKeyRange } });
    const lookup = await sb.kbIndexLookup(['creme', 'москва', 'cr']);
    await test('rebuilds the index with the new tokenizer', () => assert.ok(lookup.has('creme') && lookup.has('москва')));
    await test('drops the old ASCII-only terms', () => assert.ok(!lookup.has('cr')));
    await test('postings carry document length', () => assert.ok(lookup.get('creme')[0].len > 0));
    await test('creates docTerms for the existing bookmark', async () => assert.equal((await sb.kbIndexStats()).docCount, 1));
}

done();
})();
