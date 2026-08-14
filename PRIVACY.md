# Privacy Policy — Webpage Summarizer & Chat

**Last updated:** 14 August 2026
**Applies to:** the "Webpage Summarizer & Chat" Chrome extension (all versions from 2.2.0)

## Summary

This extension has no backend. There is no account, no analytics, no tracking and no
server operated by the developer. Everything the extension stores stays in your own
browser profile. The only network requests it ever makes are to the OpenAI API, using
the API key that you supply, and only when you ask it to do something.

## What the extension stores, and where

| Data | Where it is stored | Leaves your device? |
|---|---|---|
| Your OpenAI API key | `chrome.storage.sync` | Only via Chrome Sync, to your own signed-in Chrome profile (see below) |
| Model choice, semantic-search toggle | `chrome.storage.sync` | Same as above |
| Conversations and extracted page text | `chrome.storage.local` | No |
| Unsent message drafts | `chrome.storage.local` | No |
| Saved pages, AI summaries, tags, embeddings, search index | IndexedDB (`webpageKB`) | No |

**A note on Chrome Sync.** Your API key and settings are kept in `chrome.storage.sync`
so they follow you between computers where you are signed into the same Chrome profile.
If Chrome Sync is enabled, Google transmits and stores that data as part of your own
Chrome profile, under [Google's privacy policy](https://policies.google.com/privacy).
If you would rather your key never leave one machine, turn off extension syncing in
Chrome's sync settings.

Conversations, saved pages and embeddings are **never** synced. They live only in the
browser profile on the device where you created them.

## What is sent to OpenAI

When — and only when — you take an action, the extension sends data to
`https://api.openai.com`:

| Your action | What is sent |
|---|---|
| Summarize a page, or ask a question about it | The page's title, URL and extracted text (up to 24,000 characters), plus the recent messages in that conversation |
| Summarize a video | The video's title, URL and transcript text |
| Save a page to the Knowledge Base | The page's title, URL and extracted text, so a title, summary and tags can be generated |
| Save a page with semantic search enabled | The same text again, to the embeddings endpoint |
| Search or Ask with semantic search enabled | Your search query or question |
| Press "Save & test" in Settings | A one-word test message |

These requests are authenticated with your own API key and are billed to your own OpenAI
account. They are governed by OpenAI's
[Privacy Policy](https://openai.com/policies/privacy-policy) and
[API data usage policies](https://platform.openai.com/docs/guides/your-data). At the
time of writing, OpenAI does not train its models on data submitted through the API.

The developer of this extension does not receive, see, or have any way to access any of
this data.

## What the extension does not do

- It does not collect, transmit or sell your personal information.
- It does not include analytics, telemetry, advertising or fingerprinting of any kind.
- It does not send your data to any server other than the OpenAI API.
- It does not read pages in the background. Page content is only ever read from the tab
  you are actively viewing, and only after you open the popup and act.
- It does not use your data for creditworthiness, lending, or any purpose unrelated to
  the single feature described in the store listing.

## Permissions and why they are needed

- **`activeTab`** — read the title, URL and text of the tab you are currently looking at,
  and only after you open the extension.
- **`scripting`** — run the text-extraction routine inside that page so its content can
  be summarized. On YouTube the routine asks YouTube itself for the video's caption
  track — a request to youtube.com made by the page you are already on, carrying nothing
  the page did not already have — and falls back to opening and reading the transcript
  panel.
- **`storage`** — keep your API key, settings and conversations.
- **`unlimitedStorage`** — let the Knowledge Base grow past the default quota, since
  saved page text and embeddings are large.
- **`https://api.openai.com/*`** — send the requests described above.

## Your controls

- **Export** — Settings → Your data → *Export as JSON* writes every conversation and
  saved page to a file. Your API key is deliberately excluded from the export.
- **Delete** — Settings → Your data → *Delete all data* erases all conversations, drafts,
  saved pages, embeddings and the search index. History → *Clear all* erases just the
  chats, and individual chats and saved pages can be deleted one at a time.
- **Uninstall** — removing the extension from Chrome deletes everything it stored,
  including your API key.

Deletion is immediate and permanent; there is no copy anywhere else to recover from.

## Children

This extension is not directed at children and does not knowingly handle data from them.

## Changes to this policy

Material changes will be published in this file and noted in the extension's changelog
alongside a version bump. The "last updated" date above always reflects the current
version.

## Contact

Questions, or a privacy concern? Please open an issue at
<https://github.com/puscas-sergiu/webpage-context/issues>.
