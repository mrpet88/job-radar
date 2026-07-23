# Discovery search provider

**TL;DR** — Discovery is pinned to **Brave** (`searchProvider: "brave"` in
[`src/config.ts`](../src/config.ts)). Google's Custom Search JSON API is closed to
new Cloud projects, and Brave dropped its free tier in Feb 2026. We run ~600
queries/month (`maxQueriesPerRun: 20`, daily) to stay inside Brave's ~$5/month
credit (~1,000 queries), so discovery isn't billed.

_Last verified: July 2026. Provider terms move — re-check before changing this._

## Why not Google (Custom Search JSON API)

Attempting to set it up on a fresh Cloud project (`job-radar`) failed hard:

- The API call returns **`403 PERMISSION_DENIED` — "This project does not have the
  access to Custom Search JSON API"** even with: the API showing **Enabled** on the
  project, a correctly-scoped API key **in that same project**, application
  restrictions `None`, and 15+ minutes elapsed (so not propagation).
- The Programmable Search Engine's **"Search the entire web" mode is deprecated and
  can no longer be enabled** (the control panel says so outright). A site-restricted
  engine still works, but the 403 above blocks the API regardless.
- Read together, Google is winding this product down and **new integrations are
  effectively blocked**.

**Do not migrate to Vertex AI Search / Discovery Engine** as the "modern
replacement." It needs a crawled data store, OAuth2 / service-account auth (not a
plain API key), and a different, heavier request surface — a full rewrite of
[`discover.ts`](../src/discover.ts) and [`search.ts`](../src/sources/search.ts). That
is wildly disproportionate to what discovery does: fire ~20 `<keywords> site:<ats>`
queries a day to find company ATS board URLs.

## Why Brave

- **Already supported** in [`src/sources/search.ts`](../src/sources/search.ts) — the
  `brave()` path needs no code changes, just `BRAVE_API_KEY`.
- **Caveat — Brave also changed.** As of ~Feb 2026 there is **no standalone free
  tier**. New accounts get **$5/month in credits (~1,000 queries)** at $5 per 1,000
  requests, with a card on file (used as anti-fraud; not charged while you stay
  inside the credit). Accounts that had the old free plan are **grandfathered to
  2,000 queries/month**.

## Budget math

- `maxQueriesPerRun: 20`, run daily → **~600 queries/month**.
- That's under the ~1,000-query monthly credit (so **no overage charge** on the new
  metered model) and well under a grandfathered 2,000/month.
- The **rotating window** (persisted offset in `data/discovery-state.json`) walks the
  full lead-tier query list (~100 queries) every ~5 days, so the low daily cap
  doesn't starve the tail — every lead query still runs, just spread across runs.
- Discovery is also restricted to **lead-tier keyword groups only**: IC-role
  companies get discovered anyway once any lead role surfaces their board, and every
  posting on a known board is then harvested for free.

## To keep it running

- Repo secret **`BRAVE_API_KEY`** must be set (Settings → Secrets and variables →
  Actions). If it's unset, discovery auto-disables and the daily harvest of known
  boards still runs — you just stop finding *new* boards.
- A **card on file** in the Brave API dashboard is required (anti-fraud; not charged
  within the credit).
- **Keep public Brave attribution** to retain the $5/month credit — Brave forfeits
  the credit if you drop attribution. The dashboard is a public GitHub Pages site, so
  a small "Search powered by Brave" line satisfies this.
- Watch usage at <https://api-dashboard.search.brave.com>.

## If Brave becomes unviable

- A key-based provider like **Serper.dev** is a ~10-line addition to
  [`src/sources/search.ts`](../src/sources/search.ts) (mirror the `brave()` /
  `google()` functions and add a `SearchProvider` value). Prefer this over any
  crawl-and-index product.
- Harvesting known boards never needs a search key, so losing discovery degrades
  gracefully — it doesn't take the pipeline down.

## Sources (July 2026)

- Brave Search API pricing — <https://brave.com/search/api/>
- "Brave Kills Free Search API Tier, Shifts to Metered Billing" —
  <https://www.implicator.ai/brave-drops-free-search-api-tier-puts-all-developers-on-metered-billing/>
