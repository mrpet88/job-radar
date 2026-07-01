# Job Radar — prototype

Fetches career opportunities directly from job-board APIs (not LinkedIn scraping),
filters by your criteria, dedupes, flags **new** postings since the last run, and
writes a static dashboard (`data/index.html`) + raw data (`data/jobs.json`).

## Why this approach
Most companies don't run their own job board — they rent an **ATS** (Greenhouse,
Lever, Ashby, Workday…), each of which exposes public job data. But those APIs
need a *per-company* identifier and there's no global cross-company search — so
Job Radar builds that company list itself:

**discover → remember → harvest**
1. **Discover** — a web-search API runs `"<your keywords>" site:boards.greenhouse.io`
   (and the other ATS domains). Every hit is a live posting on *some* company's
   board — including obscure ones that never reach the classic sites.
2. **Remember** — the board's `(vendor, token)` is parsed from the URL and saved to
   `data/boards.json`. This registry grows every run.
3. **Harvest** — each known board's full feed is pulled directly from the free ATS
   JSON APIs (no key, no quota), then filtered to your criteria.

Over time you accumulate the per-company API map you'd never build by hand.

### Sources
- **Direct ATS** — Greenhouse, Lever, Ashby, Workday (harvested from the registry).
- **Discovery** — Brave Search or Google CSE finds new ATS boards (needs one free key).
- **Aggregators** (no key) — Arbeitnow, RemoteOK, Remotive, Jobicy; plus **Adzuna**
  (free dev key, 50+ countries incl. NL, salary) and **Jooble** (free key).

## Run locally
```bash
npm install
npm run build
npm start            # Arbeitnow works immediately, no key
open data/index.html
```

### Enable ATS discovery (the deep net)
Discovery needs one free search key. **Brave** is the default:
1. Sign up at https://brave.com/search/api/ and choose the **Web Search** plan
   ($5 / 1,000 requests) — *not* the "Answer"/grounding plan. Each plan includes
   **free $5 in credits every month** ≈ 1,000 searches/mo, which is enough here.
2. Export the key and run:
```bash
export BRAVE_API_KEY=xxxx
npm start                 # discovers boards → data/boards.json → harvests them
```
Only discovery spends credits; harvesting known boards is free. A full discovery is
`keywordGroups × atsDomains` (~25 searches). CI runs **once a day**, so usage stays
~750/mo, inside the free credit. Set `JOB_RADAR_DISCOVER=false` to force a harvest-only
run yourself.

Prefer Google? Set `searchProvider = "google"` in `src/config.ts` and export
`GOOGLE_API_KEY` + `GOOGLE_CSE_CX` (Programmable Search, 100 queries/day free).
Without a key, discovery is skipped and only the aggregators run.

### Enable Adzuna / Jooble (free, optional)
- Adzuna: register at https://developer.adzuna.com → `export ADZUNA_APP_ID=… ADZUNA_APP_KEY=…`
- Jooble: get a key at https://jooble.org/api/about → `export JOOBLE_API_KEY=…`

## Change what you track
Edit `src/config.ts`:
- `criteria` — `keywordsAny` (OR across groups, AND within a group), `excludeKeywords`,
  `countries`, `remoteOnly`, `visaSponsorship`.
- `criteria.location` — geo filter: remote roles are kept worldwide except
  `remoteExclude` markets; in-person/hybrid roles are kept only in `onsiteCountries`.
- `criteria.maxAgeDays` — drop postings older than N days (undefined = no limit).
- `atsDomains` — which ATS domains discovery scans.
- `discovery.locationTerms` — extra location-targeted discovery (e.g. `["netherlands"]`
  adds one broad query per ATS domain to surface companies hiring there).
- `discovery.maxQueriesPerRun` — cap search-API usage per run.
- `seedBoards` — pin specific company boards to harvest directly (e.g. a Workday
  tenant like Honeywell), without waiting for discovery to find them.

## Scheduled + hosted (GitHub Actions)
1. Push this repo to GitHub.
2. Settings → Secrets → Actions: add `BRAVE_API_KEY` (for discovery) and optionally
   `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JOOBLE_API_KEY`.
3. Settings → Pages → Source: GitHub Actions.
4. The workflow runs once daily (09:30 UTC), commits fresh data (`jobs.json`,
   `index.html`, `boards.json`), and publishes the dashboard to your Pages URL. "NEW"
   detection works because the previous `jobs.json` is committed and diffed each run.

## How "new" detection works
Each job gets a stable id = `sha1(source|company|title|location)`. On each run the
collector loads the previous `jobs.json`, and any id not seen before is flagged
`isNew` and sorted to the top. `data/boards.json` is the growing registry of company
ATS boards discovered so far — it's harvested in full every run, so the search key is
only spent finding *new* boards.

## Roadmap (next phases)
- **More discovery domains / vendors**: SmartRecruiters, Recruitee, Workable.
- **Supabase**: replace the JSON files with Postgres for `first_seen` history,
  saved searches, and applied/dismissed state.
- **React dashboard**: full filtering UI on Vercel (Cortex stack), email/Slack
  alerts on new matches.
