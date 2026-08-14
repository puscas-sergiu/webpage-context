const assert = require('assert');
const { loadBackground, createRunner } = require('./harness');

const { test, done } = createRunner();

// Replaces chrome.scripting.executeScript with a scripted responder.
function withScripting(sandbox, responder) {
    const calls = [];
    sandbox.chrome.scripting.executeScript = async (opts) => {
        calls.push({ world: opts.world, func: opts.func?.name });
        const result = responder(opts, calls.length);
        if (result instanceof Error) throw result;
        return [{ result }];
    };
    return calls;
}

const VIDEO_TAB = { id: 1, url: 'https://www.youtube.com/watch?v=abc_123&t=90s' };
const PAGE_TAB = { id: 1, url: 'https://example.com/article' };

(async () => {

console.log('\nextractForUrl');
{
    const { sandbox } = loadBackground();
    const calls = withScripting(sandbox, () => ({ status: 'ok', text: '[0:00] hi', note: '', source: 'captions', segments: 1, language: 'en' }));
    const out = await sandbox.extractForUrl(VIDEO_TAB, true);
    await test('injects into the MAIN world first', () => assert.equal(calls[0].world, 'MAIN'));
    await test('injects the transcript extractor', () => assert.equal(calls[0].func, 'extractYouTubeTranscript'));
    await test('does not retry after a verdict', () => assert.equal(calls.length, 1));
    await test('returns video content', () => assert.deepEqual(out, { content: '[0:00] hi', contentType: 'video', contentStatus: 'ok', contentNote: '' }));
}
{
    const { sandbox } = loadBackground();
    const calls = withScripting(sandbox, (opts) => opts.world === 'MAIN'
        ? new Error('cannot access a chrome:// URL')
        : { status: 'ok', text: '[0:00] from isolated', note: '', source: 'panel', segments: 1, language: '' });
    const out = await sandbox.extractForUrl(VIDEO_TAB, true);
    await test('falls back to the isolated world', () => assert.equal(calls[1]?.world, 'ISOLATED'));
    await test('isolated result used', () => assert.equal(out.content, '[0:00] from isolated'));
}
{
    const { sandbox } = loadBackground();
    withScripting(sandbox, () => new Error('injection blocked'));
    const out = await sandbox.extractForUrl(VIDEO_TAB, true);
    await test('total failure reports an error status', () => assert.equal(out.contentStatus, 'error'));
    await test('total failure carries a note', () => assert.ok(out.contentNote.length > 0));
    await test('total failure keeps the video type', () => assert.equal(out.contentType, 'video'));
}
{
    const { sandbox } = loadBackground();
    const calls = withScripting(sandbox, () => 'Article body text');
    const out = await sandbox.extractForUrl(PAGE_TAB, false);
    await test('page extraction stays in the isolated world', () => assert.equal(calls[0].world, undefined));
    await test('page extractor injected', () => assert.equal(calls[0].func, 'extractPageContent'));
    await test('page content returned', () => assert.deepEqual(out, { content: 'Article body text', contentType: 'page', contentStatus: 'ok', contentNote: '' }));
}
{
    const { sandbox } = loadBackground();
    withScripting(sandbox, () => '[Could not extract meaningful content.]');
    const out = await sandbox.extractForUrl(PAGE_TAB, false);
    await test('page placeholder becomes an error status', () => assert.equal(out.contentStatus, 'error'));
    await test('page placeholder is not stored as content', () => assert.equal(out.content, ''));
}

console.log('\nensureContext');
const convFor = (extra) => ({ id: 'c1', url: 'https://www.youtube.com/watch?v=abc_123', messages: [], pageContent: '', contentType: '', ...extra });

{
    const { sandbox } = loadBackground();
    const calls = withScripting(sandbox, () => ({ status: 'ok', text: '[0:00] transcript', source: 'captions', segments: 1 }));
    const conv = convFor();
    await sandbox.ensureContext(conv, 'chat', VIDEO_TAB);
    await test('a plain chat on a video reads the transcript, not the page', () => assert.equal(calls[0].func, 'extractYouTubeTranscript'));
    await test('content type is video', () => assert.equal(conv.contentType, 'video'));
    await test('transcript stored', () => assert.equal(conv.pageContent, '[0:00] transcript'));
    await test('resume timestamp does not break the URL match', () => assert.equal(calls.length, 1));
}
{
    const { sandbox } = loadBackground();
    const calls = withScripting(sandbox, () => ({ status: 'ok', text: '[0:00] fresh', source: 'captions', segments: 1 }));
    // A conversation whose content was captured by the page extractor (the old bug).
    const conv = convFor({ pageContent: 'Subscribe Share Comments...', contentType: 'page', contentStatus: 'ok' });
    await sandbox.ensureContext(conv, 'chat', VIDEO_TAB);
    await test('page content on a video is re-extracted', () => assert.equal(calls.length, 1));
    await test('replaced with the transcript', () => assert.equal(conv.pageContent, '[0:00] fresh'));
}
{
    const { sandbox } = loadBackground();
    const calls = withScripting(sandbox, () => ({ status: 'ok', text: 'x', source: 'captions', segments: 1 }));
    const conv = convFor({ pageContent: '[0:00] already have this', contentType: 'video', contentStatus: 'ok' });
    await sandbox.ensureContext(conv, 'chat', VIDEO_TAB);
    await test('good transcript is reused for chat', () => assert.equal(calls.length, 0));
    await sandbox.ensureContext(conv, 'summarizeVideo', VIDEO_TAB);
    await test('summarize always refreshes', () => assert.equal(calls.length, 1));
}
{
    const { sandbox } = loadBackground();
    const calls = withScripting(sandbox, () => ({ status: 'error', text: '', note: 'no captions' }));
    const conv = convFor();
    await sandbox.ensureContext(conv, 'chat', VIDEO_TAB);
    await sandbox.ensureContext(conv, 'chat', VIDEO_TAB);
    await sandbox.ensureContext(conv, 'chat', VIDEO_TAB);
    await test('a failing extraction is retried once, then left alone', () => assert.equal(calls.length, 2));
    await sandbox.ensureContext(conv, 'summarizeVideo', VIDEO_TAB);
    await test('an explicit summarize still retries', () => assert.equal(calls.length, 3));
}
{
    const { sandbox } = loadBackground();
    withScripting(sandbox, () => ({ status: 'error', text: '', note: 'transient failure' }));
    const conv = convFor({ pageContent: '[0:00] good transcript', contentType: 'video', contentStatus: 'ok' });
    await sandbox.ensureContext(conv, 'summarizeVideo', VIDEO_TAB);
    await test('a failed refresh does not wipe good content', () => assert.equal(conv.pageContent, '[0:00] good transcript'));
}
{
    const { sandbox } = loadBackground();
    const calls = withScripting(sandbox, () => 'other page');
    const conv = convFor();
    await sandbox.ensureContext(conv, 'chat', { id: 2, url: 'https://example.com/other' });
    await test('a tab showing another URL is never scraped', () => assert.equal(calls.length, 0));
    await sandbox.ensureContext(conv, 'chat', null);
    await test('a missing tab is handled', () => assert.equal(calls.length, 0));
}
{
    const { sandbox } = loadBackground();
    const calls = withScripting(sandbox, () => 'restricted');
    const conv = { id: 'c2', url: 'chrome://settings', messages: [], pageContent: '', contentType: '' };
    await sandbox.ensureContext(conv, 'summarize', { id: 3, url: 'chrome://settings' });
    await test('restricted URLs are never scraped', () => assert.equal(calls.length, 0));
}
{
    const { sandbox } = loadBackground();
    const calls = withScripting(sandbox, () => ({ status: 'ok', text: '[0:00] shorts', source: 'captions', segments: 1 }));
    const conv = { id: 'c3', url: 'https://www.youtube.com/watch?v=short1', messages: [], pageContent: '', contentType: '' };
    await sandbox.ensureContext(conv, 'chat', { id: 4, url: 'https://www.youtube.com/shorts/short1' });
    await test('Shorts are treated as videos', () => assert.equal(calls[0]?.func, 'extractYouTubeTranscript'));
    await test('Shorts URL matches the canonical conversation', () => assert.equal(conv.pageContent, '[0:00] shorts'));
}

done();
})();
