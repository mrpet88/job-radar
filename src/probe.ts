import type { Board } from "./types.js";
import { fetchBoard } from "./sources/ats/index.js";
import { pool, HttpError, type FetchOpts } from "./util/http.js";

// Free board discovery: guess a company's ATS slug from its name and try the
// vendor APIs directly. Search-based discovery (discover.ts) costs Brave credits
// and is capped at 20 queries/run over a ~160-query rotation, so a named company
// can wait weeks to surface. Probing is unmetered — it only spends HTTP requests.
//
// Workday is deliberately not probed: it needs tenant + data centre + site, and a
// company name yields at most the first, so guesses would be almost all misses.
const VENDORS = [
  "greenhouse", "lever", "ashby", "recruitee", "workable", "smartrecruiters", "teamtailor",
] as const;
export type ProbeVendor = (typeof VENDORS)[number];

// Legal-form and geography suffixes that companies put in their registered name
// but almost never in their careers slug ("Acme Holding B.V." → "acme").
// Longest-first so "-b-v" wins over "-v" when both could match the tail.
const SUFFIXES = ["netherlands", "nederland", "holding", "group", "b-v", "n-v", "bv", "nv"];
const SUFFIX_RE = new RegExp(`(?:-(?:${SUFFIXES.join("|")}))+$`);

// "Booking.com" → "booking-com", "Just Eat Takeaway" → "just-eat-takeaway".
export const deriveSlug = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Up to four slugs to try per company: the plain one, the same with legal/geo
// suffixes stripped, and the de-hyphenated form of each ("bookingcom", "tomtom").
export function slugVariants(name: string): string[] {
  const base = deriveSlug(name);
  const stripped = base.replace(SUFFIX_RE, "");
  const out = [base, stripped, base.replace(/-/g, ""), stripped.replace(/-/g, "")];
  return [...new Set(out.filter(Boolean))];
}

// Probing guesses slugs, so most requests are expected to miss. A harvest can
// afford to wait out a slow board; a probe cannot. Measured at harvest defaults
// (15s, one retry) a single unresolvable company took ~57s, nearly all of it
// spent waiting on slugs that were never going to exist.
//
// 10s rather than something tighter: a real board can be slow under the
// concurrency this runs at (Adyen's Greenhouse board answers in 0.7s alone but
// timed out at 5s with several sweeps in flight). A probe that times out on a
// board that exists is only recorded as inconclusive, so it costs a retry next
// run rather than a wrong answer — but a threshold that never converges would
// re-probe the same companies every single day.
const PROBE_OPTS: FetchOpts = { timeoutMs: 10_000, retries: 0 };

export interface ProbeEntry {
  resolved?: { vendor: ProbeVendor; token: string };
  lastTried: string;      // ISO date of the last *conclusive* sweep
  attempts: number;       // conclusive sweeps so far
  mismatches?: string[];  // boards that answered under a different company name
}
export type ProbeState = Record<string, ProbeEntry>;

export interface ProbeResult {
  candidates: Omit<Board, "firstSeen">[];
  state: ProbeState;
  tried: number;       // companies actually probed this run
  resolved: number;    // of those, how many found a board
  skipped: number;     // already resolved, or still inside the retry TTL
  mismatched: number;  // boards rejected because the name disagreed
  inconclusive: number; // sweeps that hit a timeout/5xx and were not recorded
}

// A guessed slug can land on a different company's board — "picnic", "group" and
// "consider" are not unique across vendors. The vendor reports the real company
// name, so require it to agree before adopting the board; otherwise the radar
// would file a stranger's jobs under a name you trust.
//
// Prefix rather than substring, so "ING" matches "ING Group" but not "Sterling".
export function nameMatches(configured: string, found: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const a = norm(configured);
  const b = norm(found);
  if (!a || !b) return false;
  return a.startsWith(b) || b.startsWith(a);
}

type Outcome =
  | { kind: "hit"; company: string }
  | { kind: "miss" }       // the vendor answered: no such board (or it is empty)
  | { kind: "unknown" };   // timeout, 429, 5xx, DNS — the question went unanswered

// Reusing fetchBoard() means a resolved board is by construction one the
// harvester can already read — no second, subtly different client.
async function tryBoard(vendor: ProbeVendor, token: string): Promise<Outcome> {
  try {
    const jobs = await fetchBoard({ vendor, token, firstSeen: "" } as Board, PROBE_OPTS);
    return jobs.length ? { kind: "hit", company: jobs[0].company } : { kind: "miss" };
  } catch (e) {
    // Only a 4xx that is not rate-limiting is the vendor actually saying "no".
    // Everything else means we failed to ask, which must not be remembered as a
    // miss — otherwise one flaky run parks a real employer for the whole TTL.
    if (e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 429)
      return { kind: "miss" };
    return { kind: "unknown" };
  }
}

// Probe each company across its slug variants × vendors, stopping at the first
// hit. Unresolved companies are retried only after `ttlDays`, mirroring how
// pruneExpiredDead() ages out the board denylist in boards.ts — without it every
// run would re-probe the same misses forever.
export async function probe(
  companies: string[],
  state: ProbeState,
  ttlDays = 30,
  concurrency = 8,
): Promise<ProbeResult> {
  const now = new Date().toISOString();
  const cutoff = Date.now() - ttlDays * 86_400_000;

  const due = companies.filter((c) => {
    const e = state[c];
    if (!e) return true;
    if (e.resolved) return false;
    const t = Date.parse(e.lastTried);
    return Number.isNaN(t) || t < cutoff;
  });

  const next: ProbeState = { ...state };
  const candidates: Omit<Board, "firstSeen">[] = [];
  let mismatched = 0;
  let inconclusive = 0;

  await pool(due, concurrency, async (company) => {
    const prev = next[company];
    let hit: { vendor: ProbeVendor; token: string } | undefined;
    const mismatches: string[] = [];
    let sawUnknown = false;

    outer: for (const token of slugVariants(company)) {
      for (const vendor of VENDORS) {
        const r = await tryBoard(vendor, token);
        if (r.kind === "unknown") { sawUnknown = true; continue; }
        if (r.kind === "miss") continue;
        if (nameMatches(company, r.company)) { hit = { vendor, token }; break outer; }
        // Right slug shape, wrong company. Keep sweeping — another vendor may
        // hold the real board — but record it so a silent misfile is visible.
        mismatches.push(`${vendor}/${token} → ${r.company}`);
      }
    }

    if (hit) {
      next[company] = {
        resolved: hit,
        lastTried: now,
        attempts: (prev?.attempts ?? 0) + 1,
        ...(mismatches.length ? { mismatches } : {}),
      };
      // `name` is the configured company name, which beats prettify()'s guess at
      // a display name derived from the slug.
      candidates.push({ vendor: hit.vendor, token: hit.token, name: company });
    } else if (sawUnknown) {
      // The sweep was inconclusive, so leave the previous entry (or its absence)
      // untouched: this company stays due and gets another chance next run
      // rather than sitting out the full TTL on the strength of a timeout.
      inconclusive++;
    } else {
      next[company] = {
        lastTried: now,
        attempts: (prev?.attempts ?? 0) + 1,
        ...(mismatches.length ? { mismatches } : {}),
      };
    }
    mismatched += mismatches.length;
  });

  return {
    candidates,
    state: next,
    tried: due.length,
    resolved: candidates.length,
    skipped: companies.length - due.length,
    mismatched,
    inconclusive,
  };
}
