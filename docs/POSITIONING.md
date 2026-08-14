# Market positioning, competition and monetization

**Status:** research memo, August 2026. Opinionated, meant to be argued with.
**Scope:** where this extension sits in the market, how to describe it, and what money
is realistically available.

A note on evidence quality up front, because it changes how much weight to put on the
numbers below: install counts, pricing tiers and conversion benchmarks in this memo come
largely from secondary sources — comparison blogs, monetization guides, vendor pages.
A lot of the "best AI extensions 2026" material is affiliate SEO content of variable
reliability. First-party data (Chrome Web Store listings, chrome-stats, Hacker News
threads) was not directly reachable from the research environment, and the Ahrefs
subscription attached to this session does not include Keywords Explorer, so there is
**no first-party search-volume validation** in this memo. Treat every specific figure as
an order of magnitude, not a fact. The structural argument does not depend on any single
number.

---

## 1. What has actually been built

It helps to stop thinking of this as one product. It is three, stacked, and they have
very different competitive positions.

| Layer | What it does | Competitive position |
|---|---|---|
| **1. Summarize** | Page and YouTube summarization | **Commodity.** Free in the browser itself as of 2026. |
| **2. Page-attached chat** | Conversations keyed to a normalized URL, persisted, resumable, streaming survives popup close | **Mildly differentiated.** Rarer than it sounds, but hard to headline. |
| **3. Local knowledge base** | Bookmark → AI enrichment → hybrid keyword+semantic search → RAG "Ask" with citations, all in IndexedDB, never leaving the device | **This is the product.** |

Layers 1 and 2 are the acquisition surface. Layer 3 is the reason someone stays, and the
only part with any durability. The current name, description and store listing lead with
layer 1 — the one part that has been commoditized by the platform vendor. That is the
central positioning error, and it is cheap to fix now because there are no installs to
protect.

---

## 2. The competitive field, in four tiers

### Tier 0 — the browser itself (the existential one)

Chrome shipped the **Summarizer API** in stable at Chrome 138, and Chrome 148
(stable ~May 2026) stabilized on-device Gemini Nano with the Prompt API, Summarizer and
Translator. It runs locally, costs nothing, needs no key, and the Prompt API is
explicitly available to extensions. Separately, Gemini is integrated into Chrome for
end users, and Atlas / Comet / Dia ship assistant-grade browsing natively (Atlas
reportedly ~10–15M MAU, Comet ~3–5M, Dia ~2–3M — vendor-adjacent estimates).

**Read:** "summarize this page with AI" is now a browser feature, not a product. Any
positioning built on it is positioning on sand. But note the inversion — the same
platform shift that kills the pitch is also the single best gift to this product, and
§4 is built on it.

### Tier 1 — the AI sidebar giants

Monica (reportedly 30M+ installs, 4.9★ across 60k+ reviews), Sider, MaxAI.me, Merlin,
HARPA (500k+ users). Multi-model, feature-maximalist, credit-metered free tiers designed
to convert within a week or two. Roughly $8–39/month.

**Read:** unwinnable on features, budget, or store ranking. They are also the *reason*
a wedge exists: they are cloud-account products that see everything you browse, and
several AI extensions were flagged in 2026 press for data harvesting. Do not compete
with them. Be the thing people switch to when they stop trusting them.

### Tier 2 — the knowledge-base / "second brain" players

The closest real competitors:

- **Recall (getrecall.ai)** — the nearest analogue. Save → summarize → auto-linking
  knowledge graph → chat with your library → spaced-repetition quizzes. Free tier
  ~10 AI summaries/month, ~$10/mo Plus, ~$38/mo Max. **Cloud, account-based.**
- **Glasp** — highlights-first, social/public by default, integrates into note apps.
  **Cloud.**
- **NotebookLM + its extension ecosystem** — the "capture the web, then ask across it"
  pattern, validated hard: roughly a million combined installs across NotebookLM
  companion extensions (YouTube→NotebookLM ~400k, Web Importer ~200k, Kortex ~100k,
  WebSync ~80k). **All of it ships your pages to Google.**
- **Memex (WorldBrain)** — the local-first, open-source, offline, full-text-searchable
  predecessor. Steward-owned, principled, and now effectively discontinued.

**Read:** the demand is proven — a million installs of "get web pages into a thing I can
ask questions of" is not a niche. What no one credible currently occupies is that same
workflow **with the library never leaving the device**. Memex held that ground and
vacated it. That is both the opportunity and the warning; see §7.

### Tier 3 — the BYOK cohort

BYOK AI Chat, SnapMind, Browserfly, AI Summary, Reduz, plus a long tail of open-source
summarizers (HN TL;DR, HN Companion, various Gemini summarizers). HARPA also offers a
BYOK mode.

**Read:** BYOK is not differentiation — it is a crowded, mostly free, mostly
open-source commons. Nearly all of them stop at summarize-and-chat. Almost none carry a
persistent, searchable, RAG-queryable local library. **The combination is the
differentiator, not either half.**

---

## 3. So what is actually new here

Stated precisely, and only claiming what the code supports:

> A browser-resident research memory where the summarization, the chat history, the
> saved pages, the embeddings and the retrieval index all live in your own browser
> profile, are queryable by meaning, answer questions with citations across everything
> you've saved — with no account, no server, no vendor in the middle, and an MIT-licensed
> source tree you can read.

Three things make that non-trivial rather than a slogan:

1. **RAG over a private corpus that never leaves the device.** Recall, Glasp and
   NotebookLM all do retrieval-augmented answering over your saved material — server-side.
   Doing it client-side (IndexedDB vectors + inverted index + hybrid scoring) is the
   uncommon part.
2. **No-account, no-backend as an architectural fact, not a policy promise.** The only
   host contacted is `api.openai.com`. That is a verifiable claim, and it is the claim
   Tier 1 cannot make.
3. **The library is the switching cost.** Chats are disposable; two hundred enriched,
   embedded, searchable saved pages are not. This is the only moat available to an
   MIT-licensed extension — not the code, the accumulated corpus sitting in the user's
   own browser.

What is *not* new, and should not be claimed as such: summarization, YouTube transcript
handling, streaming, markdown rendering, dark mode, BYOK. All table stakes.

---

## 4. The change that makes the positioning true

**Recommendation: make on-device the default path, and BYOK the upgrade.**

Chrome's Prompt API and Summarizer API are stable, free, keyless, on-device, and
available to extensions. Adopting them fixes three separate problems at once:

- **It removes the funnel cliff.** Right now the first-run experience is "go to
  platform.openai.com, create an account, add a payment method, generate a key, paste it
  back." Every step of that sheds users, and it selects hard for developers. With
  built-in AI, install → summarize works in one click, with nothing to configure.
- **It makes the privacy claim absolute.** Today the honest phrasing is "private, except
  the page text goes to OpenAI." On-device, there is no exception. That is a
  qualitatively different marketing claim and the one Tier 1 can never match.
- **It removes the cost objection permanently.** Free tier with genuinely zero marginal
  cost to you *and* zero cost to the user.

The same logic extends to embeddings: a small local embedding model via Transformers.js
(EmbeddingGemma / all-MiniLM class) would make semantic search and the KB fully local,
removing the per-saved-page OpenAI cost that currently sits behind a settings toggle.

**Honest caveats, which are real:**

- Hardware gate: >4GB VRAM and ~22GB free disk on the Chrome profile volume, desktop
  only. A meaningful minority of users will not qualify. This must be a graceful
  capability chain — built-in AI → user's key → keyword-only — never a hard requirement.
- Quality regression: Gemini Nano summaries are materially weaker than a GPT-class model
  on long or technical pages. Shipping the weak path as the silent default is a 1-star
  review generator. Mitigation: be explicit in the UI about which engine answered, and
  make "connect your own key for better answers on long documents" a visible, honest
  upgrade rather than a hidden setting.
- Engineering cost is not trivial: a real fallback chain, two prompt paths, two
  embedding paths, and capability detection.

**Second recommendation: multi-provider BYOK.** OpenAI-only with a hardcoded host
permission is a needless constraint. Anthropic, Gemini, OpenRouter and — most
importantly for this audience — **Ollama / LM Studio on localhost**. Local-model support
is what the r/LocalLLaMA and self-hosting crowd actually asks for, and that is precisely
the audience this positioning targets. Caveat: broader `host_permissions` weakens the
"contacts exactly one host" selling point and adds store-review friction, so scope it as
optional permissions requested at the moment the user picks a provider.

---

## 5. How to describe it

### The name is the biggest single problem

"Webpage Summarizer & Chat" files the product into the most commoditized category in
the store, competing for exactly the keywords Monica and Sider spend money on, and says
nothing about the knowledge base. Change it before launch, while it costs nothing.

Candidates, with the reasoning:

- **Commonplace** — a *commonplace book* is the historical term for a personal
  collection of excerpts and notes gathered from reading. It describes the product
  exactly, sounds like a product rather than a feature, and has no incumbent in this
  space. **Recommended.**
- **Lodestone** — evokes finding your way back to things. Generic but clean.
- **Quiver** — short, memorable, weaker semantic fit.

Avoid: *Recall* (taken by the direct competitor), *Marginalia* (taken), anything
containing "Summarizer" or "GPT".

Chrome Web Store search does reward keywords in the title, so use the standard
brand-plus-keywords format:

```
Commonplace — Private AI Reading Memory
```

Trademark and store-name availability need checking before committing; that could not be
verified from here.

### Positioning statement

> **For** people who read a lot on the web and keep losing what they read,
> **Commonplace** is a browser extension that summarizes what you're reading and files it
> into a private library you can search by meaning and ask questions of.
> **Unlike** Recall, Glasp or NotebookLM, your library never leaves your browser — no
> account, no server, no company in the middle.

### Message hierarchy (order matters)

1. **Your reading, searchable.** Save any page or video; find it later by what it *meant*,
   not what it was called.
2. **Ask your whole library.** One question, one answer, cited back to the pages it came
   from.
3. **It never leaves your browser.** No account. No backend. Open source, MIT.
4. *(then, and only then)* Summarize pages and YouTube videos; keep a chat thread per page.

The current listing runs this list almost exactly backwards.

### One-liner options

- "Your reading, searchable. Private by architecture, not by promise."
- "A commonplace book for the web — everything you save, searchable by meaning, stored
  only on your machine."
- "NotebookLM for your browsing, without sending anything to anyone."

### Store listing changes

- Short description leads with the knowledge base, not summarization.
- Screenshot 1 must be **Ask-with-citations**, not the chat view. First screenshot is the
  single highest-leverage asset on the page; currently it shows the commodity feature.
- Keep the "only contacts one host" claim prominent — it is verifiable and rare.
- Add an explicit comparison section to the long description ("vs. cloud AI sidebars").

---

## 6. Monetization: what is realistic

### The structural problem, stated plainly

BYOK plus open-source plus local-first selects for an audience that is technical,
privacy-motivated, and **structurally the least willing to pay of any segment in
consumer software**. This is the tension at the heart of the plan: the positioning that
makes the product defensible is the same positioning that makes it hard to monetize.
Every recommendation below is shaped by that.

### Baseline mechanics

- Chrome Web Store payments have been dead since **1 February 2021**. Billing must run
  through ExtensionPay, Paddle, Lemon Squeezy, Dodo or plain Stripe with a license-key
  flow.
- Commonly cited freemium conversion is **2–5%**, but that benchmark comes from
  hard-paywalled extensions. For a free, open-source, BYOK tool I would plan on
  **1–3%**, and would not be surprised by less.
- Roughly 70% of monetized extensions earn effectively nothing.

### Scenario model

Rough, and deliberately unflattering:

| Scenario | Installs, year 1 | Paying (2%) | At $4/mo | As $39 one-time |
|---|---|---|---|---|
| Launch posts only, no sustained effort | 500–2,000 | 10–40 | $40–160/mo | $400–1,600 total |
| Strong launch + sustained SEO/content | 10,000–30,000 | 200–600 | $800–2,400/mo | $8k–23k total |
| Breakout (front page, sustained press) | 100,000+ | ~2,000 | ~$8,000/mo | ~$78k total |

The realistic median outcome for an unfunded solo extension is the first row. Plan for
it; the second row is a good year, not a baseline. Note also that a Chrome extension with
genuine traction is a saleable asset (reported range roughly $20k–200k+), and for a
project like this the highest-expected-value outcome may well be non-revenue: portfolio
credibility, a hiring signal, or an acquisition — not MRR.

### Recommended sequence

**Phase 1 — launch (months 0–3): do not monetize at all.**
Free, open source, BYOK, no paywall, no account. The goals are installs, reviews and
retention data. Adding a paywall to a product with fifty users optimizes the wrong
variable, and a "free and open source, no catch" launch is materially more effective on
exactly the channels this product should launch on. Put a GitHub Sponsors / Ko-fi link in
settings; expect it to earn a rounding error, and treat any signal from it as free
willingness-to-pay research.

**Phase 2 — Pro tier (months 3–9), if and only if retention justifies it.**

The hard constraint: **never sell anything whose cost scales with usage.** The moment
you sell inference you take on margin risk, abuse risk, prepaid-credit accounting, and
you forfeit the privacy claim that is the entire position. Every paid feature below is
zero-marginal-cost to you:

1. **Bring-your-own-storage sync.** The one genuine weakness of local-first is that the
   library is trapped on one machine. Solve it *without a server*: encrypted sync through
   the user's own Google Drive / Dropbox / WebDAV / S3. Zero COGS, zero liability,
   perfectly on-brand ("bring your own key" → "bring your own storage"), and it is the
   feature people will actually pay for.
2. **Export and integrations** — Obsidian, Notion, Readwise, Markdown, CSV.
3. **PDF and local-file support** in the knowledge base.
4. **Collections, auto-capture rules, saved searches, scheduled digests** (digests run
   locally on the user's own key).
5. **Firefox and Edge builds.** Cheap ports, and the privacy-motivated audience is
   disproportionately on Firefox.

**Pricing: $39 one-time "Pro", not a subscription — at first.** This audience is
subscription-fatigued by disposition, a one-time price matches the product's ethos, and
front-loaded cash is more useful than $4/mo at these volumes. Move to a subscription only
if and when hosted sync becomes real infrastructure with real recurring cost. If a
subscription does arrive, honor the lifetime licenses; breaking that promise with this
particular audience would be terminal.

### Explicitly reject

- **A managed-key subscription** (you supply the API access). This makes you a
  low-margin LLM reseller with abuse exposure and destroys the privacy claim, in exchange
  for revenue you cannot yet support. Revisit only at meaningful scale.
- **Ads, affiliate injection, or bandwidth-sharing SDKs** (Mellowtel and similar).
  Monetization guides push these hard. For a product whose entire position is "we don't
  touch your data", any of them is not a compromise — it is the end of the product.

### Licensing note

MIT means anyone can fork, rebrand and monetize this. That is a real risk and, at this
scale, an acceptable one: the MIT license is doing more work as a *trust signal* than a
competitor could extract as value, and the moat was never the code — it is the user's
accumulated library and the store listing. Trademark the name; keep the code permissive.
Revisit only if a fork actually outranks you.

---

## 7. Where this analysis could be wrong

The parts most likely to be wrong, roughly in order of how much they would hurt:

**1. "Local-first" is a stated preference, not a revealed one.** People say they want
privacy and then install the cloud tool with the better free tier. Memex is the
cautionary case: local-first, open source, offline, principled ownership structure — and
discontinued. The optimistic reading is that Memex predates the RAG era and left the
ground empty. The pessimistic reading is that they ran the experiment and it does not
support a business. Both readings are available from the same evidence, and I cannot
distinguish them from here. This is the load-bearing uncertainty in the whole memo.

**2. The knowledge base may be a vitamin.** The uncomfortable truth about bookmarking
tools is that most people save and never return. If the Ask tab is not used, the KB is a
feature users admire in a screenshot and never open — and the positioning collapses back
onto layer 2. **This is measurable, and it is the single metric that should govern
everything here:** the share of week-2+ users who run at least one KB query. If it comes
in under ~20%, reposition around per-page chat and history and reread this memo.

**3. n=1.** This was built by one person, for that person, who reports using it often.
That is a real signal — the best products often start there — but it is one data point,
and the "I use it, others probably would" inference is where most indie products die.
Twenty user interviews before Phase 2 would be worth more than any amount of further
desk research, including this memo.

**4. The on-device recommendation could backfire.** If Gemini Nano's summaries are
noticeably worse, the free default becomes the product's public face and the reviews
follow. It also raises engineering cost and adds a hardware gate. A cheaper hedge worth
considering: ship built-in AI as an *option* first, measure quality and eligibility on
real users, and only promote it to default if both hold up.

**5. Multi-provider dilutes the cleanest claim.** "The only host it contacts is
api.openai.com" is unusually crisp and verifiable. Six providers plus localhost is
strictly more useful and strictly less crisp, and it complicates store review. Optional
permissions mitigate this but do not eliminate it.

**6. The platform could simply absorb the category.** If Chrome ships a native
"remember and search everything I read" feature — which is a natural extension of what
it already has — the differentiator narrows to "and it stays local." That may still be
enough. It may not.

**7. The evidence base is thin.** Re-read the caveat at the top. There is no first-party
search-volume data, no verified install counts, and several cited figures come from SEO
content farms. Before committing to a name and a listing, spend an hour with real
Chrome Web Store listings and a keyword tool. The structural argument — commodity layer,
contested layer, defensible layer — does not depend on those numbers, but the *sizing*
does, entirely.

---

## 8. What I would actually do, in order

1. **Rename and re-listing.** Lead with the knowledge base. Reorder screenshots so
   Ask-with-citations is first. Cheapest, highest-leverage change available. *(days)*
2. **Add Chrome built-in AI as an option**, with capability detection and a clean
   fallback chain. Measure eligibility and quality on real users before promoting it to
   default. *(1–2 weeks)*
3. **Launch free and open source**, no paywall, no account. Channels ranked by fit:
   r/LocalLLaMA, r/selfhosted, r/PKMS, r/ObsidianMD, r/privacy, Show HN, Lobsters,
   Product Hunt. The Show HN should be the *technical* post — "how the extension does
   hybrid retrieval entirely in IndexedDB" — not the product pitch. *(weeks)*
4. **Instrument retention locally** (no telemetry — a visible in-extension stats panel
   the user can share voluntarily, plus direct user interviews). Watch the week-2+ KB
   query rate above all else.
5. **Local embeddings via Transformers.js**, if step 2's numbers hold. This is what makes
   the whole product free and fully local end to end. *(1–2 weeks)*
6. **Content SEO**: "Recall alternative", "Glasp alternative", "NotebookLM without
   sending your pages to Google", "AI reading tools that don't need an account".
   Slow-burn, compounding, and the only sustainable acquisition channel available at
   zero budget.
7. **Only then**, if retention holds: Phase 2 Pro at $39 one-time, led by
   bring-your-own-storage sync.

The honest summary: this is a genuinely well-built tool sitting in a category the
platform vendor just commoditized, with one real and defensible position available to it
— *private, local, queryable reading memory* — and a realistic revenue ceiling in the
hundreds-to-low-thousands per month absent unusual distribution luck. That is worth
doing. It is not worth quitting a job over, and the plan above is sequenced so that the
question of whether it is more than that gets answered by users before much more is
invested.
