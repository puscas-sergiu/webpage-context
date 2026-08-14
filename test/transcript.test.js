const assert = require('assert');
const { loadBackground, readFixture, createRunner } = require('./harness');

const MODERN = readFixture('transcript-modern-panel.html');
const { test, done } = createRunner();

(async () => {

// ---------- URL helpers ----------
console.log('\nURL helpers');
{
    const { sandbox } = loadBackground();
    const { youtubeVideoId, isYouTubeVideoUrl, normalizeUrl } = sandbox;

    await test('watch URL', () => assert.equal(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s'), 'dQw4w9WgXcQ'));
    await test('shorts URL', () => assert.equal(youtubeVideoId('https://www.youtube.com/shorts/abc_123-XYZ'), 'abc_123-XYZ'));
    await test('live URL', () => assert.equal(youtubeVideoId('https://www.youtube.com/live/abc_123'), 'abc_123'));
    await test('youtu.be URL', () => assert.equal(youtubeVideoId('https://youtu.be/abc_123?si=xyz'), 'abc_123'));
    await test('m.youtube URL', () => assert.equal(youtubeVideoId('https://m.youtube.com/watch?v=abc_123'), 'abc_123'));
    await test('music.youtube URL', () => assert.equal(youtubeVideoId('https://music.youtube.com/watch?v=abc_123'), 'abc_123'));
    await test('nocookie embed', () => assert.equal(youtubeVideoId('https://www.youtube-nocookie.com/embed/abc_123'), 'abc_123'));
    await test('channel page is not a video', () => assert.equal(isYouTubeVideoUrl('https://www.youtube.com/@somechannel'), false));
    await test('yt homepage is not a video', () => assert.equal(isYouTubeVideoUrl('https://www.youtube.com/'), false));
    await test('lookalike host rejected', () => assert.equal(isYouTubeVideoUrl('https://notyoutube.com/watch?v=abc_123'), false));
    await test('evil host rejected', () => assert.equal(isYouTubeVideoUrl('https://youtube.com.evil.tld/watch?v=abc_123'), false));
    await test('non-video URL untouched', () => assert.equal(normalizeUrl('https://example.com/a?b=1#x'), 'https://example.com/a?b=1'));
    await test('utm stripped', () => assert.equal(normalizeUrl('https://example.com/a?utm_source=x&b=1'), 'https://example.com/a?b=1'));
    await test('video URLs canonicalize together', () => {
        const forms = [
            'https://www.youtube.com/watch?v=abc_123&t=90s&list=PL1&pp=xyz',
            'https://youtu.be/abc_123?si=abcdef',
            'https://m.youtube.com/watch?v=abc_123',
            'https://www.youtube.com/watch?v=abc_123#t=10'
        ];
        const normalized = new Set(forms.map(normalizeUrl));
        assert.deepEqual([...normalized], ['https://www.youtube.com/watch?v=abc_123']);
    });
}

// ---------- transcript: modern panel DOM ----------
console.log('\nTranscript — modern panel DOM (timedtext unavailable)');
{
    const { sandbox } = loadBackground({ html: MODERN, url: 'https://www.youtube.com/watch?v=abc12345678' });
    sandbox.fetch = async () => ({ ok: false, status: 404 });
    const result = await sandbox.extractYouTubeTranscript();

    await test('status ok', () => assert.equal(result.status, 'ok'));
    await test('source is the panel', () => assert.equal(result.source, 'panel'));
    await test('all 5 segments read', () => assert.equal(result.segments, 5));
    await test('timestamps preserved', () => assert.ok(result.text.startsWith('[0:00] '), result.text.slice(0, 40)));
    await test('later timestamp preserved', () => assert.ok(result.text.includes('[2:57] '), result.text));
    await test('caption text present', () => assert.ok(result.text.includes('turns it into memories')));
    await test('screen-reader label excluded', () => assert.ok(!/\d+ seconds/.test(result.text), result.text));
    await test('bare timestamp text excluded', () => assert.ok(!result.text.includes('0:080:16')));
    await test('panel chrome excluded', () => assert.ok(!result.text.includes('Search transcript')));
    await test('title chrome excluded', () => assert.ok(!/^Transcript/m.test(result.text)));
}

// ---------- transcript: legacy panel DOM ----------
console.log('\nTranscript — legacy panel DOM');
{
    const legacy = `<!doctype html><html><body>
      <ytd-transcript-renderer visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED">
        <ytd-transcript-segment-renderer><div class="segment">
          <div class="segment-timestamp">0:03</div>
          <yt-formatted-string class="segment-text">first legacy line</yt-formatted-string>
        </div></ytd-transcript-segment-renderer>
        <ytd-transcript-segment-renderer><div class="segment">
          <div class="segment-timestamp">1:03:04</div>
          <yt-formatted-string class="segment-text">second legacy line</yt-formatted-string>
        </div></ytd-transcript-segment-renderer>
      </ytd-transcript-renderer></body></html>`;
    const { sandbox } = loadBackground({ html: legacy });
    sandbox.fetch = async () => ({ ok: false, status: 404 });
    const result = await sandbox.extractYouTubeTranscript();

    await test('legacy status ok', () => assert.equal(result.status, 'ok'));
    await test('legacy segments read', () => assert.equal(result.segments, 2));
    await test('legacy text joined', () => assert.ok(result.text.includes('first legacy line') && result.text.includes('second legacy line'), result.text));
    await test('hour-long stamp parsed', () => assert.ok(result.text.includes('[1:03:04]'), result.text));
}

// ---------- transcript: timedtext json3 ----------
console.log('\nTranscript — timedtext (json3)');
{
    const player = {
        videoDetails: { videoId: 'abc12345678', defaultAudioLanguage: 'en' },
        captions: { playerCaptionsTracklistRenderer: { captionTracks: [
            { baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=de', languageCode: 'de', kind: 'asr' },
            { baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en', languageCode: 'en' }
        ] } }
    };
    const events = [
        { tStartMs: 0, segs: [{ utf8: 'Hello ' }, { utf8: 'world' }] },
        { tStartMs: 1500, segs: [{ utf8: '\n' }] },
        { tStartMs: 2000, aAppend: 1, segs: [{ utf8: 'Hello world' }] },
        { tStartMs: 65000, segs: [{ utf8: 'a minute in' }] },
        { tStartMs: 70000, segs: [{ utf8: 'a minute in' }] }
    ];
    const seen = [];
    const { sandbox } = loadBackground({ globals: { ytInitialPlayerResponse: player } });
    sandbox.fetch = async (url) => {
        seen.push(String(url));
        return { ok: true, json: async () => ({ events }) };
    };
    const result = await sandbox.extractYouTubeTranscript();

    await test('timedtext status ok', () => assert.equal(result.status, 'ok'));
    await test('source is captions', () => assert.equal(result.source, 'captions'));
    await test('picked the non-ASR english track', () => assert.ok(seen[0].includes('lang=en'), seen[0]));
    await test('requested json3', () => assert.ok(seen[0].includes('fmt=json3'), seen[0]));
    await test('language reported', () => assert.equal(result.language, 'en'));
    await test('segments joined', () => assert.ok(result.text.includes('Hello world'), result.text));
    await test('aAppend duplicate dropped', () => assert.equal((result.text.match(/Hello world/g) || []).length, 1, result.text));
    await test('repeated caption dropped', () => assert.equal((result.text.match(/a minute in/g) || []).length, 1, result.text));
    await test('minute stamp formatted', () => assert.ok(result.text.includes('[1:05]'), result.text));
    await test('caption events counted', () => assert.equal(result.segments, 4));
}

// ---------- transcript: player response from an inline script ----------
console.log('\nTranscript — player response scraped from inline script');
{
    const player = {
        videoDetails: { videoId: 'abc12345678' },
        captions: { playerCaptionsTracklistRenderer: { captionTracks: [
            { baseUrl: 'https://www.youtube.com/api/timedtext?lang=en', languageCode: 'en' }
        ] } }
    };
    const html = `<!doctype html><html><body>
      <script>var meta = {"note":"a } brace and \\" quote inside a string"};</script>
      <script>var ytInitialPlayerResponse = ${JSON.stringify(player)};var other = 1;</script>
      </body></html>`;
    const { sandbox } = loadBackground({ html });
    sandbox.fetch = async () => ({ ok: true, json: async () => ({ events: [{ tStartMs: 0, segs: [{ utf8: 'from inline script' }] }] }) });
    const result = await sandbox.extractYouTubeTranscript();
    await test('inline script parsed', () => assert.equal(result.status, 'ok'));
    await test('inline script text', () => assert.ok(result.text.includes('from inline script'), result.text));
}

// ---------- transcript: stale global for a different video ----------
console.log('\nTranscript — stale player response after in-page navigation');
{
    const stale = {
        videoDetails: { videoId: 'OLD_VIDEO_1' },
        captions: { playerCaptionsTracklistRenderer: { captionTracks: [
            { baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&v=old', languageCode: 'en' }
        ] } }
    };
    const calls = [];
    const { sandbox } = loadBackground({
        url: 'https://www.youtube.com/watch?v=NEW_VIDEO_2',
        globals: {
            ytInitialPlayerResponse: stale,
            ytcfg: { get: (k) => ({ INNERTUBE_API_KEY: 'KEY', INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: '2.2024' } } })[k] }
        }
    });
    sandbox.fetch = async (url, options) => {
        calls.push(String(url));
        if (String(url).includes('/youtubei/v1/player')) {
            const body = JSON.parse(options.body);
            assert.equal(body.videoId, 'NEW_VIDEO_2');
            return { ok: true, json: async () => ({
                videoDetails: { videoId: 'NEW_VIDEO_2' },
                captions: { playerCaptionsTracklistRenderer: { captionTracks: [
                    { baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&v=new', languageCode: 'en' }
                ] } }
            }) };
        }
        return { ok: true, json: async () => ({ events: [{ tStartMs: 0, segs: [{ utf8: 'correct video transcript' }] }] }) };
    };
    const result = await sandbox.extractYouTubeTranscript();
    await test('stale global ignored', () => assert.ok(!calls.some(c => c.includes('v=old')), calls.join(' ')));
    await test('innertube consulted', () => assert.ok(calls.some(c => c.includes('/youtubei/v1/player')), calls.join(' ')));
    await test('correct transcript returned', () => assert.ok(result.text.includes('correct video transcript'), result.text));
}

// ---------- transcript: XML fallback + entity decoding ----------
console.log('\nTranscript — XML fallback');
{
    const player = {
        videoDetails: { videoId: 'abc12345678' },
        captions: { playerCaptionsTracklistRenderer: { captionTracks: [
            { baseUrl: 'https://www.youtube.com/api/timedtext?lang=en', languageCode: 'en' }
        ] } }
    };
    const { sandbox } = loadBackground({ globals: { ytInitialPlayerResponse: player } });
    sandbox.fetch = async (url) => String(url).includes('json3')
        ? { ok: true, json: async () => ({ events: [] }) }
        : { ok: true, text: async () => '<?xml version="1.0"?><transcript><text start="0" dur="2">it&amp;#39;s here &amp;amp; now</text><text start="61.5">later</text></transcript>' };
    const result = await sandbox.extractYouTubeTranscript();
    await test('xml fallback used', () => assert.equal(result.status, 'ok'));
    await test('entities decoded', () => assert.ok(result.text.includes("it's here & now"), result.text));
    await test('fractional start floored', () => assert.ok(result.text.includes('[1:01]'), result.text));
}

// ---------- transcript: no captions at all ----------
console.log('\nTranscript — video without captions');
{
    const player = { videoDetails: { videoId: 'abc12345678' }, captions: {} };
    const html = '<!doctype html><html><body><div id="description-inline-expander">The description of a caption-less video.</div></body></html>';
    const { sandbox } = loadBackground({ html, globals: { ytInitialPlayerResponse: player } });
    sandbox.fetch = async () => ({ ok: false });
    const result = await sandbox.extractYouTubeTranscript();
    await test('status partial', () => assert.equal(result.status, 'partial'));
    await test('description used', () => assert.ok(result.text.includes('caption-less video'), result.text));
    await test('note explains why', () => assert.ok(/no captions/i.test(result.note), result.note));
}

// ---------- transcript: nothing at all ----------
console.log('\nTranscript — nothing available');
{
    const { sandbox } = loadBackground({ html: '<!doctype html><html><body></body></html>' });
    sandbox.fetch = async () => ({ ok: false });
    const result = await sandbox.extractYouTubeTranscript();
    await test('status error', () => assert.equal(result.status, 'error'));
    await test('no text', () => assert.equal(result.text, ''));
    await test('note present', () => assert.ok(result.note.length > 0));
}

// ---------- clamping long transcripts ----------
console.log('\nTranscript — length clamp keeps head and tail');
{
    const events = [];
    for (let i = 0; i < 4000; i++) events.push({ tStartMs: i * 4000, segs: [{ utf8: `caption line number ${i} with some filler words` }] });
    const player = {
        videoDetails: { videoId: 'abc12345678' },
        captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?lang=en', languageCode: 'en' }] } }
    };
    const { sandbox } = loadBackground({ globals: { ytInitialPlayerResponse: player } });
    sandbox.fetch = async () => ({ ok: true, json: async () => ({ events }) });
    const result = await sandbox.extractYouTubeTranscript();
    await test('within budget', () => assert.ok(result.text.length <= 24100, String(result.text.length)));
    await test('opening kept', () => assert.ok(result.text.includes('caption line number 0 '), 'start missing'));
    await test('ending kept', () => assert.ok(result.text.includes('caption line number 3999'), 'end missing'));
    await test('elision marked', () => assert.ok(result.text.includes('omitted for length')));
}

// ---------- context plumbing ----------
console.log('\nConversation context');
{
    const { sandbox } = loadBackground();
    const { hasUsableContent, isPlaceholderContent, stripTimestamps } = sandbox;
    await test('legacy placeholder detected', () => assert.equal(hasUsableContent({ pageContent: '[Could not automatically extract the YouTube transcript.]' }), false));
    await test('legacy real content accepted', () => assert.equal(hasUsableContent({ pageContent: 'real text' }), true));
    await test('timestamped transcript is not a placeholder', () => assert.equal(hasUsableContent({ pageContent: '[0:00] hello there', contentStatus: 'ok' }), true));
    await test('legacy check tolerates a leading stamp', () => assert.equal(isPlaceholderContent('[0:00] hello'), false));
    await test('partial content is usable', () => assert.equal(hasUsableContent({ pageContent: 'desc', contentStatus: 'partial' }), true));
    await test('error status not usable', () => assert.equal(hasUsableContent({ pageContent: '', contentStatus: 'error' }), false));
    await test('timestamps stripped for indexing', () => assert.equal(stripTimestamps('[0:00] one\n[1:02:03] two'), 'one\ntwo'));
}

// ---------- system prompt ----------
console.log('\nSystem prompt');
{
    const { sandbox } = loadBackground();
    const base = { title: 'V', url: 'u', messages: [] };

    const okVideo = sandbox.buildApiMessages({ ...base, contentType: 'video', contentStatus: 'ok', pageContent: '[0:00] hello world' })[0].content;
    await test('transcript embedded', () => assert.ok(okVideo.includes('hello world'), okVideo));
    await test('timestamp convention explained', () => assert.ok(okVideo.includes('[m:ss]'), okVideo));
    await test('not treated as failure', () => assert.ok(!okVideo.includes('could not be extracted'), okVideo));

    const partial = sandbox.buildApiMessages({ ...base, contentType: 'video', contentStatus: 'partial', contentNote: 'This video has no captions.', pageContent: 'description text' })[0].content;
    await test('partial note surfaced', () => assert.ok(partial.includes('no captions'), partial));
    await test('partial content included', () => assert.ok(partial.includes('description text'), partial));

    const failed = sandbox.buildApiMessages({ ...base, contentType: 'video', contentStatus: 'error', contentNote: 'nope', pageContent: '' })[0].content;
    await test('failure acknowledged', () => assert.ok(failed.includes('could not be extracted'), failed));

    const legacy = sandbox.buildApiMessages({ ...base, contentType: 'video', pageContent: '[Could not automatically extract the YouTube transcript.]' })[0].content;
    await test('legacy placeholder still handled', () => assert.ok(legacy.includes('could not be extracted'), legacy));
}

done();
})();
