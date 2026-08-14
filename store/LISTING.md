# Chrome Web Store submission pack

Everything the Developer Dashboard asks for, ready to paste. Field names match the
dashboard as of the last update to this file.

---

## Store listing

**Item name**
```
Webpage Summarizer & Chat
```

**Short description** (132 char limit — this is 124)
```
Summarize and chat with any page or YouTube video, then save it to a private, searchable knowledge base. Bring your own key.
```

**Category:** Productivity / Workflow & Planning
**Language:** English (United States)

**Detailed description**
```
Turn any page into a conversation — and keep what matters.

Webpage Summarizer & Chat reads the page you are on, summarizes it, and lets you ask
follow-up questions in a thread that stays attached to that page. Save anything worth
keeping to a knowledge base that you can search by meaning and ask questions across.

It runs entirely on your own OpenAI API key. There is no account to create, no server
in the middle, and nothing is uploaded anywhere except the OpenAI API calls you trigger.


WHAT IT DOES

• Summarize any page — one click turns an article, doc or paper into a structured
  summary with key points.

• Summarize YouTube videos — the transcript panel is opened and read automatically,
  then condensed into key learnings and takeaways.

• Keep asking — follow-up questions reuse the page content already extracted, so the
  conversation stays in context without re-reading the page.

• Build a knowledge base — bookmark a page and it is indexed in the background with an
  AI-generated title, summary and topic tags.

• Search by meaning — hybrid search blends keyword matching with semantic similarity,
  so you find the page you half-remember. Keyword-only mode is instant and free.

• Ask across everything — pose a question to your whole library and get one answer with
  inline [1] [2] citations linking back to the sources it used.

• Pick up where you left off — chats are saved per page and grouped by day in History.
  Answers stream in, and a response keeps generating even if you close the popup.

• Dark mode, keyboard shortcut (Alt+Shift+S), draft preservation, and one-tap actions
  for Summarize, Key points and Explain simply.


PRIVACY

• No account, no analytics, no tracking, no ads.
• Conversations and saved pages are stored only in your browser profile.
• The only network requests are to api.openai.com, authenticated with your own key.
• Export everything to JSON, or erase all of it, from Settings at any time.
• Full policy: https://github.com/puscas-sergiu/webpage-context/blob/main/PRIVACY.md


WHAT YOU NEED

An OpenAI API key from platform.openai.com. Usage is billed to your own OpenAI account —
typically a fraction of a cent per summary on the default gpt-5-nano model. The
extension does not charge anything and has no subscription.


OPEN SOURCE

Source code, issues and releases: https://github.com/puscas-sergiu/webpage-context
```

---

## Privacy practices tab

**Single purpose description**
```
This extension has one purpose: to help the user understand and retain the content of
web pages they are viewing. It extracts the text of the page the user is on, sends it to
the OpenAI API using the user's own key to produce summaries and answer questions about
it, and optionally stores that page in a local, searchable knowledge base so the user can
find and query it later. Every feature serves that single purpose.
```

**Permission justifications** — paste each into the matching field.

`activeTab`
```
Used to read the title, URL and text of the page the user is currently viewing so it can
be summarized or discussed. It is only exercised after the user explicitly opens the
extension popup and requests an action; the extension never reads tabs in the background.
```

`scripting`
```
Used to inject the text-extraction routine into the current page so its readable content
can be collected for summarization. On YouTube it also opens the transcript panel and
reads the caption text. No script is injected until the user requests a summary, asks a
question, or saves the page.
```

`storage`
```
Used to store the user's OpenAI API key and preferences, their conversation history, and
unsent drafts. All of it stays in the user's own browser profile; none of it is
transmitted to the developer.
```

`unlimitedStorage`
```
The knowledge base stores the extracted text of saved pages plus one embedding vector per
page in IndexedDB. This exceeds the default storage quota after a modest number of saved
pages, so the quota limit must be lifted for the feature to work.
```

`host_permissions` — `https://api.openai.com/*`
```
The extension sends summarization, chat and embedding requests to the OpenAI API,
authenticated with the API key the user provides in Settings. This is the only remote
host the extension contacts.
```

**Remote code**
```
No. The extension executes no remote code. All scripts are bundled in the package; the
OpenAI API is used only as a data source and responses are rendered as text.
```

**Data usage — declare the following**

| Category | Collected? | Notes |
|---|---|---|
| Personally identifiable information | No | |
| Health information | No | |
| Financial and payment information | No | |
| Authentication information | No | The user's API key is stored locally and sent only to OpenAI; the developer never receives it |
| Personal communications | No | |
| Location | No | |
| Web history | No | Page URLs are stored locally only; nothing is transmitted to the developer |
| User activity | No | |
| Website content | **Yes** | Page text is sent to the OpenAI API to generate summaries and answers, at the user's request |

**Certifications** — all three can be checked truthfully:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL** — either of these works; the second requires enabling GitHub Pages
for the `docs/` folder:
```
https://github.com/puscas-sergiu/webpage-context/blob/main/PRIVACY.md
https://puscas-sergiu.github.io/webpage-context/privacy-policy.html
```

---

## Graphic assets

All generated by `node tools/make-store-assets.mjs`.

| Dashboard field | File | Size |
|---|---|---|
| Store icon | `icon128.png` | 128×128 |
| Screenshot 1 | `store/screenshots/01-chat.png` | 1280×800 |
| Screenshot 2 | `store/screenshots/02-knowledge-base.png` | 1280×800 |
| Screenshot 3 | `store/screenshots/03-ask.png` | 1280×800 |
| Screenshot 4 | `store/screenshots/04-history.png` | 1280×800 |
| Screenshot 5 | `store/screenshots/05-privacy.png` | 1280×800 |
| Small promo tile | `store/promo-small.png` | 440×280 |
| Marquee promo tile | `store/promo-marquee.png` | 1400×560 |

At least one screenshot is required; up to five are allowed. Promo tiles are optional but
are needed to be eligible for featuring.

---

## Submission checklist

- [ ] `bash tools/build.sh` and upload `dist/webpage-summarizer-chat-<version>.zip`
- [ ] Paste the listing copy above
- [ ] Upload the screenshots and promo tiles
- [ ] Set the privacy policy URL
- [ ] Fill in the single purpose and each permission justification
- [ ] Complete the data usage declarations and tick the three certifications
- [ ] Set a contact email in the developer account and verify it (required before publishing)
- [ ] Choose distribution: public, unlisted, or private
- [ ] Submit for review — first review of a new item typically takes a few business days

## Notes for future submissions

- Bump `version` in `manifest.json` for every upload; the store rejects a re-used version.
- Adding a permission later can trigger a longer review and, for some permissions, a
  warning prompt that disables the extension for existing users until they accept it.
- Keep `PRIVACY.md` and its "last updated" date in step with any change to what is sent
  off-device.
