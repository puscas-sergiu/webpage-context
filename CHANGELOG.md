# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
