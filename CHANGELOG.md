# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.3.0] — 2026-08-14

### Fixed
- **YouTube transcripts were extracted only some of the time.** Extraction scraped a
  single selector (`ytd-transcript-segment-renderer`) that YouTube has replaced for many
  users with the modern transcript view (`transcript-segment-view-model`). Both layouts
  are live at once, so success depended on which rollout a user was in. The transcript
  now comes from YouTube's own caption data — the `timedtext` endpoint resolved from the
  player response, validated against the video id in the URL so in-page navigation
  cannot return the previous video's captions — with the panel kept as a fallback that
  understands both layouts, opens via the description's transcript section rather than an
  English `aria-label`, and waits for segments to settle instead of a fixed delay.
- **Chat on a video summarized the page instead of the transcript.** Only the *Summarize
  video* action requested a transcript, so *Key takeaways* and typed questions were
  answered from YouTube's navigation chrome. What to extract is now decided by the tab
  URL, and content captured by the wrong extractor is refreshed.
- **Only `youtube.com/watch` counted as a video.** Shorts, live replays, `youtu.be`,
  embeds and the `m.`/`music.` hosts are recognised too, and every form of a video link
  normalizes to one canonical URL, so a resume timestamp or a share link no longer opens
  its own conversation.
- A failed re-extraction no longer discards content that was extracted successfully
  earlier, and a failing extraction is retried once rather than on every message.
- Truncating a long transcript no longer drops the ending, where the conclusion usually
  is; the opening and the ending are kept with the middle elided.

### Added
- Transcripts carry `[m:ss]` markers so answers can cite moments in the video. The
  markers are stripped before lexical indexing, embeddings and snippets.
- Videos without captions fall back to the video description, and the model is told that
  is what it is working from instead of inferring a summary from the title.
- Unit tests (`npm test`, jsdom): the extractor against saved panel markup and mocked
  caption responses, plus the rules governing what gets extracted and when.

## [2.2.0] — 2026-08-14

First release prepared for the Chrome Web Store.

### Added
- **Your data** section in Settings: a live count of stored chats and saved pages,
  one-click **Export as JSON** (the API key is deliberately excluded), and
  **Delete all data**, which clears conversations, drafts, saved pages, embeddings and
  the search index.
- Real extension icons at 16/32/48/128, rendered from SVG sources in `tools/`.
- Keyboard operation throughout: history and knowledge-base rows are focusable and
  activate on Enter or Space, all icon buttons carry accessible labels, toggle buttons
  report state via `aria-pressed`, and status regions announce politely.
- Visible focus rings for keyboard users, and support for `prefers-reduced-motion`.
- Store submission pack: privacy policy (`PRIVACY.md` plus a hostable HTML version),
  listing copy with per-permission justifications (`store/LISTING.md`), generated
  screenshots and promo tiles (`store/`), and a packaging script (`tools/build.sh`).
- Pre-submission checks: `tools/verify.mjs` catches wiring mistakes in the source and
  runs as part of the build, and `tools/smoke.mjs` loads the unpacked extension in
  headless Chrome to round-trip messages through the real service worker.
- MIT licence.

### Fixed
- **Bold and italic text wrapping inline code rendered with literal asterisks.** The
  emphasis rules were applied per code-split fragment, so a very common shape in model
  output — ``**`fetch()` returns a promise**`` — never matched.
- **The knowledge base's "Ask" panel stayed visible while browsing.** An id-level
  `display` rule outranked the `hidden` attribute, so both panels rendered at once.
- **The OpenAI host permission matched only the site root.** `https://api.openai.com/`
  does not cover `/v1/chat/completions`; it is now `https://api.openai.com/*`.
- Clearing history no longer uses `window.confirm()`, which can dismiss the popup before
  the choice registers. Destructive actions now use an inline two-step confirmation.
- Opening the chat view no longer steals focus into a disabled input on restricted pages.

### Changed
- Manifest: short description brought under the store's 132-character limit, plus
  `short_name`, `homepage_url`, `minimum_chrome_version`, an explicit page CSP, an action
  title, and a 32px icon.
- Settings is grouped into OpenAI / Knowledge base / Your data sections, with a link for
  creating an API key and a note that usage is billed to the user's own account.

## [2.1.0] — 2026-06-25

### Added
- Knowledge base: save any page or video with one click, then find it again.
- Background enrichment giving each saved page an AI title, summary, topic tags and
  keywords.
- Hybrid search blending an inverted keyword index with embedding similarity, selectable
  as Hybrid, Keyword or Semantic.
- **Ask** tab answering questions across everything saved, with inline citations.
- IndexedDB storage (`webpageKB`) for bookmarks, vectors and the lexical index, with the
  `unlimitedStorage` permission.

### Fixed
- Race where enrichment could resurrect a bookmark deleted mid-flight.
- Semantic search now falls back to keyword results when embeddings are unavailable.
- Query embeddings are cached so repeated searches are not re-billed.

## [2.0.0] — 2026-06-10

### Changed
- Full rebuild. The background service worker became the source of truth, so generation
  continues when the popup closes and the popup can reattach to a response in flight.

### Added
- Per-page conversations persisted locally and keyed by normalized URL.
- Chat history grouped by day, with reopen, continue and delete.
- Token-by-token streaming responses.
- Draft preservation, quick-action chips, markdown rendering and dark mode.

## [1.0.0] — 2025-11-18

### Added
- Initial release: webpage and YouTube video summarization via the OpenAI API.
