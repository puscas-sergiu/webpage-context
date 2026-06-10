# Webpage Summarizer & Chat

A Chrome extension that lets you chat with any webpage or YouTube video using OpenAI — summaries, Q&A, key points. Conversations are saved locally per page, with a browsable history. No account needed.

## Features

- **Webpage summarization** — extract and summarize the main content from any webpage
- **YouTube video summarization** — automatically opens the transcript panel, extracts captions, and generates a summary with key learnings and takeaways
- **Interactive chat** — ask follow-up questions about the page/video; the page content is extracted once and reused for the whole conversation
- **Per-page persistence** — chats are saved locally (in `chrome.storage.local`) and keyed to the page URL. Close the popup, click elsewhere, restart the browser — reopen the popup on the same page and your conversation is right where you left it
- **Chat history** — browse, reopen, continue, or delete past conversations from any page. Continuing an old chat reuses that page's saved content, even if you're no longer on the page
- **Streaming responses** — answers render token-by-token; if the popup closes mid-response, the background finishes the generation and saves it
- **Draft preservation** — text typed into the input box survives the popup closing
- **Markdown rendering** — headings, bullets, bold, code blocks, and links in responses (HTML-escaped, no injection)
- **Quick actions** — one-tap chips for "Summarize", "Key points", and "Explain simply"
- **Dark mode** — follows your system theme
- **Keyboard shortcut** — `Alt+Shift+S` opens the popup (configurable at `chrome://extensions/shortcuts`)

## Installation

### From Source

1. Clone this repository:
   ```bash
   git clone https://github.com/puscas-sergiu/webpage-context.git
   cd webpage-context
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" (toggle in the top right)

4. Click "Load unpacked" and select the project directory

5. The extension icon should now appear in your Chrome toolbar

## Configuration

1. Get your API key from [OpenAI's platform](https://platform.openai.com/api-keys)
2. Click the extension icon — you'll be taken to Settings on first run
3. Paste your OpenAI API key, optionally pick a model (defaults to `gpt-5-nano`)
4. Click "Save & test" — the extension verifies the key works

## Usage

### Summarizing

1. Navigate to any webpage (or YouTube video)
2. Open the popup and tap the **📄 Summarize page** (or **🎬 Summarize video**) chip
3. The summary streams in; for videos the transcript panel is opened automatically

### Chatting

- Type a question and press Enter (Shift+Enter for a new line)
- The conversation — including the extracted page content — is kept for follow-up questions
- Click **+** in the header to start a fresh chat; the old one stays in History

### History

- Click the **clock icon** to see all saved chats, grouped by date
- Click a chat to reopen and continue it (works even from a different page — replies use the saved page content)
- Hover a chat and click the trash icon twice to delete it, or use "Clear all"

## Architecture

```
popup.html / popup.js / styles.css   UI only — renders state, streams deltas
background.js                        Owns everything: extraction, OpenAI calls,
                                     streaming, and conversation persistence
```

The background service worker is the source of truth. The popup asks it for the current page's conversation on open (`getState`) and renders it; generation events (`genStatus`, `genDelta`, `genDone`, `genError`) are broadcast so the popup can attach/detach freely — including reattaching to a generation already in progress.

### Storage layout (`chrome.storage.local`)

| Key | Contents |
|---|---|
| `convIndex` | Lightweight index of all conversations (for the History list) |
| `urlActive` | Map of normalized page URL → active conversation id |
| `conv:<id>` | Full conversation: messages + extracted page content |
| `drafts` | Unsent input text per page |

URLs are normalized (hash and `utm_*`/`fbclid`/`gclid` parameters stripped) so the same article maps to the same chat. History is capped at 100 conversations, pruned oldest-first.

### API

- **Model**: `gpt-5-nano-2025-08-07` by default; selectable in Settings
- **Endpoint**: `https://api.openai.com/v1/chat/completions` with `stream: true` (falls back to non-streaming automatically if the account/model rejects streaming)
- **Content limit**: extracted content truncated to 24,000 characters; the last 24 messages are sent per request

## Privacy & Security

- Your OpenAI API key is stored in Chrome's sync storage
- Conversations are stored **only on your device** in Chrome's local extension storage — nothing leaves your browser except the calls to OpenAI
- Content extraction happens locally in your browser
- Model responses are rendered through an HTML-escaping markdown renderer (no raw HTML injection)

## Permissions Explained

- **activeTab** — read the current tab's URL/title and content when you open the popup
- **storage** — store your API key, settings, and conversation history
- **scripting** — inject the content/transcript extraction functions into the page
- **host_permissions (api.openai.com)** — make API calls to OpenAI

## Limitations

- Requires an active OpenAI API key with sufficient credits
- Extracted content is truncated to 24,000 characters
- YouTube videos must have transcripts/captions available
- Cannot read restricted pages (`chrome://`, the Chrome Web Store, etc.) — but past chats remain accessible from History

## Troubleshooting

- **"OpenAI API key not set"** — add a valid key in Settings
- **"Could not extract YouTube transcript"** — ensure the video has captions; try opening the transcript panel manually first
- **"Invalid OpenAI API key" (401)** — the key is invalid or expired; update it in Settings
- **"Rate limit or quota exceeded" (429)** — check your OpenAI account usage and billing
- **Chat seems stale after the page changed** — hit Summarize again to re-extract, or start a new chat with **+**

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is open source and available for personal and commercial use.

## Author

**puscas-sergiu**
