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
1. **Discover** — two ways in, and they complement each other:
   - *Search* (costs credits): a web-search API runs
     `"<your keywords>" site:boards.greenhouse.io` and friends. Every hit is a live
     posting on *some* company's board — including obscure ones that never reach the
     classic sites. Good at finding companies you'd never have thought to name.
   - *Probe* (free): for companies you name in `probeCompanies`, guess the ATS slug
     from the name and ask each vendor directly. Good at pinning down a specific
     employer that search may take weeks to surface, or may never rank.
2. **Remember** — the board's `(vendor, token)` is parsed from the URL and saved to
   `data/boards.json`. This registry grows every run.
3. **Harvest** — each known board's full feed is pulled directly from the free ATS
   APIs (no key, no quota), then filtered to your criteria.

Over time you accumulate the per-company API map you'd never build by hand.

### Sources
- **Direct ATS** — Greenhouse, Lever, Ashby, Workday, plus the EU/NL-heavy vendors
  Recruitee, Workable, SmartRecruiters and Teamtailor (harvested from the registry).
- **Discovery** — Brave Search or Google CSE finds new ATS boards (needs one free
  key), and slug probing finds named companies' boards for free.
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
Only discovery spends credits; harvesting known boards is free. The full query list is
`leadKeywordGroups × atsDomains` plus the location-targeted queries — currently **180
searches**. Only `maxQueriesPerRun` (20) run per day, as a window that rotates through
the list (offset persisted in `data/discovery-state.json`), so the whole list is covered
about every **9 days** instead of the tail never running. At 20/day that's ~600/mo,
inside Brave's free credit. Set `JOB_RADAR_DISCOVER=false` to force a harvest-only run.

Prefer Google? Set `searchProvider = "google"` in `src/config.ts` and export
`GOOGLE_API_KEY` + `GOOGLE_CSE_CX` (Programmable Search, 100 queries/day free).
Without a key, discovery is skipped and only the aggregators run.
See [`docs/discovery-provider.md`](docs/discovery-provider.md) for why we're on Brave.

### Probe specific employers (free, no key)
Search discovery only finds companies that happen to rank for your keywords. If you
want a *particular* employer covered, add it to `probeCompanies` in `src/config.ts`:

```ts
export const probeCompanies: string[] = ["Adyen", "Mollie", "Picnic", /* … */];
```

Each run turns the name into up to four candidate slugs — the plain one, the same with
legal/geo suffixes stripped, and the de-hyphenated forms (`"Booking.com"` → `booking-com`,
`bookingcom`; `"Acme Holding B.V."` → `acme-holding-b-v`, `acme`, `acmeholdingbv`) — and
tries each against Greenhouse, Lever,
Ashby, Recruitee, Workable, SmartRecruiters and Teamtailor. A company resolves when a
vendor answers **with at least one job**, and the board then joins `data/boards.json`
and is harvested like any other. Workday isn't probed — it needs a tenant, data centre
*and* site, none of which follow from a company name.

Results are cached in `data/probe-state.json`: resolved companies are never re-probed,
and misses are retried after 30 days. So the cost is one sweep (~20s for 15 companies),
not a daily tax. Set `JOB_RADAR_PROBE=false` to skip it.

### Enable Adzuna / Jooble (free, optional)
- Adzuna: register at https://developer.adzuna.com → `export ADZUNA_APP_ID=… ADZUNA_APP_KEY=…`
- Jooble: get a key at https://jooble.org/api/about → `export JOOBLE_API_KEY=…`

## Change what you track
Edit `src/config.ts`:
- `criteria.keywordTiers` — weighted bands of keyword groups (`lead` / `adjacent` /
  `ic`). A job matches if ANY group in ANY tier matches, and a group matches only when
  ALL its terms do. The highest matched tier's weight becomes the job's score, which
  drives ranking; the tier name shows as a badge.
- `criteria.excludeKeywords`, `countries`, `remoteOnly`, `visaSponsorship`.
- `criteria.location` — geo filter: remote roles are kept worldwide except
  `remoteExclude` markets; in-person/hybrid roles are kept only in `onsiteCountries`.
- `criteria.maxAgeDays` — drop postings older than N days (undefined = no limit).
- `atsDomains` — which ATS domains discovery scans.
- `probeCompanies` — employers to probe for a board directly, no search key needed.
- `discovery.locationTerms` — extra location-targeted discovery (e.g. `["netherlands"]`
  adds one broad query per ATS domain to surface companies hiring there).
- `discovery.maxQueriesPerRun` — cap search-API usage per run.
- `demoteCompanies` — companies whose score is halved (feed-flooders and off-domain
  posters) so genuine hits still surface but sink.
- `seedBoards` — pin specific company boards to harvest directly (e.g. a Workday
  tenant like Honeywell), without waiting for discovery to find them.

## Scheduled + hosted (GitHub Actions)
1. Push this repo to GitHub.
2. Settings → Secrets → Actions: add `BRAVE_API_KEY` (for discovery) and optionally
   `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JOOBLE_API_KEY`.
3. Settings → Pages → Source: GitHub Actions.
4. The workflow runs once daily (09:30 UTC), commits everything under `data/`, and
   publishes the dashboard to your Pages URL. "NEW" detection works because the
   previous `jobs.json` is committed and diffed each run — same for the board registry,
   probe results and repost history.

## How "new" detection works
Each job gets a stable id = `sha1(source|company|title|location)`. On each run the
collector loads the previous `jobs.json`, and any id not seen before is flagged
`isNew` and sorted to the top. `data/boards.json` is the growing registry of company
ATS boards discovered so far — it's harvested in full every run, so the search key is
only spent finding *new* boards.

## How repost detection works
Some employers (NL consultancies especially) recycle the same listing over and over,
which reads as a steady stream of openings but is often one role being re-advertised.
`data/seen-history.json` records sighting dates per role (normalised title + company).
A new sighting is only appended when the previous one is **more than 14 days old** — a
role that simply stays listed is one continuous posting, not a repost — and sightings
older than 90 days are pruned. Two or more sightings show as a `reposted ×N` badge.

Like the language-requirement badge, this is **annotation only and never filtered on**:
a repost says something about the employer, not about whether the role is worth
applying to.

## Data files
| File | What it holds |
| --- | --- |
| `jobs.json` | The current matched set (also the baseline for "new" detection) |
| `index.html` | The generated dashboard |
| `boards.json` | Registry of known company ATS boards |
| `dead.json` | Boards that 404'd, denylisted so discovery stops re-adding them (45-day TTL) |
| `discovery-state.json` | Where the rotating search-query window resumes |
| `probe-state.json` | Which `probeCompanies` resolved, and when each was last tried |
| `seen-history.json` | Sighting dates per role, for repost detection |

All are committed by CI each run — the history *is* the state.

## Roadmap (next phases)
- **Supabase**: replace the JSON files with Postgres for `first_seen` history,
  saved searches, and applied/dismissed state.
- **React dashboard**: full filtering UI on Vercel (Cortex stack), email/Slack
  alerts on new matches.
